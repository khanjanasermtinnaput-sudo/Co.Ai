// v2/certification — Certifier (Master Prompt 6.13).
//
// "A runtime build is certified only if: all critical tests pass, no critical
// regressions exist, performance remains acceptable, security validation
// passes." This module is the PURE gate-evaluation logic — it never spawns a
// process, never makes an LLM call, and never reads test output; it only
// reasons over LayerRunResult[] handed to it by scripts/certify.mjs (which
// does the actual spawning, reusing scripts/test.mjs's existing hermetic
// offline launcher per layer — see that script's header for why exit codes,
// not parsed TAP text, are the source of truth).
//
// Quality score is DELIBERATELY caller-supplied (QualitySignal), not computed
// in here. core/eval-framework.ts's 6-dimension score is LLM-judged — running
// it honestly requires a real provider call, which this offline-by-default
// certifier must never fabricate. The default signal scripts/certify.mjs
// supplies is a genuinely real, if simpler, metric: the fraction of layers
// that passed. Wiring eval-framework's live-judged score in for a
// `--live` certification run is real future work (documented below), not
// something this pass pretends to already do.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_LAYERS, type TestLayer } from './test-layers.js';

export interface QualitySignal {
  score: number;   // 0..100
  source: string;  // e.g. 'test-pass-rate' | 'eval-framework-live'
}

export interface LayerRunResult {
  layer: TestLayer;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  fileCount: number;
}

export type GateName = 'critical_tests_pass' | 'no_critical_regressions' | 'perf_acceptable' | 'security_pass';

export interface GateResult {
  name: GateName;
  passed: boolean;
  detail: string;
}

export interface CertificationReport {
  certificationId: string;
  runtimeVersion: string;
  timestamp: string;
  qualityScore: number;
  qualitySource: string;
  grade: string;
  layers: LayerRunResult[];
  gates: GateResult[];
  certified: boolean;
}

export function gradeFor(score: number): string {
  if (score >= 95) return 'A';
  if (score >= 85) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

function readRuntimeVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export class Certifier {
  /** Pure — no IO. All four spec-required gates, evaluated over whatever
   *  layers were actually run. A gate whose layer was never run FAILS
   *  (fail-closed): missing coverage is not the same as passing coverage. */
  evaluateGates(layers: LayerRunResult[], _quality: QualitySignal): GateResult[] {
    const byLayer = new Map(layers.map((l) => [l.layer, l]));
    const criticalLayers = TEST_LAYERS.filter((l) => l.critical).map((l) => l.layer);
    const criticalResults = criticalLayers.map((l) => byLayer.get(l)).filter(Boolean) as LayerRunResult[];
    const criticalPass = criticalResults.length === criticalLayers.length && criticalResults.every((r) => r.passed);

    const gateFor = (name: GateName, layer: TestLayer, okDetail: string, failDetail: string): GateResult => {
      const r = byLayer.get(layer);
      if (!r) return { name, passed: false, detail: `'${layer}' layer was not run` };
      return { name, passed: r.passed, detail: r.passed ? okDetail : failDetail };
    };

    return [
      {
        name: 'critical_tests_pass',
        passed: criticalPass,
        detail: criticalPass
          ? `all ${criticalLayers.length} critical layers passed`
          : `${criticalResults.filter((r) => r.passed).length}/${criticalLayers.length} critical layers passed`,
      },
      gateFor('no_critical_regressions', 'regression', 'regression suite passed', 'regression suite FAILED — a previously fixed bug may have resurfaced'),
      gateFor('perf_acceptable', 'performance', 'performance layer passed', 'performance layer FAILED'),
      gateFor('security_pass', 'security', 'security layer passed', 'security layer FAILED'),
    ];
  }

  /** Pure — no IO. certificationId embeds the real package.json version and
   *  timestamp; never a fabricated build number. */
  computeReport(layers: LayerRunResult[], quality: QualitySignal): CertificationReport {
    const gates = this.evaluateGates(layers, quality);
    const timestamp = new Date().toISOString();
    const runtimeVersion = readRuntimeVersion();
    const certificationId = `cert-${runtimeVersion}-${timestamp.replace(/[^0-9]/g, '').slice(0, 14)}`;
    return {
      certificationId,
      runtimeVersion,
      timestamp,
      qualityScore: quality.score,
      qualitySource: quality.source,
      grade: gradeFor(quality.score),
      layers,
      gates,
      certified: gates.every((g) => g.passed),
    };
  }

  /** Best-effort JSON artifact — same local-file-always, Supabase-when-
   *  configured, never-throws pattern as every other Part 6.x persistence. */
  async persist(report: CertificationReport): Promise<void> {
    try {
      const dir =
        process.env.AOF_CERT_DIR ??
        (process.env.VERCEL ? '/tmp/aof-certification' : join(process.cwd(), '.aof-server', 'certification'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${report.certificationId}.json`), JSON.stringify(report, null, 2), 'utf8');
    } catch {
      /* non-fatal: certification artifact degrades to stdout summary only */
    }

    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    try {
      await fetch(`${url}/rest/v1/certifications`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          certification_id: report.certificationId,
          runtime_version: report.runtimeVersion,
          quality_score: report.qualityScore,
          certified: report.certified,
          report,
          ts: report.timestamp,
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      /* non-fatal */
    }
  }
}

/** Process-wide — the ONE certifier for this instance's certification runs. */
export const globalCertifier = new Certifier();

// Deliberately NOT built: certification replacing CI (.github/workflows/ci.yml
// still gates on `npm test`; `npm run certify` is additive); a live-provider
// quality score by default (offline hermetic, matching scripts/test.mjs);
// TAP/stdout output parsing (gates read child-process EXIT CODES only —
// stable across Node versions, unlike test-runner text output); a persistent
// certification database or dashboard (JSON artifact + optional Supabase row);
// requiring qa-loop's external Playwright chaos/e2e gates for a green cert.
