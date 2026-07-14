// Provider Router (Master Prompt Part 6.4) — Anthropic parity in DARS candidate
// selection. Anthropic's native API isn't OpenAI-compatible (see providers/client.ts
// callAnthropic vs callOpenAiCompat), so this locks in that a direct Anthropic key
// produces a candidate carrying protocol: 'anthropic' — the discriminator
// providers/client.ts needs to route the call correctly instead of silently
// misdispatching it through the OpenAI-compatible path.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listProviderCandidates, pickHealthy } from '../dars/select.js';
import { HealthStore } from '../dars/health.js';

test('listProviderCandidates includes a direct Anthropic candidate with protocol set', () => {
  const candidates = listProviderCandidates('coder', { anthropic: 'sk-ant-test' });
  const anthropic = candidates.find((c) => c.vendorKey === 'anthropic');

  assert.ok(anthropic, 'anthropic candidate present when creds.anthropic is set');
  assert.equal(anthropic!.healthKey, 'anthropic');
  assert.equal(anthropic!.provider.protocol, 'anthropic');
  assert.equal(anthropic!.provider.mode, 'direct');
  assert.equal(anthropic!.provider.apiKey, 'sk-ant-test');
});

test('OpenRouter-routed candidates never carry the anthropic protocol override', () => {
  const candidates = listProviderCandidates('coder', { openrouter: 'sk-or-test' });
  const anthropicViaOr = candidates.find((c) => c.healthKey === 'openrouter:anthropic');

  assert.ok(anthropicViaOr, 'anthropic is reachable via OpenRouter too');
  assert.equal(
    anthropicViaOr!.provider.protocol,
    undefined,
    'OpenRouter always speaks the OpenAI-compatible shape, even for Anthropic-hosted models',
  );
});

test('pickHealthy can select the Anthropic candidate when it scores best', () => {
  const health = new HealthStore();
  const candidates = listProviderCandidates('coder', { anthropic: 'sk-ant-test' });
  const picked = pickHealthy('coder', candidates, new Set(), health);

  assert.ok(picked);
  assert.equal(picked!.vendorKey, 'anthropic');
});
