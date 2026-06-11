import { bagFromEnv, type CredentialBag } from '../config.js';
import type { Blackboard, ReviewIssue, Role, LLMCall } from '../types.js';
import { runPlanner, runCoder, runReviewer } from './agents.js';
import { validateFiles } from './validator.js';
import { logEvent, persist } from './blackboard.js';
import { chatWithDARS, type DarsContext } from '../dars/run.js';
import { HealthStore, globalHealth } from '../dars/health.js';
import { listProviderCandidates } from '../dars/select.js';
import { gatherProjectContext } from './context.js';
import { buildContextV2, type ProjectContextV2 } from './context-engine.js';
import { runArchitect, architectToContext } from './architect.js';
import { analyzeImpact, impactToContext } from './impact.js';
import { runDocumenter } from './documenter.js';
import type { DependencyGraph } from './context-engine.js';
import { runCoderVote, letter } from './vote.js';

type Emit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

export interface RunOpts {
  creds?: CredentialBag;
  health?: HealthStore;
  // Hooks for persistence (server provides these; CLI omits them)
  onSessionStart?: (sessionId: string) => Promise<void>;
  onSessionEnd?: (sessionId: string, result: { filesCount: number; iterations: number; status: 'done' | 'error'; costUsd: number; tokensUsed: number }) => Promise<void>;
  onAgentCall?: (sessionId: string, log: AgentCallLog) => Promise<void>;
  // Project root for context scanning (default: cwd)
  projectRoot?: string;
  // Skip context scan (e.g. when task is self-contained)
  skipContext?: boolean;
}

