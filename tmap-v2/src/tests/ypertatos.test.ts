import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask } from '../core/classifier.js';
import { classifyEngineering } from '../core/engineering-classifier.js';
import { runYpertatos, normalizeYpertatosEffort } from '../core/ypertatos.js';
import { createBlackboard } from '../core/blackboard.js';

// ── classifyEngineering (pure) ─────────────────────────────────────────────────

test('classifyEngineering: single-domain task stays Low tier, no escalation', () => {
  const task = 'add a new React component for the settings page';
  const result = classifyEngineering(task, classifyTask(task));
  assert.deepEqual(result.domains, ['frontend']);
  assert.equal(result.suggestedTier, 'low');
  assert.equal(result.escalationReasons.length, 0);
});

test('classifyEngineering: multi-domain task escalates to Normal', () => {
  const task = 'add a new API route that queries the users database table and renders it in a React component';
  const result = classifyEngineering(task, classifyTask(task));
  assert.ok(result.domains.includes('backend'));
  assert.ok(result.domains.includes('database'));
  assert.ok(result.domains.includes('frontend'));
  assert.equal(result.suggestedTier, 'normal');
  assert.ok(result.escalationReasons.some((r) => r.includes('multiple engineering domains')));
});

test('classifyEngineering: migration/deployment language escalates to High', () => {
  const task = 'plan a large database migration and deployment across multiple services';
  const result = classifyEngineering(task, classifyTask(task));
  assert.equal(result.suggestedTier, 'high');
  assert.ok(result.escalationReasons.some((r) => r.includes('migration/deployment')));
});

test('classifyEngineering: architect-plan file paths widen detected domains', () => {
  const task = 'implement the feature';
  const result = classifyEngineering(task, classifyTask(task), {
    architect: {
      approach: '', techStack: '', risks: [], raw: '',
      newFiles: ['src/components/Widget.tsx'],
      modifyFiles: ['migrations/002_add_widgets.sql'],
    },
  });
  assert.ok(result.domains.includes('frontend'));
  assert.ok(result.domains.includes('database'));
});

test('classifyEngineering: engineeringRequired reflects coding/ui/data categories', () => {
  const codingTask = 'debug this function';
  assert.equal(classifyEngineering(codingTask, classifyTask(codingTask)).engineeringRequired, true);

  const nonCodingTask = 'write a poem about the ocean';
  assert.equal(classifyEngineering(nonCodingTask, classifyTask(nonCodingTask)).engineeringRequired, false);
});

// ── normalizeYpertatosEffort ─────────────────────────────────────────────────────

test('normalizeYpertatosEffort accepts valid levels and defaults invalid ones to normal', () => {
  assert.equal(normalizeYpertatosEffort('low'), 'low');
  assert.equal(normalizeYpertatosEffort('extreme'), 'extreme');
  assert.equal(normalizeYpertatosEffort('bogus'), 'normal');
  assert.equal(normalizeYpertatosEffort(undefined), 'normal');
  assert.equal(normalizeYpertatosEffort(42), 'normal');
});

// ── runYpertatos (integration, mock provider — no creds needed) ─────────────────

test('runYpertatos: emits a status event echoing effort and suggested tier', async () => {
  const events: string[] = [];
  const emit = (_role: string, text: string) => events.push(text);
  const bb = createBlackboard('add a new API route for user login', 'pro');
  await runYpertatos(bb, emit, { skipContext: true }, 'high');
  assert.ok(events.some((t) => t.includes('effort=high') && t.includes('ypertatos:')));
});

test('runYpertatos: Low tier still produces files via the underlying TMAP pipeline', async () => {
  const bb = createBlackboard('build a hello world function', 'pro');
  const result = await runYpertatos(bb, () => {}, { skipContext: true }, 'low');
  assert.ok(result.files.length > 0, 'ypertatos low should still produce files');
});

test('runYpertatos: Low tier injects a domain-focus block into context when a domain is detected', async () => {
  const bb = createBlackboard('add a new database migration for the orders table', 'pro');
  // Single-domain ('database') task at effort=low stays on the Low tier (no
  // escalation signal), so this exercises runYpertatosLow's context injection.
  const result = await runYpertatos(bb, () => {}, { skipContext: true }, 'low');
  assert.ok(result.context.includes('Engineering Focus'));
  assert.ok(result.context.includes('database'));
});

// ── Normal / High tier (domain graph engine) ─────────────────────────────────

test('runYpertatos: Normal tier runs the domain-graph pipeline end-to-end (architect, plan, files, review)', async () => {
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const result = await runYpertatos(bb, () => {}, { skipContext: true }, 'normal');
  assert.ok(result.architect, 'architect stage should run on Normal tier');
  assert.ok(result.plan.length > 0, 'planner should produce a plan');
  assert.ok(result.files.length > 0, 'domain agent(s) should produce files');
  assert.ok(result.reviewText.length > 0, 'reviewer should run');
  assert.equal(result.iterations, 1);
});

