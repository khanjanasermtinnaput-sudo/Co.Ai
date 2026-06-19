import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// Force mock mode: no API keys in test env
delete process.env.OPENAI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.GEMINI_API_KEY;
// Disable Redis + Supabase for unit tests
delete process.env.REDIS_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const {
  embed,
  embedBatch,
  cosineSimilarity,
  activeEmbeddingModel,
  isEmbeddingConfigured,
} = await import('../lib/server/embeddings.js');

describe('Embedding generation (mock mode)', () => {
  test('embed returns a 1536-dim vector', async () => {
    const result = await embed('hello world');
    assert.equal(result.model, 'mock');
    assert.equal(result.dims, 1536);
    assert.equal(result.embedding.length, 1536);
    assert.ok(result.embedding.every((v) => v >= -1 && v <= 1));
  });

  test('embed is deterministic for same input', async () => {
    const a = await embed('test sentence');
    const b = await embed('test sentence');
    assert.deepEqual(a.embedding, b.embedding);
  });

  test('different texts produce different embeddings', async () => {
    const a = await embed('apple');
    const b = await embed('banana');
    assert.notDeepEqual(a.embedding, b.embedding);
  });

  test('embedBatch returns correct count', async () => {
    const texts = ['foo', 'bar', 'baz'];
    const result = await embedBatch(texts);
    assert.equal(result.embeddings.length, 3);
    assert.ok(result.embeddings.every((e) => e.embedding.length === 1536));
  });

  test('embedBatch on empty array returns empty', async () => {
    const result = await embedBatch([]);
    assert.equal(result.embeddings.length, 0);
  });
});

describe('Cosine similarity', () => {
  test('identical vectors have similarity 1.0', () => {
    const v = [0.5, 0.5, 0.5, 0.5];
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 1e-9);
  });

  test('orthogonal vectors have similarity 0.0', () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-9);
  });

  test('opposite vectors have similarity -1.0', () => {
    const a = [1, 0];
    const b = [-1, 0];
    assert.ok(Math.abs(cosineSimilarity(a, b) + 1.0) < 1e-9);
  });

  test('throws on length mismatch', () => {
    assert.throws(() => cosineSimilarity([1, 2], [1, 2, 3]), /length mismatch/);
  });
});

describe('Provider detection', () => {
  test('activeEmbeddingModel returns mock when no keys set', () => {
    assert.equal(activeEmbeddingModel(), 'mock');
  });

  test('isEmbeddingConfigured returns false when no keys set', () => {
    assert.equal(isEmbeddingConfigured(), false);
  });
});
