// Ypertatos tier dispatcher.
//
// Low  → single capability-matched agent, no dependency graph: delegates to
//        the existing TMAP orchestrator (core/orchestrator.ts) unchanged.
// Normal → dependency-ordered, parallel-where-independent domain agents on
//        the v2 DAG engine, merged by a Result Integrator, then Validator +
//        Reviewer.
// High → same as Normal, plus a Quality Gate (plan-coverage + placeholder
//        detection) correction loop before Validator.
//
// The tier actually run is resolved from BOTH the requested `effort` and
// classifyEngineering()'s own suggestion — classification can only escalate
// (never downgrade) the effort-requested tier, implementing the spec's
// "escalate automatically" rules as live behaviour, not just logging.

import { randomUUID } from 'node:crypto';
import type { Blackboard, CodeFile, Role } from '../types.js';
import { bagFromEnv } from '../config.js';
import { globalHealth } from '../dars/health.js';
import { chatWithDARS } from '../dars/run.js';
import { classifyTask } from './classifier.js';
import {
  classifyEngineering, domainFromPath, type EngineeringClassification, type EngineeringDomain,
} from './engineering-classifier.js';
import { runTMAP, type RunOpts } from './orchestrator.js';
import { runArchitect, architectToContext } from './architect.js';
import { runPlanner, runReviewer, parseCodeBlocks } from './agents.js';
import { validateFiles } from './validator.js';
import { persist } from './blackboard.js';
import {
  estimateTokens, estimateCost, CostMonitor, defaultBudget, isBudgetError,
} from './cost-budget.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { runCostResourceManager } from './cost-resource-manager.js';
import { runSelfReflection } from './self-reflection.js';
import type { EngineeringQualityReport } from './quality-gate.js';

import { getAgent } from '../v2/registry.js';
import { buildDomainGraph, domainGraphMaxParallel, type DomainAgentRunner } from '../v2/domain-graph.js';
import { ExecutionContextBus } from '../v2/context-bus.js';
import { EventBus } from '../v2/events.js';
import { TraceRecorder } from '../v2/trace.js';
import { Logger } from '../v2/logger.js';
import { executeGraph, type ExecOptions } from '../v2/executor.js';
import { saveCheckpoint, loadCheckpoint, applyCheckpoint } from '../v2/checkpoint.js';
import { integrateResults } from '../v2/result-integrator.js';
import { runQualityGateLoop } from '../v2/quality-gate-loop.js';

export type YpertatosEffort = 'low' | 'normal' | 'high' | 'ultra' | 'extreme';
export type YpertatosTier = 'low' | 'normal' | 'high' | 'ultra' | 'extreme';

const YPERTATOS_EFFORTS: YpertatosEffort[] = ['low', 'normal', 'high', 'ultra', 'extreme'];

type Emit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

/** Coerce an untrusted request value to a real Ypertatos effort level. */
export function normalizeYpertatosEffort(v: unknown): YpertatosEffort {
  return typeof v === 'string' && (YPERTATOS_EFFORTS as string[]).includes(v)
    ? (v as YpertatosEffort)
    : 'normal';
}

const TIER_RANK: Record<YpertatosTier, number> = { low: 0, normal: 1, high: 2, ultra: 3, extreme: 4 };

/** Ultra and Extreme run the same domain-graph pipeline as High (never LESS
 *  machinery than High) plus their own spec-mandated additions: Ultra adds
 *  the Cost & Resource Manager pre-orchestration budget estimate (Master
 *  Prompt Part 5.10); Extreme adds CRM plus a Self Reflection Engine pass
 *  before Review (Part 5.11). Neither invents new domain-agent behaviour. */
function effortBaselineTier(effort: YpertatosEffort): YpertatosTier {
  if (effort === 'low') return 'low';
  if (effort === 'normal') return 'normal';
  if (effort === 'high') return 'high';
  if (effort === 'ultra') return 'ultra';
  return 'extreme';
}

function resolveTier(effort: YpertatosEffort, suggested: YpertatosTier): YpertatosTier {
  const baseline = effortBaselineTier(effort);
  return TIER_RANK[suggested] > TIER_RANK[baseline] ? suggested : baseline;
}

/** Entry point for a Ypertatos ('pro' mode) build. Resolves the effective
 *  tier from effort + live engineering classification, then dispatches. */