test('runYpertatos: multi-domain task at Low-requested effort auto-escalates to Normal', async () => {
  const events: string[] = [];
  const emit = (_role: string, text: string) => events.push(text);
  const bb = createBlackboard(
    'add a new API route that queries the users database table and renders it in a React component',
    'pro',
  );
  await runYpertatos(bb, emit, { skipContext: true }, 'low');
  const summary = events.find((t) => t.startsWith('ypertatos:'));
  assert.ok(summary?.includes('tier=normal'), `expected escalation to Normal tier, got: ${summary}`);
  assert.ok(summary?.includes('escalated from classifier'));
});

test('runYpertatos: High tier runs the Quality Gate and reports coverage', async () => {
  const events: string[] = [];
  const emit = (role: string, text: string, kind?: string) => events.push(`${role}:${kind ?? 'status'}:${text}`);
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const result = await runYpertatos(bb, emit, { skipContext: true }, 'high');
  assert.ok(result.files.length > 0, 'High tier should still produce files');
  assert.ok(events.some((e) => e.startsWith('quality-gate:') && e.includes('coverage')), 'quality gate should report coverage');
});

// ── Ultra tier (Cost & Resource Manager) ────────────────────────────────────

test('runYpertatos: Ultra tier runs the Cost & Resource Manager before orchestration and still produces files', async () => {
  const events: string[] = [];
  const emit = (role: string, text: string, kind?: string) => events.push(`${role}:${kind ?? 'status'}:${text}`);
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const result = await runYpertatos(bb, emit, { skipContext: true }, 'ultra');
  assert.ok(result.files.length > 0, 'Ultra tier should still produce files');

  const crmIndex = events.findIndex((e) => e.startsWith('crm:status:crm: tier=ultra'));
  assert.ok(crmIndex >= 0, 'CRM should log its resource allocation plan');

  const architectIndex = events.findIndex((e) => e.startsWith('architect:'));
  assert.ok(architectIndex >= 0, 'architect stage should still run');
  assert.ok(crmIndex < architectIndex, 'CRM must run before orchestration (architect) begins');

  assert.ok(events.some((e) => e.startsWith('quality-gate:') && e.includes('coverage')), 'Ultra should still run the Quality Gate (never LESS machinery than High)');
});

test('runYpertatos: Normal tier does not run the Cost & Resource Manager', async () => {
  const events: string[] = [];
  const emit = (role: string, text: string, kind?: string) => events.push(`${role}:${kind ?? 'status'}:${text}`);
  const bb = createBlackboard('add a new API route for user login', 'pro');
  await runYpertatos(bb, emit, { skipContext: true }, 'normal');
  assert.ok(!events.some((e) => e.startsWith('crm:')), 'CRM is an Ultra/Extreme-only stage');
});

// ── Extreme tier (Self Reflection Engine) ───────────────────────────────────

test('runYpertatos: Extreme tier runs CRM, Quality Gate, and Self Reflection (in that order) before Review', async () => {
  const events: string[] = [];
  const emit = (role: string, text: string, kind?: string) => events.push(`${role}:${kind ?? 'status'}:${text}`);
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const result = await runYpertatos(bb, emit, { skipContext: true }, 'extreme');

  assert.ok(result.files.length > 0, 'Extreme tier should still produce files');
  assert.ok(result.selfReflection, 'Extreme tier should record a Self Reflection report on the blackboard');
  assert.ok(result.selfReflection!.summary.startsWith('reflection:'));

  const crmIndex = events.findIndex((e) => e.startsWith('crm:status:crm: tier=extreme'));
  const qualityGateIndex = events.findIndex((e) => e.startsWith('quality-gate:') && e.includes('coverage'));
  const reflectionIndex = events.findIndex((e) => e.startsWith('reflection:status:reflection:'));
  const reviewerIndex = events.findIndex((e) => e.startsWith('reviewer:status:reviewing'));

  assert.ok(crmIndex >= 0, 'CRM should run for Extreme');
  assert.ok(qualityGateIndex >= 0, 'Extreme should still run the Quality Gate (never LESS machinery than High)');
  assert.ok(reflectionIndex >= 0, 'Self Reflection Engine should run for Extreme');
  assert.ok(reviewerIndex >= 0, 'Review should still run');
  assert.ok(crmIndex < qualityGateIndex, 'CRM must run before orchestration/Quality Gate');
  assert.ok(qualityGateIndex < reflectionIndex, 'Self Reflection runs after Quality Gate');
  assert.ok(reflectionIndex < reviewerIndex, 'Self Reflection runs before Review');
});

test('runYpertatos: Ultra tier does not run the Self Reflection Engine (Extreme-only)', async () => {
  const bb = createBlackboard('add a new API route for user login', 'pro');
  const result = await runYpertatos(bb, () => {}, { skipContext: true }, 'ultra');
  assert.equal(result.selfReflection, undefined);
});