export interface AgentCallLog {
  role: Role;
  provider: string;
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

const MAX_ITERATIONS: Record<Blackboard['mode'], number> = { lite: 0, normal: 1, pro: 3 };

// Rough cost estimates per 1M tokens (output = 3x input weight)
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'deepseek-chat':    { input: 0.14, output: 0.28 },
  'qwen-plus':        { input: 0.40, output: 1.20 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  default:            { input: 0.50, output: 1.50 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1M[model] ?? COST_PER_1M.default;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

/**
 * TMAP v2 loop (TDD §4): Plan -> Code -> Validate -> Review -> Critique loop.
 * Now with project context injection, cost tracking, and session persistence hooks.
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
  bb.failureNotes = bb.failureNotes ?? [];

  let totalCostUsd = 0;
  let totalTokens = 0;

  await runOpts.onSessionStart?.(bb.sessionId);

  // Inject project context into blackboard context if not already provided.
  // Context Engine v2: tree + dependency graph + relevant-file selection.
  let projGraph: DependencyGraph | undefined;
  let projType = bb.contextMeta?.projectType ?? '';
  if (!runOpts.skipContext) {
    try {
      const v2: ProjectContextV2 = buildContextV2(runOpts.projectRoot ?? process.cwd(), bb.task);
      projGraph = v2.graph;
      projType = v2.projectType;
      if (!bb.context && v2.summary) {
        bb.context = v2.summary;
        emit('system', `context engine: ${v2.projectType} · ${v2.tree.length} files scanned · ${v2.relevantFiles.length} relevant`, 'status');
      }
      // Keep structured meta even when context came from RAA/memory
      bb.contextMeta = {
        projectType: v2.projectType,
        relevantFiles: v2.relevantFiles,
        conventions: v2.conventions,
        fileCount: v2.tree.length,
      };
    } catch {
      // v2 failure is non-fatal — fall back to the flat v1 scan
      try {
        const projCtx = gatherProjectContext(runOpts.projectRoot);
        if (!bb.context && projCtx.summary) {
          bb.context = projCtx.summary;
          emit('system', `project context detected: ${projCtx.techStack || 'unknown'}`, 'status');
        }
      } catch { /* context scan failure is non-fatal */ }
    }
  }

  const ctx: DarsContext = { creds, health, emit, sessionId: bb.sessionId };

  const callFor = (role: Role): LLMCall => async (messages, opts = {}) => {
    const startMs = Date.now();
    const r = await chatWithDARS(role, messages, opts, ctx);
    const durationMs = Date.now() - startMs;

    // Estimate token counts from message lengths (rough; real counts need provider headers)
    const inputTokens = Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4);
    const outputTokens = Math.ceil(r.text.length / 4);
    const costUsd = estimateCost(r.provider.model, inputTokens, outputTokens);

    totalCostUsd += costUsd;
    totalTokens += inputTokens + outputTokens;

    bb.agentRuns!.push({
      role, provider: r.provider.providerName, model: r.provider.model,
      attempts: r.attempts, ts: Date.now(),
    });

    await runOpts.onAgentCall?.(bb.sessionId, {
      role, provider: r.provider.providerName, model: r.provider.model,
      attempts: r.attempts, inputTokens, outputTokens, costUsd, durationMs,
    });

    return r.text;
  };

  const label = (role: Role): string => {
    const c = listProviderCandidates(role, creds)[0];
    return c ? `${c.provider.providerName} · ${c.provider.model}` : 'mock';
  };

  let status: 'done' | 'error' = 'done';
  // Smart stages (Architect, Impact, Documenter) run in normal/pro — lite stays fast.
  const smart = bb.mode !== 'lite';

  try {
    // 0a) ARCHITECT — design + new/modify decision before planning
    if (smart) {
      try {
        emit('architect', `designing architecture (${label('planner')})`, 'status');
        const decision = await runArchitect(callFor('planner'), bb);
        bb.architect = decision;
        if (decision.approach) emit('architect', `approach: ${decision.approach}`, 'output');
        if (decision.newFiles.length) emit('architect', `new files: ${decision.newFiles.join(', ')}`, 'output');
        if (decision.modifyFiles.length) emit('architect', `modify: ${decision.modifyFiles.join(', ')}`, 'output');
        for (const r of decision.risks) emit('architect', `risk: ${r}`, 'output');
        bb.context = [bb.context, architectToContext(decision)].filter(Boolean).join('\n\n');
      } catch (e) {
        emit('architect', `architect stage skipped: ${(e as Error).message}`, 'status');
      }
    }

    // 0b) IMPACT ANALYSIS — what breaks if we touch the planned files
    if (smart && bb.architect?.modifyFiles.length) {
      try {
        emit('impact', 'analysing change impact', 'status');
        const report = analyzeImpact({ graph: projGraph, modifyFiles: bb.architect.modifyFiles });
        bb.impact = report;
        emit('impact', report.summary, report.risks.some((r) => r.level === 'high') ? 'error' : 'output');
        for (const r of report.risks.filter((x) => x.level !== 'low')) {
          emit('impact', `[${r.level.toUpperCase()}] ${r.file} — ${r.affects.length} dependent(s)`, 'output');
        }
        const impactCtx = impactToContext(report);
        if (impactCtx) bb.context = [bb.context, impactCtx].filter(Boolean).join('\n\n');
      } catch (e) {
        emit('impact', `impact stage skipped: ${(e as Error).message}`, 'status');
      }
    }

    // 0c) UI-AWARENESS — give the Coder design guidance for web/UI projects
    if (smart && isUiProject(projType, bb.task)) {
      bb.context = [bb.context, UI_GUIDANCE].filter(Boolean).join('\n\n');
      emit('system', 'UI-aware mode: design guidance injected for the Coder', 'status');
    }

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

      // 2) CODE — pro mode uses voting (2 coders, reviewer picks best)
      const useVoting = bb.mode === 'pro' && iter === 0;
      if (useVoting) {
        emit('coder', `generating code with consensus vote (${label('coder')} × 3)`, 'status');
        const vote = await runCoderVote(callFor('coder'), callFor('reviewer'), bb, critique);
        bb.files = vote.files;
        emit('coder', `vote winner: candidate ${letter(vote.winnerIndex)}/${vote.candidateCount} — ${vote.reason}`, 'status');
      } else {
        emit('coder', `${iter === 0 ? 'generating code' : `revising (iteration ${iter + 1})`} (${label('coder')})`, 'status');
        bb.files = await runCoder(callFor('coder'), bb, critique);
      }
      logEvent(bb, { role: 'coder', type: 'output', text: bb.files.map((f) => f.path).join(', ') });
      emit('coder', `produced ${bb.files.length} file(s): ${bb.files.map((f) => f.path).join(', ')}`, 'output');

      // 3) VALIDATE
      emit('validator', 'validating (grounded)', 'status');
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

      // L4 — remember failures seen this run so future sessions avoid them.
      for (const v of bb.validations.filter((x) => !x.passed)) {
        bb.failureNotes!.push(`validation: ${v.logs}`);
      }
      for (const b of blocking) {
        bb.failureNotes!.push(`[${b.severity}] ${[b.file, b.message].filter(Boolean).join(' — ')}`);
      }

      if (iter < maxIter && (validationFailed || blocking.length)) {
        critique = buildCritique(bb.validations.filter((v) => !v.passed).map((v) => v.logs), blocking);
        emit('system', `issues found — looping back to Coder (iteration ${iter + 2}/${maxIter + 1})`, 'status');
        continue;
      }
      break;
    }

    // 5) DOCUMENT — generate a README for what was built (normal/pro)
    if (smart && bb.files.length) {
      try {
        emit('documenter', `writing documentation (${label('reviewer')})`, 'status');
        const docs = await runDocumenter(callFor('reviewer'), bb);
        if (docs.length) {
          bb.docs = docs;
          // merge docs into output (skip paths already produced by the Coder)
          const existing = new Set(bb.files.map((f) => f.path));
          for (const d of docs) if (!existing.has(d.path)) bb.files.push(d);
          emit('documenter', `generated ${docs.map((d) => d.path).join(', ')}`, 'output');
        }
      } catch (e) {
        emit('documenter', `documentation stage skipped: ${(e as Error).message}`, 'status');
      }
    }
  } catch (e) {
    status = 'error';
    throw e;
  } finally {
    const path = persist(bb);
    emit('system', `done — session saved: ${path}`, 'status');
    await runOpts.onSessionEnd?.(bb.sessionId, {
      filesCount: bb.files.length,
      iterations: bb.iterations,
      status,
      costUsd: totalCostUsd,
      tokensUsed: totalTokens,
    });
  }

  return bb;
}

