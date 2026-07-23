// Provider Load Balancer (Master Prompt Part 6.5) — picks WHICH instance of a
// (today, local-model-only) multi-instance provider serves a call, after the
// Provider Router has already decided WHICH provider.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InstancePool, parseInstanceUrls } from '../providers/instance-pool.js';

test('parseInstanceUrls falls back to the single default when unset', () => {
  assert.deepEqual(parseInstanceUrls(undefined, 'http://localhost:11434/v1'), ['http://localhost:11434/v1']);
  assert.deepEqual(parseInstanceUrls('  ', 'http://localhost:11434/v1'), ['http://localhost:11434/v1']);
});

test('parseInstanceUrls splits, trims, strips trailing slashes, and dedups', () => {
  const urls = parseInstanceUrls(
    ' http://a:11434/v1/ , http://b:11434/v1,http://a:11434/v1/ ',
    'http://fallback/v1',
  );
  assert.deepEqual(urls, ['http://a:11434/v1', 'http://b:11434/v1']);
});

test('pick short-circuits for a single instance without touching health tracking', () => {
  const pool = new InstancePool();
  assert.equal(pool.pick(['http://only:11434/v1']), 'http://only:11434/v1');
});

test('pick round-robin cycles through every instance before repeating', () => {
  const pool = new InstancePool();
  const instances = ['http://a/v1', 'http://b/v1', 'http://c/v1'];
  const picks = Array.from({ length: 6 }, () => pool.pick(instances, 'round-robin'));
  assert.deepEqual(picks, ['http://a/v1', 'http://b/v1', 'http://c/v1', 'http://a/v1', 'http://b/v1', 'http://c/v1']);
});

test('pick least-latency prefers the instance with the lower recorded latency', () => {
  const pool = new InstancePool();
  const instances = ['http://slow/v1', 'http://fast/v1'];
  pool.recordStart('http://slow/v1');
  pool.recordEnd('http://slow/v1', 2000);
  pool.recordStart('http://fast/v1');
  pool.recordEnd('http://fast/v1', 50);

  // EWMA needs a couple of samples to separate clearly from the shared init value.
  pool.recordStart('http://slow/v1'); pool.recordEnd('http://slow/v1', 2000);
  pool.recordStart('http://fast/v1'); pool.recordEnd('http://fast/v1', 50);

  assert.equal(pool.pick(instances, 'least-latency'), 'http://fast/v1');
});

test('pick avoids an instance at its concurrency cap in favor of one with room', () => {
  const pool = new InstancePool(2); // cap = 2
  const instances = ['http://busy/v1', 'http://free/v1'];
  pool.recordStart('http://busy/v1');
  pool.recordStart('http://busy/v1'); // busy is now at cap (2 in flight)

  const picked = pool.pick(instances, 'round-robin');
  assert.equal(picked, 'http://free/v1', 'the under-cap instance is preferred even though round-robin would otherwise alternate');
});

test('pick still returns an instance (graceful degradation) when every instance is saturated', () => {
  const pool = new InstancePool(1);
  const instances = ['http://a/v1', 'http://b/v1'];
  pool.recordStart('http://a/v1');
  pool.recordStart('http://b/v1');
  // Both at cap=1 — pick must not throw or block; it degrades to picking the
  // least-loaded/least-latency one from the full (saturated) set.
  const picked = pool.pick(instances, 'least-latency');
  assert.ok(instances.includes(picked));
});

test('recordEnd decrements inFlight so a completed request frees capacity', () => {
  const pool = new InstancePool(1);
  pool.recordStart('http://a/v1');
  pool.recordEnd('http://a/v1', 100);
  // a is no longer at cap, so round-robin (starting fresh key) should still be
  // able to pick it without being excluded as saturated.
  const snap = pool.snapshot().find((s) => s.url === 'http://a/v1');
  assert.equal(snap?.inFlight, 0);
});
