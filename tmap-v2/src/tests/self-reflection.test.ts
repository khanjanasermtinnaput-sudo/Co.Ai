import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSelfReflection } from '../core/self-reflection.js';
import type { CodeFile, PlanStep } from '../types.js';

function file(path: string, content: string): CodeFile {
  return { path, language: /\.tsx?$/.test(path) ? 'typescript' : 'javascript', content };
}

test('runSelfReflection: clean input produces zero findings', () => {
  // domains includes 'testing' so the "no tests generated" heuristic doesn't
  // fire — this fixture is testing the OTHER category scanners are quiet.
  const files = [file('src/routes/login.ts', "export function login() {\n  return 'ok';\n}\n")];
  const report = runSelfReflection({ files, plan: [], domains: ['backend', 'testing'] });
  assert.equal(report.findings.length, 0);
  assert.ok(report.summary.includes('no findings'));
});

test('runSelfReflection: flags hardcoded secrets and eval() as critical security findings', () => {
  const files = [file('src/server/auth.ts', [
    "const apiKey = 'sk-live-1234567890abcdef';",
    'function run(input: string) { return eval(input); }',
  ].join('\n'))];
  const report = runSelfReflection({ files, plan: [], domains: ['backend'] });
  const security = report.findings.filter((f) => f.category === 'security');
  assert.ok(security.length >= 2);
  assert.ok(security.every((f) => f.severity === 'critical'));
});

test('runSelfReflection: flags SQL string concatenation', () => {
  const files = [file('src/server/db.ts', 'const q = "SELECT * FROM users WHERE id = " + userId;')];
  const report = runSelfReflection({ files, plan: [], domains: ['database'] });
  assert.ok(report.findings.some((f) => f.category === 'security' && f.message.includes('parameterized')));
});

test('runSelfReflection: flags synchronous fs calls under a server path', () => {
  const files = [file('src/server/routes/upload.ts', "import fs from 'fs';\nfs.readFileSync('/tmp/x');")];
  const report = runSelfReflection({ files, plan: [], domains: ['backend'] });
  assert.ok(report.findings.some((f) => f.category === 'performance'));
});

test('runSelfReflection: flags large files as a maintainability concern', () => {
  const bigContent = Array.from({ length: 500 }, (_, i) => `const line${i} = ${i};`).join('\n');
  const files = [file('src/server/big.ts', bigContent)];
  const report = runSelfReflection({ files, plan: [], domains: ['backend'] });
  assert.ok(report.findings.some((f) => f.category === 'maintainability'));
});

test('runSelfReflection: surfaces Quality Gate missing files as critical requirement-coverage findings', () => {
  const plan: PlanStep[] = [{ file: 'src/a.ts', action: 'create', intent: 'x' }];
  const report = runSelfReflection({
    files: [],
    plan,
    domains: ['backend'],
    qualityGate: {
      coveragePct: 0, taskCoverage: [], placeholders: [], missingFiles: ['src/a.ts'],
      warnings: [], criticalErrors: [], minorErrors: [], suggestedCorrections: [],
      readyForValidation: false, cycle: 1,
    },
  });
  const coverage = report.findings.filter((f) => f.category === 'requirement-coverage');
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].severity, 'critical');
});

test('runSelfReflection: flags missing tests when testing was not one of the classified domains', () => {
  const files = [file('src/server/routes/login.ts', 'export function login() { return true; }')];
  const report = runSelfReflection({ files, plan: [], domains: ['backend'] });
  assert.ok(report.findings.some((f) => f.category === 'testing'));
});

test('runSelfReflection: does not flag missing tests when a test file was produced', () => {
  const files = [
    file('src/server/routes/login.ts', 'export function login() { return true; }'),
    file('src/server/routes/login.test.ts', "test('login', () => {});"),
  ];
  const report = runSelfReflection({ files, plan: [], domains: ['backend'] });
  assert.ok(!report.findings.some((f) => f.category === 'testing'));
});

test('runSelfReflection: summary counts severities correctly', () => {
  const files = [file('src/server/auth.ts', "const secret = 'abcd1234efgh5678';")];
  const report = runSelfReflection({ files, plan: [], domains: ['backend'] });
  assert.equal(report.criticalCount + report.warningCount + report.infoCount, report.findings.length);
  assert.ok(report.summary.includes(`${report.findings.length} finding`));
});
