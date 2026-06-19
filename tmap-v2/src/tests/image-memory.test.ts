import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// File backend (no Supabase in test env).
const MEM_DIR = mkdtempSync(join(tmpdir(), 'aof-img-'));
process.env.AOF_MEMORY_DIR = MEM_DIR;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const {
  toRecord, storeImageMemory, findImageByHash, listImageMemories,
  searchImageMemories, imageMemoriesToContext, clearImageMemories,
} = await import('../core/image-memory.js');

import type { ImageUnderstanding } from '../core/image-pipeline.js';

after(() => rmSync(MEM_DIR, { recursive: true, force: true }));

function understanding(hash: string, summary: string, ocr: string, entities: string[] = []): ImageUnderstanding {
  return {
    processed: { imageHash: hash, mimeType: 'image/png', byteLength: 10, dataUrl: 'data:', uploadTime: new Date().toISOString() },
    vision: { rawText: ocr, detectedLanguages: ['en'], objects: [], scene: 'application', uiElements: [], documentStructure: {}, confidence: 0.9 },
    context: { summary, keyPoints: [summary], entities, importantNumbers: [], importantDates: [], actionItems: [] },
    reusable: { shortSummary: summary, detailedSummary: summary + ' (detail)', reusablePromptContext: ocr },
  };
}

test('store + findImageByHash round-trips and dedups', async () => {
  const u = 'user-img-1';
  const rec = toRecord(u, understanding('hash-aaa', 'Coagentix dashboard', 'Gemini quota 12 left'));
  await storeImageMemory(rec);

  const found = await findImageByHash(u, 'hash-aaa');
  assert.ok(found);
  assert.equal(found!.shortSummary, 'Coagentix dashboard');

  // storing the same hash again must not create a duplicate
  await storeImageMemory(toRecord(u, understanding('hash-aaa', 'Coagentix dashboard v2', 'Gemini quota 5 left')));
  const all = await listImageMemories(u);
  assert.equal(all.filter((r) => r.imageHash === 'hash-aaa').length, 1);
});

test('findImageByHash returns undefined for unknown hash', async () => {
  const found = await findImageByHash('user-img-1', 'nope');
  assert.equal(found, undefined);
});

test('searchImageMemories ranks by relevance to the query', async () => {
  const u = 'user-img-2';
  await storeImageMemory(toRecord(u, understanding('h1', 'invoice from Acme Corp', 'total 4500 baht due March', ['Acme Corp'])));
  await storeImageMemory(toRecord(u, understanding('h2', 'cat photo in a garden', 'a fluffy cat outdoors', [])));

  const ranked = await searchImageMemories(u, 'how much was the Acme invoice total', 3);
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].record.imageHash, 'h1');
});

test('searchImageMemories returns nothing on no overlap', async () => {
  const ranked = await searchImageMemories('user-img-2', 'quantum chromodynamics lagrangian', 3);
  assert.equal(ranked.length, 0);
});

test('imageMemoriesToContext renders an injectable block', async () => {
  const ranked = await searchImageMemories('user-img-2', 'Acme invoice total', 3);
  const ctx = imageMemoriesToContext(ranked);
  assert.ok(ctx.includes('## Image Memory'));
  assert.ok(ctx.toLowerCase().includes('acme'));
});

test('expired records are not returned', async () => {
  const u = 'user-img-3';
  const rec = toRecord(u, understanding('expired-1', 'old screenshot', 'stale text'));
  rec.expiresAt = new Date(Date.now() - 1000).toISOString(); // already expired
  await storeImageMemory(rec);

  const all = await listImageMemories(u);
  assert.equal(all.find((r) => r.imageHash === 'expired-1'), undefined);
  assert.equal(await findImageByHash(u, 'expired-1'), undefined);
});

test('clearImageMemories empties the store', async () => {
  const u = 'user-img-4';
  await storeImageMemory(toRecord(u, understanding('c1', 'thing', 'text')));
  assert.equal((await listImageMemories(u)).length, 1);
  await clearImageMemories(u);
  assert.equal((await listImageMemories(u)).length, 0);
});
