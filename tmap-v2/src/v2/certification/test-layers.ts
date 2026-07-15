// v2/certification — Test layer taxonomy (Master Prompt 6.13).
//
// The spec names 12 test layers (unit, component, integration, workflow,
// provider, agent, tool, e2e, chaos, performance, security, regression).
// tmap-v2 already has ~49 test files under src/tests/ covering most of this
// ground, run through the existing hermetic launcher (scripts/test.mjs) — no
// file is renamed or moved. This module is purely METADATA: it assigns each
// existing file to the ONE layer it best represents (grounded in each file's
// own header comment, not guessed from the name alone), so the Certifier can
// gate on layers without a new file layout. Two real, previously-unnamed
// layers get their own new file: 'performance' (perf-runtime.test.ts) and
// — since nothing here was explicitly called "regression" before — the
// existing "Round N remediation" suites (round1/round2-*/round3-entitlements)
// are the genuine regression-lock files (each proves a specific past bug
// stays fixed; round1.test.ts's own header literally says "regression lock").
//
// 'e2e' (e2e.live.test.ts) and 'chaos' (phase6-enterprise.test.ts, which
// covers failover weighted routing / cascading cache invalidation / DR
// integration) are REAL local files, already part of `npm test` today — not
// invented for this pass. The qa-loop Playwright harness (a separate
// top-level package, hitting a live deployment) is a DIFFERENT, optional,
// external e2e/chaos gate — see certifier.ts's header for why it's not wired
// into `npm run certify` by default.

export type TestLayer =
  | 'unit'
  | 'component'
  | 'integration'
  | 'workflow'
  | 'provider'
  | 'agent'
  | 'tool'
  | 'e2e'
  | 'chaos'
  | 'performance'
  | 'security'
  | 'regression';

export interface LayerSpec {
  layer: TestLayer;
  /** File paths, relative to tmap-v2/, passed straight to scripts/test.mjs. */
  files: string[];
  /** Whether ALL files in this layer must pass for the 'critical_tests_pass'
   *  gate. performance/security/regression have their OWN dedicated gates
   *  (see certifier.ts) so they're not double-counted here. */
  critical: boolean;
}

const T = (name: string) => `src/tests/${name}`;

export const TEST_LAYERS: LayerSpec[] = [
  {
    layer: 'unit',
    critical: true,
    files: [T('logger.test.ts'), T('context.test.ts'), T('vote.test.ts'), T('preflight.test.ts'), T('debugger.test.ts'), T('memory.test.ts'), T('db.test.ts')],
  },
  {
    layer: 'component',
    critical: true,
    files: [
      T('budget-enforcer.test.ts'), T('cost-control-v2.test.ts'), T('cost-resource-manager.test.ts'),
      T('instance-pool.test.ts'), T('quality-gate.test.ts'), T('validator.test.ts'), T('self-reflection.test.ts'),
      T('kernel.test.ts'), T('recovery-engine.test.ts'), T('certification.test.ts'), T('context-engine.test.ts'),
      T('image-pipeline.test.ts'), T('image-memory.test.ts'), T('phase7-logging.test.ts'),
    ],
  },
  {
    layer: 'integration',
    critical: true,
    files: [T('orchestrator.test.ts'), T('v2-orchestrator.test.ts'), T('v2-engine.test.ts'), T('domain-graph.test.ts'), T('intelligence.test.ts'), T('v2-conversation-layer.test.ts')],
  },
  {
    layer: 'workflow',
    critical: true,
    files: [T('ypertatos.test.ts'), T('titan.test.ts'), T('raa.test.ts'), T('raa-default-routing.test.ts'), T('phase4.test.ts'), T('phase5.test.ts'), T('phase5-platform.test.ts'), T('phase6.test.ts')],
  },
  {
    layer: 'provider',
    critical: true,
    files: [T('dars-select.test.ts'), T('dars-failover-bridge.test.ts'), T('local-model-providers.test.ts')],
  },
  {
    layer: 'agent',
    critical: true,
    files: [T('agents.test.ts'), T('v2-tool-agent.test.ts')],
  },
  {
    layer: 'tool',
    critical: true,
    files: [T('tool-execution-engine.test.ts'), T('v2-tool-node-executor.test.ts')],
  },
  {
    layer: 'e2e',
    critical: false, // e2e.live.test.ts self-skips without COAGENTIX_ALLOW_LIVE; informational offline
    files: [T('e2e.live.test.ts')],
  },
  {
    layer: 'chaos',
    critical: false, // local failure-injection coverage; qa-loop's phase73 monkey/chaos is the deeper, external, optional gate
    files: [T('phase6-enterprise.test.ts')],
  },
  {
    layer: 'performance',
    critical: false, // gated separately via 'perf_acceptable' (certifier.ts), not folded into critical_tests_pass
    files: [T('perf-runtime.test.ts')],
  },
  {
    layer: 'security',
    critical: false, // gated separately via 'security_pass'
    files: [T('admin-auth.test.ts'), T('jwt-revocation.test.ts')],
  },
  {
    layer: 'regression',
    critical: false, // gated separately via 'no_critical_regressions'
    files: [T('round1.test.ts'), T('round2-quota.test.ts'), T('round2-ratelimit.test.ts'), T('round2-webhooks.test.ts'), T('round3-entitlements.test.ts')],
  },
];

export function layersFor(layer: TestLayer): string[] {
  return TEST_LAYERS.find((l) => l.layer === layer)?.files ?? [];
}

export function allLayerFiles(): string[] {
  return TEST_LAYERS.flatMap((l) => l.files);
}
