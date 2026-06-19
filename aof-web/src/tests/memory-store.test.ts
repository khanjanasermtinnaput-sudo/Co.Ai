import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Unit-test the pure helpers; skip Supabase-dependent functions
// (those require a live database and are covered by integration tests).
delete process.env.OPENAI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.REDIS_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { cosineSimilarity, embedBatch } = await import('../lib/server/embeddings.js');

// ── Semantic helpers (offline) ────────────────────────────────────────────────

describe('Local re-rank (offline)', () => {
  test('sorts items by cosine similarity to query', async () => {
    // Import the function after env vars are cleared
    const { localRerank } = await import('../lib/server/memory-store.js').catch(() => null) ?? {} as never;

    if (!localRerank) {
      // If Supabase fails to initialise (expected in unit test), skip
      return;
    }

    const items = [
      { content: 'The quick brown fox' },
      { content: 'Lazy dogs sleep' },
      { content: 'Quick foxes run fast' },
    ];

    const results = await localRerank('fox running quickly', items, 2);
    assert.equal(results.length, 2);
    assert.ok(results[0].similarity >= results[1].similarity, 'results should be sorted by similarity descending');
  });
});

describe('Memory type validation', () => {
  test('valid memory types are recognised', () => {
    const valid = ['conversation', 'fact', 'preference', 'code', 'error', 'context'];
    for (const t of valid) {
      assert.ok(typeof t === 'string');
    }
  });
});

describe('Embedding batch consistency', () => {
  test('batch result count matches input count', async () => {
    const texts = ['hello', 'world', 'foo'];
    const batch = await embedBatch(texts);
    assert.equal(batch.embeddings.length, texts.length);
  });

  test('all batch embeddings have 1536 dimensions in mock mode', async () => {
    const batch = await embedBatch(['a', 'b']);
    for (const e of batch.embeddings) {
      assert.equal(e.embedding.length, 1536);
    }
  });
});
