import { resolveAll } from '../config.js';
import type { Blackboard, ReviewIssue } from '../types.js';
import { runPlanner, runCoder, runReviewer } from './agents.js';
import { validateFiles } from './validator.js';
import { logEvent, persist } from './blackboard.js';

type Emit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

const MAX_ITERATIONS: Record<Blackboard['mode'], number> = { lite: 0, normal: 1, pro: 3 };

/**
 * TMAP v2 loop (TDD §4): Plan -> Code -> Validate -> Review -> Critique loop.
 * Agents collaborate through the shared Blackboard, not a blind pipe.
 */
export async function runTMAP(bb: Blackboard, emit: Emit): Promise<Blackboard> {
  const agents = resolveAll();
  const maxIter = MAX_ITERATIONS[bb.mode];

  // 1) PLAN
  emit('planner', `planning (${agents.planner.providerName} · ${agents.planner.model})`, 'status');
  const plan = await runPlanner(agents.planner, bb);
  bb.plan = plan.steps;
  bb.planText = plan.raw;
  logEvent(bb, { role: 'planner', type: 'output', text: plan.raw });
  emit('planner', plan.raw, 'output');

  let critique: string | undefined;

  for (let iter = 0; ; iter++) {
    bb.iterations = iter + 1;

    // 2) CODE
    emit('coder', `${iter === 0 ? 'generating code' : `revising (iteration ${iter + 1})`} (${agents.coder.providerName} · ${agents.coder.model})`, 'status');
    bb.files = await runCoder(agents.coder, bb, critique);
    logEvent(bb, { role: 'coder', type: 'output', text: bb.files.map((f) => f.path).join(', ') });
    emit('coder', `produced ${bb.files.length} file(s): ${bb.files.map((f) => f.path).join(', ')}`, 'output');

    // 3) VALIDATE (grounded — really runs)
    emit('validator', `validating (${agents.validator.providerName})`, 'status');
    bb.validations = validateFiles(bb.files);
    for (const v of bb.validations) {
      logEvent(bb, { role: 'validator', type: 'validation', text: `${v.kind} ${v.passed ? 'PASS' : 'FAIL'} — ${v.logs}` });
      emit('validator', `${v.passed ? 'PASS' : 'FAIL'} — ${v.logs}`, v.passed ? 'output' : 'error');
    }
    const validationFailed = bb.validations.some((v) => !v.passed);

    // 4) REVIEW
    emit('reviewer', `reviewing (${agents.reviewer.providerName} · ${agents.reviewer.model})`, 'status');
    const review = await runReviewer(agents.reviewer, bb);
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
