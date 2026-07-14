// v2 — Quality Gate correction loop (Ypertatos High).
//
// Wraps runQualityGate() around re-execution of ONLY the domain nodes the
// report says are incomplete. Relies on executeGraph()'s already-existing
// resume behavior (re-running it on the same graph only re-runs non-`done`
// nodes) — this loop's entire job is to flip the right nodes back to
// `pending` before calling it again; no new re-run machinery needed. Capped
// at MAX_QUALITY_CYCLES so a report that never converges can't loop forever.

import type { CodeFile, PlanStep } from '../types.js';
import { runQualityGate, type EngineeringQualityReport } from '../core/quality-gate.js';
import { domainFromPath, type EngineeringDomain } from '../core/engineering-classifier.js';
import { validateFiles } from '../core/validator.js';
import { integrateResults } from './result-integrator.js';
import { executeGraph, type ExecOptions } from './executor.js';
import type { ExecGraph } from './dag.js';
import type { TraceRecorder } from './trace.js';
import type { EventBus } from './events.js';

export const MAX_QUALITY_CYCLES = 3;

type Emit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

export interface QualityGateLoopOpts {
  graph: ExecGraph;
  domainOrder: EngineeringDomain[];
  plan: PlanStep[];
  trace: TraceRecorder;
  bus: EventBus;
  execOpts: ExecOptions;
  emit: Emit;
}

export interface QualityGateLoopResult {
  report: EngineeringQualityReport;
  files: CodeFile[];
}

export async function runQualityGateLoop(opts: QualityGateLoopOpts): Promise<QualityGateLoopResult> {
  let files: CodeFile[] = [];
  let report: EngineeringQualityReport | undefined;

  for (let cycle = 1; cycle <= MAX_QUALITY_CYCLES; cycle++) {
    const integration = integrateResults(opts.graph, opts.domainOrder);
    files = integration.files;
    if (integration.conflicts.length) {
      opts.emit(
        'quality-gate',
        `result integrator: resolved ${integration.conflicts.length} path conflict(s) — ${integration.conflicts.map((c) => c.path).join(', ')}`,
        'status',
      );
    }

    const validations = validateFiles(files);
    report = runQualityGate({ plan: opts.plan, files, validations, domainByFile: domainFromPath, cycle });

    opts.emit(
      'quality-gate',
      `cycle ${cycle}/${MAX_QUALITY_CYCLES}: coverage ${report.coveragePct}% · ` +
        `${report.placeholders.length} placeholder(s) · ${report.missingFiles.length} missing file(s)`,
      report.readyForValidation ? 'status' : 'error',
    );

    if (report.readyForValidation) return { report, files };
    if (cycle === MAX_QUALITY_CYCLES) break;

    // Map every incomplete task / placeholder back to the domain node
    // responsible for it, and re-run ONLY those nodes — completed domains'
    // output is left untouched.
    const incompleteDomains = new Set<EngineeringDomain>();
    for (const t of report.taskCoverage) {
      if (t.status === 'missing' && t.domain) incompleteDomains.add(t.domain);
    }
    for (const p of report.placeholders) {
      const d = domainFromPath(p.file);
      if (d) incompleteDomains.add(d);
    }

    if (incompleteDomains.size === 0) {
      // Nothing maps back to a re-runnable domain (e.g. a missing file whose
      // path doesn't match any known domain pattern) — looping again would
      // burn a cycle for no possible improvement.
      opts.emit('quality-gate', 'no re-runnable domain identified for the remaining issues — stopping', 'error');
      break;
    }

    for (const domain of incompleteDomains) {
      const node = opts.graph.nodes.get(domain);
      if (node) {
        node.status = 'pending';
        node.error = undefined;
      }
    }
    opts.emit(
      'quality-gate',
      `correction cycle ${cycle + 1}/${MAX_QUALITY_CYCLES}: re-running ${[...incompleteDomains].join(', ')}`,
      'status',
    );
    await executeGraph(opts.graph, opts.trace, opts.bus, opts.execOpts);
  }

  return { report: report!, files };
}