export async function runYpertatos(
  bb: Blackboard,
  emit: Emit,
  runOpts: RunOpts,
  effort: YpertatosEffort,
  resumeRequestId?: string,
): Promise<Blackboard> {
  const classification = classifyTask(bb.task);
  const engineering = classifyEngineering(bb.task, classification);
  const baseline = effortBaselineTier(effort);
  const tier = resolveTier(effort, engineering.suggestedTier);

  emit(
    'system',
    `ypertatos: effort=${effort} → tier=${tier}` +
      (tier !== baseline
        ? ` (escalated from classifier: ${engineering.escalationReasons.join('; ')})`
        : '') +
      ` · domain(s)=${engineering.domains.length ? engineering.domains.join(', ') : 'unspecified'}`,
    'status',
  );

  if (tier === 'low') return runYpertatosLow(bb, emit, runOpts, engineering);
  return runYpertatosNormal(bb, emit, runOpts, engineering, {
    qualityGate: tier !== 'normal',
    selfReflection: tier === 'extreme',
    effort,
    resumeRequestId,
  });
}

// ── Ypertatos Low ────────────────────────────────────────────────────────────

async function runYpertatosLow(
  bb: Blackboard,
  emit: Emit,
  runOpts: RunOpts,
  engineering: EngineeringClassification,
): Promise<Blackboard> {
  if (engineering.domains.length) {
    const focus =
      '## Ypertatos — Engineering Focus\n' +
      `This build has been classified under the following engineering domain(s): ` +
      `${engineering.domains.join(', ')}. Concentrate the implementation on these concerns ` +
      'and keep changes scoped to them unless the task clearly requires more.';
    bb.context = [bb.context, focus].filter(Boolean).join('\n\n');
  }
  return runTMAP(bb, emit, runOpts);
}

// ── Ypertatos Normal / High (shared pipeline) ────────────────────────────────

const DOMAIN_FRAMING: Record<EngineeringDomain, string> = {
  backend: 'Own the server-side logic: routes, controllers, services, business logic, auth. ' +
    'Do not write UI code or raw SQL migrations — those belong to other agents.',
  frontend: 'Own the UI: components, pages, styling, client-side state. Call the backend API by ' +
    'its documented contract; do not implement backend logic yourself.',
  database: 'Own the data layer: schema, migrations, queries. Do not write application/business logic.',
  testing: 'Own automated tests for the files other domains have already produced (see below). ' +
    'Write real assertions against real behaviour — never a test that trivially always passes.',
  documentation: 'Own documentation (README / usage notes) for what the other domains already ' +
    'built. Describe what was actually produced — do not invent unbuilt functionality.',
  infrastructure: 'Own build/deploy/CI config, containerization, environment setup. Do not write ' +
    'application logic.',
};

const QUALITY_BAR = [
  'QUALITY BAR (non-negotiable):',
  '- Production-ready: no TODOs, no placeholders, no "// implement later". Ship complete files.',
  '- Error handling: validate inputs, handle failure paths, never swallow errors silently.',
  '- Type safety: in typed languages use explicit types; avoid "any".',
  '- Consistency: match the conventions and tech stack given in the plan/context.',
].join('\n');

function domainSystemPrompt(domain: EngineeringDomain): string {
  return [
    `You are the ${domain.toUpperCase()} engineering agent in Coagentix Code's Ypertatos pipeline.`,
    DOMAIN_FRAMING[domain],
    QUALITY_BAR,
    'For EACH file output a fenced block whose info string is the file path, e.g.:\n' +
      '```path=src/main.js\n<full file content>\n```\nOutput only code blocks. No explanation before or after.',
  ].join('\n\n');
}

interface NormalOpts {
  qualityGate: boolean;
  /** Extreme only: run the Self Reflection Engine pass before Review (Part 5.11). */
  selfReflection: boolean;
  effort: YpertatosEffort;
  resumeRequestId?: string;
}

