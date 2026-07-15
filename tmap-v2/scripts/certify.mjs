#!/usr/bin/env node
// Certification runner (Master Prompt 6.13). Spawns scripts/test.mjs's own
// hermetic offline pattern once per test layer (never live, never billed —
// same NODE_ENV=test discipline), collects EXIT CODES (never parses TAP
// output — stable across Node versions), computes a real pass-rate quality
// signal, and asks Certifier (pure logic, src/v2/certification/certifier.ts)
// to compute + persist a CertificationReport.
//
// Run through tsx (not plain node) because it imports the TypeScript
// certification modules directly.
//
// Usage:
//   npm run certify

import { spawnSync } from 'node:child_process';
import { TEST_LAYERS } from '../src/v2/certification/test-layers.ts';
import { globalCertifier } from '../src/v2/certification/certifier.ts';

function runLayer(spec) {
  const t0 = Date.now();
  const env = { ...process.env, NODE_ENV: 'test' };
  delete env.COAGENTIX_ALLOW_LIVE;
  const r = spawnSync('npx', ['tsx', '--test', ...spec.files], { stdio: 'pipe', shell: true, env });
  const durationMs = Date.now() - t0;
  const exitCode = r.status ?? 1;
  const passed = exitCode === 0;
  if (!passed) {
    process.stdout.write(`\n--- ${spec.layer} FAILED (exit ${exitCode}) ---\n`);
    process.stdout.write((r.stdout?.toString() ?? '') + (r.stderr?.toString() ?? ''));
  }
  return { layer: spec.layer, passed, exitCode, durationMs, fileCount: spec.files.length };
}

function main() {
  console.log(`[certify] running ${TEST_LAYERS.length} test layers (offline, hermetic)...`);
  const layers = [];
  for (const spec of TEST_LAYERS) {
    process.stdout.write(`[certify] ${spec.layer} (${spec.files.length} file(s))... `);
    const result = runLayer(spec);
    console.log(result.passed ? `ok (${result.durationMs}ms)` : `FAIL (${result.durationMs}ms)`);
    layers.push(result);
  }

  const passedLayers = layers.filter((l) => l.passed).length;
  const quality = {
    score: Math.round((passedLayers / layers.length) * 100),
    source: 'test-pass-rate',
  };

  const report = globalCertifier.computeReport(layers, quality);
  globalCertifier.persist(report).then(() => {
    console.log('\n[certify] ' + '='.repeat(60));
    console.log(`[certify] certificationId : ${report.certificationId}`);
    console.log(`[certify] runtimeVersion  : ${report.runtimeVersion}`);
    console.log(`[certify] qualityScore    : ${report.qualityScore} (${report.qualitySource}) — grade ${report.grade}`);
    for (const g of report.gates) {
      console.log(`[certify] gate ${g.passed ? 'PASS' : 'FAIL'} — ${g.name}: ${g.detail}`);
    }
    console.log(`[certify] CERTIFIED: ${report.certified}`);
    console.log('[certify] ' + '='.repeat(60));
    process.exit(report.certified ? 0 : 1);
  });
}

main();
