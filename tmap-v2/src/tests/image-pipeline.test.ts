import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  processImage, extractContext, buildReusableContext, type VisionRead,
} from '../core/image-pipeline.js';
import type { ChatMessage } from '../types.js';

// 1x1 transparent PNG
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('processImage detects PNG, hashes, and builds a data URL', () => {
  const out = processImage({ data: PNG_1PX });
  assert.equal(out.mimeType, 'image/png');
  assert.match(out.imageHash, /^[a-f0-9]{64}$/);
  assert.ok(out.dataUrl.startsWith('data:image/png;base64,'));
  assert.ok(out.byteLength > 0);
});

test('processImage accepts a full data URL and is hash-stable', () => {
  const a = processImage({ data: PNG_1PX });
  const b = processImage({ data: `data:image/png;base64,${PNG_1PX}` });
  assert.equal(a.imageHash, b.imageHash); // same bytes → same dedup key
});

test('processImage rejects empty input', () => {
  assert.throws(() => processImage({ data: '' }), /empty/);
});

test('processImage rejects non-image bytes', () => {
  const notImage = Buffer.from('hello world, definitely not an image').toString('base64');
  assert.throws(() => processImage({ data: notImage }), /unsupported image type/);
});

test('extractContext parses model JSON and falls back gracefully', async () => {
  const vision: VisionRead = {
    rawText: 'Gemini quota: 12 left. Titan Mode enabled.',
    detectedLanguages: ['en'], objects: [], scene: 'application',
    uiElements: ['settings'], documentStructure: {}, confidence: 0.9,
  };
  const call = async (_m: ChatMessage[]) => JSON.stringify({
    summary: 'Coagentix dashboard settings',
    keyPoints: ['Titan Mode enabled', 'Gemini quota low'],
    entities: ['Coagentix', 'Gemini'],
    importantNumbers: ['12 quota left'],
    importantDates: [], actionItems: ['top up Gemini quota'],
  });
  const ctx = await extractContext(call, vision);
  assert.equal(ctx.summary, 'Coagentix dashboard settings');
  assert.ok(ctx.keyPoints.includes('Gemini quota low'));
  assert.ok(ctx.importantNumbers[0].includes('12'));
});

test('buildReusableContext falls back when model returns junk', async () => {
  const vision: VisionRead = {
    rawText: 'some text', detectedLanguages: ['en'], objects: [], scene: 'document',
    uiElements: [], documentStructure: {}, confidence: 0.5,
  };
  const ctx = {
    summary: 'a document', keyPoints: [], entities: [], importantNumbers: [],
    importantDates: [], actionItems: [],
  };
  const call = async (_m: ChatMessage[]) => 'not json at all';
  const reusable = await buildReusableContext(call, vision, ctx);
  assert.ok(reusable.shortSummary.length > 0);
  assert.ok(reusable.reusablePromptContext.includes('a document'));
});
