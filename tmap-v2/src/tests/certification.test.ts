// Certification Framework (Master Prompt 6.13) tests.
//
// Pure logic ONLY — never spawns scripts/test.mjs or scripts/certify.mjs.
// Spawning suites from inside a suite would be exactly the recursion risk
// certifier.ts's header explains Certifier is structurally incapable of
// (it has no spawn capability at all); this file keeps it that way.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Certifier, gradeFor, type LayerRunResult, type QualitySignal } from '../v2/certification/certifier.js';
import { TEST_LAYERS, allLayerFiles } from '../v2/certification/test-layers.js';

function allPassLayers(): LayerRunResult[] {
  return TEST_LAYERS.map((l) => ({ layer: l.layer, passed: true, exitCode: 0, durationMs: 10, fileCount: l.files.length }));
}

const goodQuality: QualitySignal = { score: 100, source: 'test-pass-rate' };

describe('Certifier.evaluateGates', () => {
  const certifier = new Certifier();

  test('all layers passing + acceptable quality ⇒ all four gates pass, certified:true', () => {
    const report = certifier.computeReport(allPassLayers(), goodQuality);
    assert.equal(report.gates.length, 4);
    assert.ok(report.gates.every((g) => g.passed));
    assert.equal(report.certified, true);
  });

  test('a failing critical layer (e.g. workflow) fails critical_tests_pass ⇒ certified:false', () => {
    const layers = allPassLayers().map((l) => (l.layer === 'workflow' ? { ...l, passed: false, exitCode: 1 } : l));
    const gates = certifier.evaluateGates(layers, goodQuality);
    const critical = gates.find((g) => g.name === 'critical_tests_pass');
    assert.equal(critical?.passed, false);
    assert.equal(certifier.computeReport(layers, goodQuality).certified, false);
  });

  test('a failing regression layer fails no_critical_regressions specifically, other gates unaffected', () => {
    const layers = allPassLayers().map((l) => (l.layer === 'regression' ? { ...l, passed: false, exitCode: 1 } : l));
    const gates = certifier.evaluateGates(layers, goodQuality);
    assert.equal(gates.find((g) => g.name === 'no_critical_regressions')?.passed, false);
    assert.equal(gates.find((g) => g.name === 'critical_tests_pass')?.passed, true);
    assert.equal(gates.find((g) => g.name === 'perf_acceptable')?.passed, true);
    assert.equal(gates.find((g) => g.name === 'security_pass')?.passed, true);
  });

  test('a missing layer (never run) fails its gate — fail-closed, not vacuously true', () => {
    const layers = allPassLayers().filter((l) => l.layer !== 'security');
    const gates = certifier.evaluateGates(layers, goodQuality);
    const sec = gates.find((g) => g.name === 'security_pass');
    assert.equal(sec?.passed, false);
    assert.match(sec!.detail, /not run/);
  });
});

describe('Certifier.computeReport', () => {
  const certifier = new Certifier();

  test('certificationId embeds the real package.json runtimeVersion', () => {
    const report = certifier.computeReport(allPassLayers(), goodQuality);
    assert.ok(report.certificationId.includes(report.runtimeVersion));
    assert.notEqual(report.runtimeVersion, '');
  });

  test('grade mapping is monotonic in score', () => {
    const scores = [10, 40, 60, 80, 96];
    const grades = scores.map(gradeFor);
    const rank = ['F', 'D', 'C', 'B', 'A'];
    const ranks = grades.map((g) => rank.indexOf(g));
    for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] >= ranks[i - 1], `grade must not regress as score rises: ${scores} -> ${grades}`);
  });

  test('regression: computeReport on identical injected layers is identical modulo timestamp/certificationId', () => {
    const layers = allPassLayers();
    const a = certifier.computeReport(layers, goodQuality);
    const b = certifier.computeReport(layers, goodQuality);
    const strip = ({ timestamp, certificationId, ...rest }: typeof a) => rest;
    assert.deepEqual(strip(a), strip(b));
  });
});

describe('TEST_LAYERS catalog — drift guard', () => {
  test('every file every layer references actually exists on disk', () => {
    for (const spec of TEST_LAYERS) {
      assert.ok(spec.files.length > 0, `layer '${spec.layer}' has no files`);
      for (const f of spec.files) {
        assert.ok(existsSync(join(process.cwd(), f)), `layer '${spec.layer}' references missing file: ${f}`);
      }
    }
  });

  test('every *.test.ts file in src/tests/ is mapped to exactly one layer', () => {
    const dir = join(process.cwd(), 'src', 'tests');
    const onDisk = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => `src/tests/${f}`);
    const mapped = allLayerFiles();
    const mappedSet = new Set(mapped);

    const unmapped = onDisk.filter((f) => !mappedSet.has(f));
    assert.deepEqual(unmapped, [], `unmapped test file(s) — add to TEST_LAYERS: ${unmapped.join(', ')}`);

    const seen = new Set<string>();
    const duplicates = mapped.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    assert.deepEqual(duplicates, [], `test file(s) mapped to more than one layer: ${duplicates.join(', ')}`);
  });
});
