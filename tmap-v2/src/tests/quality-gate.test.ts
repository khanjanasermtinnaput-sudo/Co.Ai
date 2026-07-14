import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQualityGate } from '../core/quality-gate.js';
import { domainFromPath } from '../core/engineering-classifier.js';
import type { CodeFile, PlanStep, ValidationResult } from '../types.js';

const plan: PlanStep[] = [
  { file: 'src/routes/login.ts', action: 'create', intent: 'login route' },
  { file: 'migrations/001_users.sql', action: 'create', intent: 'users table' },
];

function file(path: string, content: string): CodeFile {
  return { path, language: path.endsWith('.ts') ? 'typescript' : path.endsWith('.sql') ? 'sql' : 'text', content };
}

test('runQualityGate: full coverage, no placeholders → ready for validation', () => {
  const files: CodeFile[] = [
    file('src/routes/login.ts', 'export function login() { return true; }\n'),
    file('migrations/001_users.sql', 'CREATE TABLE users (id INT);\n'),
  ];
  const report = runQualityGate({ plan, files, validations: [], domainByFile: domainFromPath, cycle: 1 });
  assert.equal(report.coveragePct, 100);
  assert.equal(report.missingFiles.length, 0);
  assert.equal(report.placeholders.length, 0);
  assert.equal(report.readyForValidation, true);
});

test('runQualityGate: missing planned file drops coverage and blocks readiness', () => {
  const files: CodeFile[] = [file('src/routes/login.ts', 'export function login() { return true; }\n')];
  const report = runQualityGate({ plan, files, validations: [], domainByFile: domainFromPath, cycle: 1 });
  assert.equal(report.coveragePct, 50);
  assert.deepEqual(report.missingFiles, ['migrations/001_users.sql']);
  assert.equal(report.readyForValidation, false);
  assert.ok(report.taskCoverage.find((t) => t.file === 'migrations/001_users.sql')?.status === 'missing');
});

test('runQualityGate: detects TODO/FIXME/Coming Soon/mock markers', () => {
  const files: CodeFile[] = [
    file('src/routes/login.ts', '// TODO: implement real auth\nexport function login() {}\n'),
    file('migrations/001_users.sql', '-- FIXME: add indexes\nCREATE TABLE users (id INT);\n'),
  ];
  const report = runQualityGate({ plan, files, validations: [], domainByFile: domainFromPath, cycle: 1 });
  assert.ok(report.placeholders.some((p) => p.kind === 'TODO'));
  assert.ok(report.placeholders.some((p) => p.kind === 'FIXME'));
  assert.equal(report.readyForValidation, false);
});

test('runQualityGate: detects an empty function body via AST', () => {
  const files: CodeFile[] = [
    file('src/routes/login.ts', 'export function login() {\n}\n'),
    file('migrations/001_users.sql', 'CREATE TABLE users (id INT);\n'),
  ];
  const report = runQualityGate({ plan, files, validations: [], domainByFile: domainFromPath, cycle: 1 });
  assert.ok(report.placeholders.some((p) => p.kind === 'EMPTY_FUNCTION'));
});

test('runQualityGate: does not flag a normal HTML placeholder attribute as a placeholder finding', () => {
  const files: CodeFile[] = [
    file('src/components/Login.tsx', 'export const Login = () => <input placeholder="Enter your name" />;\n'),
  ];
  const report = runQualityGate({ plan: [], files, validations: [], domainByFile: domainFromPath, cycle: 1 });
  assert.equal(report.placeholders.filter((p) => p.file === 'src/components/Login.tsx').length, 0);
});

test('runQualityGate: carries forward failed validations as minor errors without blocking on its own', () => {
  const files: CodeFile[] = [file('src/routes/login.ts', 'export function login() { return true; }\n')];
  const validations: ValidationResult[] = [{ kind: 'syntax', passed: false, logs: 'src/routes/login.ts: syntax error' }];
  const report = runQualityGate({ plan: [], files, validations, domainByFile: domainFromPath, cycle: 2 });
  assert.deepEqual(report.minorErrors, ['src/routes/login.ts: syntax error']);
  assert.equal(report.cycle, 2);
});