const UI_GUIDANCE = `## UI/UX Guidance (this is a web/UI project)
The generated interface must look professionally designed, not generic:
- Clear visual hierarchy, consistent spacing, modern typography
- A cohesive color system with a single accent; avoid plain boxes and heavy borders
- Responsive layout (mobile + desktop) and sensible empty/loading/error states
- Subtle, tasteful micro-interactions (hover/focus transitions)
- Accessibility: semantic HTML, labels for inputs, sufficient contrast, keyboard focus
Aim for a result comparable to Linear / Vercel / Stripe in polish.`;

function isUiProject(projectType: string, task: string): boolean {
  if (/static-web|react|nextjs|vue|svelte/.test(projectType)) return true;
  return /\b(ui|ux|page|website|web app|landing|dashboard|component|frontend|html|css|หน้าเว็บ|เว็บ|หน้าจอ)\b/i.test(task);
}

function buildCritique(valLogs: string[], blocking: ReviewIssue[]): string {
  const lines: string[] = [];
  if (valLogs.length) lines.push('Validation failures:', ...valLogs.map((l) => `- ${l}`));
  if (blocking.length) lines.push('Blocking review issues:', ...blocking.map((b) => `- [${b.severity}] ${b.file}: ${b.message}`));
  return lines.join('\n');
}
