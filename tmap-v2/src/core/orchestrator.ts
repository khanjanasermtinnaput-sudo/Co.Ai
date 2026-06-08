import { bagFromEnv, type CredentialBag } from '../config.js';
import type { Blackboard, ReviewIssue, Role, LLMCall } from '../types.js';
import { runPlanner, runCoder, runReviewer } from './agents.js';
import { validateFiles } from './validator.js';
import { logEvent, persist } from './blackboard.js';
import { chatWithDARS, type DarsContext } from '../dars/run.js';
import { HealthStore, globalHealth } from '../dars/health.js';
import { listProviderCandidates } from '../dars/select.js';

type Emit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

export interface RunOpts {
  creds?: CredentialBag;   // per-user keys (server) — defaults to env (CLI)
  health?: HealthStore;    // defaults to the shared singleton
}

const MAX_ITERATIONS: Record<Blackboard['mode'], number> = { lite: 0, normal: 1, pro: 3 };

/**
 * TMAP v2 loop (TDD §4): Plan -> Code -> Validate -> Review -> Critique loop.
 * Agents collaborate through the shared Blackboard, not a blind pipe.
 * Every LLM call goes through DARS (§4): automatic failover when a provider is
 * down / rate-limited / quota-exhausted / slow / returns low quality.
 */
export async function runTMAP(
  bb: Blackboard,
  emit: Emit,
  runOpts: RunOpts = {},
): Promise<Blackboard> {
  const maxIter = MAX_ITERATIONS[bb.mode];
  const creds = runOpts.creds ?? bagFromEnv();
  const health = runOpts.health ?? globalHealth;
  bb.agentRuns = bb.agentRuns ?? [];

  const ctx: DarsContext = { creds, health, emit, sessionId: bb.sessionId };

  // An LLMCall for a given role, backed by DARS; records which provider served it.
  const callFor = (role: Role): LLMCall => async (messages, opts = {}) => {
    const r = await chatWithDARS(role, messages, opts, ctx);
    bb.agentRuns!.push({ role, provider: r.provider.providerName, model: r.provider.model, attempts: r.attempts, ts: Date.now() });
    return r.text;
  };

  // Best current label for a role (display only; actual provider chosen at call time).
  const label = (role: Role): string => {
    const c = listProviderCandidates(role, creds)[0];
    return c ? `${c.provider.providerName} · ${c.provider.model}` : 'mock';
  };

  // 1) PLAN
  emit('planner', `planning (${label('planner')})`, 'status');
  const plan = await runPlanner(callFor('planner'), bb);
  bb.plan = plan.steps;
  bb.planText = plan.raw;
  logEvent(bb, { role: 'planner', type: 'output', text: plan.raw });
  emit('planner', plan.raw, 'output');

  let critique: string | undefined;

  for (let iter = 0; ; iter++) {
    bb.iterations = iter + 1;

    // 2) CODE
    emit('coder', `${iter === 0 ? 'generating code' : `revising (iteration ${iter + 1})`} (${label('coder')})`, 'status');
    bb.files = await runCoder(callFor('coder'), bb, critique);
    logEvent(bb, { role: 'coder', type: 'output', text: bb.files.map((f) => f.path).join(', ') });
    emit('coder', `produced ${bb.files.length} file(s): ${bb.files.map((f) => f.path).join(', ')}`, 'output');

    // 3) VALIDATE (grounded — really runs locally, no LLM)
    emit('validator', 'validating (sandbox)', 'status');
    bb.validations = validateFiles(bb.files);
    for (const v of bb.validations) {
      logEvent(bb, { role: 'validator', type: 'validation', text: `${v.kind} ${v.passed ? 'PASS' : 'FAIL'} — ${v.logs}` });
      emit('validator', `${v.passed ? 'PASS' : 'FAIL'} — ${v.logs}`, v.passed ? 'output' : 'error');
    }
    const validationFailed = bb.validations.some((v) => !v.passed);

    // 4) REVIEW
    emit('reviewer', `reviewing (${label('reviewer')})`, 'status');
    const review = await runReviewer(callFor('reviewer'), bb);
    bb.review = review.issues;
    bb.reviewText = review.raw;
    logEvent(bb, { role: 'reviewer', type: 'output', text: review.raw });
    emit('reviewer', review.raw, 'output');

    const blocking = review.issues.filter((i) => i.severity === 'HIGH');

    // 5) CRITIQUE LOOP — only if there is something concrete to fix and budget left
    if (iter < maxIter && (validationFailed || blocking.length)) {
      critique = buildCritique(bb.validations.filter((v) => !v.passed).map((v) => v.logs), blocking);
      emit('system', `issues found — looping back to Coder (iteration ${iter + 2}/${maxIter + 1})`, 'status');
      continue;
    }
    break;
  }

  const path = persist(bb);
  emit('system', `done — session saved: ${path}`, 'status');
  return bb;
}

function buildCritique(valLogs: string[], blocking: ReviewIssue[]): string {
  const lines: string[] = [];
  if (valLogs.length) lines.push('Validation failures:', ...valLogs.map((l) => `- ${l}`));
  if (blocking.length) lines.push('Blocking review issues:', ...blocking.map((b) => `- [${b.severity}] ${b.file}: ${b.message}`));
  return lines.join('\n');
}
