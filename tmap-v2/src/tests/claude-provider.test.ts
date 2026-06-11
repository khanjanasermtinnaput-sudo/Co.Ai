import { test } from 'node:test';
import assert from 'node:assert/strict';

import { modelForRole, PROVIDERS, resolveRoleWith, type CredentialBag } from '../config.js';
import { listProviderCandidates, pickHealthy } from '../dars/select.js';
import { HealthStore } from '../dars/health.js';

const claudeDef = PROVIDERS.claude;

// ── per-role model mapping ──────────────────────────────────────────────────────
test('modelForRole maps Claude roles to Opus / Sonnet', () => {
  assert.equal(modelForRole('claude', 'coder', claudeDef), 'claude-opus-4-8');
  assert.equal(modelForRole('claude', 'reviewer', claudeDef), 'claude-opus-4-8');
  assert.equal(modelForRole('claude', 'planner', claudeDef), 'claude-sonnet-4-6');
  assert.equal(modelForRole('claude', 'validator', claudeDef), 'claude-sonnet-4-6');
});

test('modelForRole honours an explicit override', () => {
  assert.equal(modelForRole('claude', 'coder', claudeDef, 'claude-sonnet-4-6'), 'claude-sonnet-4-6');
});

test('modelForRole leaves non-Claude providers on their default model', () => {
  assert.equal(modelForRole('gemini', 'coder', PROVIDERS.gemini), PROVIDERS.gemini.defaultModel);
});

// ── credential resolution ───────────────────────────────────────────────────────
test('resolveRoleWith builds a direct Anthropic provider from a claude key', () => {
  const creds: CredentialBag = { claude: 'sk-ant-test-key' };
  // coder's default role-provider is deepseek, so a claude-only bag resolves
  // Claude through the fallback branch — still a working direct Anthropic call.
  const coder = resolveRoleWith('coder', creds);
  assert.equal(coder.api, 'anthropic');
  assert.equal(coder.model, 'claude-opus-4-8');
  assert.equal(coder.baseURL, 'https://api.anthropic.com/v1');

  const planner = resolveRoleWith('planner', creds);
  assert.equal(planner.model, 'claude-sonnet-4-6');
});

// ── DARS candidate selection ────────────────────────────────────────────────────
test('DARS ranks Claude first for the coder role when a key is present', () => {
  const creds: CredentialBag = { claude: 'sk-ant-test-key', llama: 'groq-key' };
  const cands = listProviderCandidates('coder', creds);
  const top = pickHealthy('coder', cands, new Set(), new HealthStore());
  assert.ok(top, 'expected a candidate');
  assert.equal(top!.vendorKey, 'claude');
  assert.equal(top!.provider.api, 'anthropic');
  assert.equal(top!.provider.model, 'claude-opus-4-8');
});

test('Claude routed through OpenRouter stays on the OpenAI wire protocol', () => {
  const creds: CredentialBag = { openrouter: 'or-key' };
  const cands = listProviderCandidates('coder', creds);
  const claudeViaOr = cands.find((c) => c.vendorKey === 'claude');
  assert.ok(claudeViaOr, 'expected a claude OpenRouter candidate');
  assert.notEqual(claudeViaOr!.provider.api, 'anthropic');
  assert.equal(claudeViaOr!.provider.model, claudeDef.openrouterModel);
});