async function runYpertatosNormal(
  bb: Blackboard,
  emit: Emit,
  runOpts: RunOpts,
  engineering: EngineeringClassification,
  opts: NormalOpts,
): Promise<Blackboard> {
  const creds = runOpts.creds ?? bagFromEnv();
  const health = runOpts.health ?? globalHealth;
  const requestId = opts.resumeRequestId ?? bb.sessionId ?? randomUUID();
  const logger = new Logger(requestId);
  const trace = new TraceRecorder(requestId, logger);
  const budget = new CostMonitor(defaultBudget(runOpts.budget));

  // Workflow event bus — constructed here (earlier than its historical
  // position, right before executeGraph()) so callFor() below can route
  // Budget Enforcer's (Part 6.8.1) graduated warning/critical/exceeded
  // events onto it too, not just the domain graph's own node_*/replan_*
  // events. Nothing emits on it until executeGraph() runs, so this
  // reordering changes nothing about domain-graph event delivery.
  const wfBus = new EventBus();
  wfBus.onAny((e) => {
    if (e.type === 'node_start') emit(e.nodeId, `${e.nodeId} agent starting`, 'status');
    else if (e.type === 'node_complete') emit(e.nodeId, `${e.nodeId} agent done`, 'status');
    else if (e.type === 'node_fail') emit(e.nodeId, `${e.nodeId} agent failed: ${e.error}`, 'error');
    else if (e.type === 'replan_triggered') emit('system', `replanning ${e.nodeId ?? 'node'}: ${e.reason}`, 'status');
    else if (e.type === 'budget_warning' || e.type === 'budget_critical' || e.type === 'budget_exceeded') {
      const level = e.type.slice(7); // 'warning' | 'critical' | 'exceeded'
      emit('system', `budget ${level}: ${e.category} at ${Math.round(e.ratio * 100)}%`, level === 'exceeded' ? 'error' : 'status');
      // Observability & Telemetry Platform (Master Prompt 6.9): budget
      // transitions land in the SAME structured, persisted record every
      // node/agent/cost/failure event already does (logSystem's meta is
      // freeform, so this needs no new LogCategory — see logger.ts).
      logger.logSystem(`budget ${level}`, { category: e.category, ratio: e.ratio, level });
    }
  });
  // Budget Enforcer (Master Prompt 6.8.1): graduated classification layered
  // on the SAME CostMonitor, now with a real EventBus to publish transitions
  // on. precheckWithEnforcement() still throws the identical
  // BudgetExceededError precheck() always did.
  const budgetEnforcer = new BudgetEnforcer(budget, wfBus);

  if (opts.effort === 'ultra' || opts.effort === 'extreme') {
    runCostResourceManager(
      bb,
      engineering.domains.length ? engineering.domains : ['backend'],
      opts.effort,
      budget.limits,
      emit,
    );
  }

  const callFor = (role: Role) => async (
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    callOpts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
  ): Promise<string> => {
    budgetEnforcer.precheckWithEnforcement();
    const r = await chatWithDARS(role, messages, callOpts, {
      creds, health, emit: () => {}, sessionId: bb.sessionId,
    });
    const inputTokens = r.usage?.inputTokens ?? estimateTokens(messages.reduce((s, m) => s + m.content, ''));
    const outputTokens = r.usage?.outputTokens ?? estimateTokens(r.text);
    budget.record(r.provider.model, inputTokens, outputTokens);
    bb.agentRuns = bb.agentRuns ?? [];
    bb.agentRuns.push({ role, provider: r.provider.providerName, model: r.provider.model, attempts: r.attempts, ts: Date.now() });
    await runOpts.onAgentCall?.(bb.sessionId, {
      role, provider: r.provider.providerName, model: r.provider.model, attempts: r.attempts,
      inputTokens, outputTokens, costUsd: estimateCost(r.provider.model, inputTokens, outputTokens), durationMs: 0,
    });
    return r.text;
  };

  await runOpts.onSessionStart?.(bb.sessionId);
  let status: 'done' | 'error' = 'done';

  try {
    // Architect — design + new/modify file decision before the domain agents run.
    emit('architect', 'designing architecture', 'status');
    const decision = await runArchitect(callFor('architect'), bb);
    bb.architect = decision;
    bb.context = [bb.context, architectToContext(decision)].filter(Boolean).join('\n\n');
    emit('architect', decision.raw, 'output');

    // Now that the Architect has named concrete files, re-classify domains
    // against them — a much stronger signal than the raw task text alone.
    let domains = engineering.domains;
    const widened = classifyEngineering(bb.task, classifyTask(bb.task), { architect: decision });
    if (widened.domains.length) domains = widened.domains;
    if (!domains.length) domains = ['backend'];

    // Planner — full TMAP-style file-level plan; also what Quality Gate checks coverage against.
    emit('planner', 'planning', 'status');
    const plannerResult = await runPlanner(callFor('planner'), bb);
    bb.plan = plannerResult.steps;
    bb.planText = plannerResult.raw;
    emit('planner', plannerResult.raw, 'output');

    // Execution Context Bus — shared facts every domain agent can read
    // without needing a direct graph dependency on whoever published them.
    const bus = new ExecutionContextBus();
    bus.publish('architecture', architectToContext(decision), 'architect');

    const runDomainAgent: DomainAgentRunner = async (domain, agentId, priorFiles, signal, awm, ctxBus) => {
      const role = getAgent(agentId)?.role ?? 'coder';
      awm.note(`${domain}: building system prompt`);
      const priorText = priorFiles.length
        ? 'Files already produced by earlier domains — extend/reuse them, do not duplicate:\n' +
          priorFiles.map((f) => `\`\`\`path=${f.path}\n${f.content}\n\`\`\``).join('\n\n')
        : '';
      const userMsg = [
        `Task: ${bb.task}`,
        `Plan:\n${bb.planText}`,
        ctxBus.toContext(),
        priorText,
      ].filter(Boolean).join('\n\n');
      const raw = await callFor(role)(
        [
          { role: 'system', content: domainSystemPrompt(domain) },
          { role: 'user', content: userMsg },
        ],
        { temperature: 0.2, maxTokens: 4096, signal },
      );
      const files = parseCodeBlocks(raw);
      awm.addSymbols(files.map((f) => f.path));
      return files;
    };

    const graph = buildDomainGraph(requestId, domains, runDomainAgent, bus);

    if (opts.resumeRequestId) {
      const ckpt = loadCheckpoint(opts.resumeRequestId);
      if (ckpt) {
        applyCheckpoint(graph, ckpt);
        emit('system', `resumed from checkpoint ${opts.resumeRequestId} (${ckpt.nodes.filter((n) => n.status === 'done').length}/${ckpt.nodes.length} domain(s) already done)`, 'status');
      }
    }

    const execOpts: ExecOptions = {
      maxParallel: domainGraphMaxParallel(domains.length, opts.qualityGate),
      maxReplans: 2,
      onProgress: (g) => { saveCheckpoint(g).catch(() => {}); },
    };

    await executeGraph(graph, trace, wfBus, execOpts);

    let files: CodeFile[];
    let qualityGateReport: EngineeringQualityReport | undefined;
    if (opts.qualityGate) {
      const loopResult = await runQualityGateLoop({
        graph, domainOrder: domains, plan: bb.plan, trace, bus: wfBus, execOpts, emit,
      });
      files = loopResult.files;
      qualityGateReport = loopResult.report;
      if (!loopResult.report.readyForValidation) {
        bb.failureNotes = bb.failureNotes ?? [];
        bb.failureNotes.push(...loopResult.report.criticalErrors);
      }
    } else {
      const integration = integrateResults(graph, domains);
      files = integration.files;
      if (integration.conflicts.length) {
        emit('system', `result integrator: resolved ${integration.conflicts.length} path conflict(s) — ${integration.conflicts.map((c) => c.path).join(', ')}`, 'status');
      }
    }

    bb.files = files;
    emit('coder', `produced ${bb.files.length} file(s): ${bb.files.map((f) => f.path).join(', ')}`, 'output');

    // Validate — real toolchain syntax checks, reused as-is.
    emit('validator', 'validating (grounded)', 'status');
    bb.validations = validateFiles(bb.files);
    for (const v of bb.validations) {
      emit('validator', `${v.passed ? 'PASS' : 'FAIL'} — ${v.logs}`, v.passed ? 'output' : 'error');
    }

    // Self Reflection Engine — Extreme only, read-only inspection before Review.
    if (opts.selfReflection) {
      const reflection = runSelfReflection({
        files: bb.files, plan: bb.plan, domains, qualityGate: qualityGateReport, domainByFile: domainFromPath,
      });
      bb.selfReflection = reflection;
      emit('reflection', reflection.summary, 'status');
      for (const f of reflection.findings) {
        emit('reflection', `[${f.severity}/${f.category}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.message}`, f.severity === 'critical' ? 'error' : 'output');
      }
    }

    // Review — formatting/readability pass, reused as-is.
    emit('reviewer', 'reviewing', 'status');
    const review = await runReviewer(callFor('reviewer'), bb);
    bb.review = review.issues;
    bb.reviewText = review.raw;
    emit('reviewer', review.raw, 'output');

    bb.iterations = 1;
  } catch (e) {
    if (isBudgetError(e)) {
      emit('system', `budget reached (${(e as Error).message}) — returning best result so far`, 'status');
    } else {
      status = 'error';
      throw e;
    }
  } finally {
    const path = persist(bb);
    emit('system', `done — session saved: ${path}`, 'status');
    await runOpts.onSessionEnd?.(bb.sessionId, {
      filesCount: bb.files.length, iterations: bb.iterations, status,
      costUsd: budget.cost, tokensUsed: budget.tokens,
    });
    await trace.persist();
  }

  return bb;
}

// domainFromPath is re-exported for callers (e.g. tests) that want to map a
// produced file back to the domain most likely responsible for it, without
// importing engineering-classifier.ts directly.
export { domainFromPath };
