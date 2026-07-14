// Local model support (Provider Load Balancer, Master Prompt 6.5) — ollama/vllm
// as real PROVIDERS entries: configurable base URL, no OpenRouter route (there
// is none), free cost, and DARS candidate enumeration.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDERS, resolveBaseURL, bagHasAnyKey, resolveRoleWith } from '../config.js';
import { listProviderCandidates } from '../dars/select.js';

test('ollama and vllm are registered with noOpenRouter set (no real route exists)', () => {
  assert.equal(PROVIDERS.ollama.noOpenRouter, true);
  assert.equal(PROVIDERS.vllm.noOpenRouter, true);
});

test('resolveBaseURL falls back to the hardcoded default when no env override is set', () => {
  delete process.env.OLLAMA_BASE_URL;
  assert.equal(resolveBaseURL(PROVIDERS.ollama), 'http://localhost:11434/v1');
});

test('resolveBaseURL picks up a single env-configured instance', () => {
  process.env.OLLAMA_BASE_URL = 'http://my-ollama-host:11434/v1';
  try {
    assert.equal(resolveBaseURL(PROVIDERS.ollama), 'http://my-ollama-host:11434/v1');
  } finally {
    delete process.env.OLLAMA_BASE_URL;
  }
});

test('bagHasAnyKey recognizes an ollama-only credential bag', () => {
  assert.equal(bagHasAnyKey({ ollama: 'ollama' }), true);
  assert.equal(bagHasAnyKey({}), false);
});

test('listProviderCandidates excludes ollama/vllm from the OpenRouter-routed set', () => {
  const candidates = listProviderCandidates('coder', { openrouter: 'sk-or-test' });
  assert.ok(!candidates.some((c) => c.vendorKey === 'ollama'));
  assert.ok(!candidates.some((c) => c.vendorKey === 'vllm'));
});

test('listProviderCandidates includes a direct ollama candidate when configured', () => {
  const candidates = listProviderCandidates('coder', { ollama: 'ollama' });
  const cand = candidates.find((c) => c.vendorKey === 'ollama');
  assert.ok(cand);
  assert.equal(cand!.provider.mode, 'direct');
  assert.equal(cand!.provider.protocol, undefined, 'ollama speaks the plain OpenAI-compatible shape');
});

test('resolveRoleWith falls back to a configured ollama key when the role\'s primary provider has none', () => {
  const resolved = resolveRoleWith('planner', { ollama: 'ollama' });
  assert.match(resolved.providerName, /Ollama/);
  assert.equal(resolved.mode, 'fallback');
});
