// Embedding generation pipeline (server-only)
// Provider priority: OpenAI → OpenRouter → Gemini → mock
// All providers output 1536-dimensional vectors.
// Gemini text-embedding-004 outputs 768 dims; these are zero-padded to 1536.
// Embeddings are cached in Redis (short-TTL) then persisted in Supabase (embedding_cache).
import { createHash } from 'node:crypto';
import { cacheKey, cacheGet, cacheSet } from './redis.js';
import { getAdminSupabase, isAdminConfigured } from './supabase-admin.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EmbeddingModel = 'text-embedding-3-small' | 'text-embedding-004' | 'mock';

export interface EmbeddingResult {
  embedding: number[];
  model:     EmbeddingModel;
  cached:    boolean;
  dims:      number;
}

export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  model:      EmbeddingModel;
  cached:     boolean[];
}

type EmbeddingProvider = 'openai' | 'openrouter' | 'gemini' | 'mock';

interface ProviderConfig {
  name:    EmbeddingProvider;
  apiKey:  () => string | undefined;
  model:   EmbeddingModel;
  dims:    number;
  generate: (texts: string[], apiKey: string) => Promise<number[][]>;
}

// ── Content hash ─────────────────────────────────────────────────────────────

function contentHash(text: string, model: EmbeddingModel): string {
  return createHash('sha256')
    .update(`${model}:${text}`)
    .digest('hex');
}

// ── Provider implementations ──────────────────────────────────────────────────

async function openAIEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body:    JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { data: { embedding: number[]; index: number }[] };
  data.data.sort((a, b) => a.index - b.index);
  return data.data.map((d) => d.embedding);
}

async function openRouterEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${apiKey}`,
      'HTTP-Referer':  'https://github.com/khanjanasermtinnaput-sudo/Aof-code',
      'X-Title':       'Coagentix',
    },
    body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter embeddings ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { data: { embedding: number[]; index: number }[] };
  data.data.sort((a, b) => a.index - b.index);
  return data.data.map((d) => d.embedding);
}

async function geminiEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];
  // Gemini batchEmbedContents supports up to 100 texts per request
  const batchSize = 100;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          requests: batch.map((text) => ({
            model:           'models/text-embedding-004',
            content:         { parts: [{ text }] },
            outputDimensionality: 768,
          })),
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini embeddings ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as { embeddings: { values: number[] }[] };
    for (const emb of data.embeddings) {
      // Zero-pad 768 → 1536 to match the pgvector column dimension
      results.push([...emb.values, ...new Array(768).fill(0)]);
    }
  }
  return results;
}

function mockEmbed(texts: string[]): number[][] {
  // Deterministic pseudo-random vector derived from text content
  return texts.map((text) => {
    const seed = [...Buffer.from(text.slice(0, 64))];
    return Array.from({ length: 1536 }, (_, i) => {
      const v = (seed[i % seed.length] ?? 0) / 255;
      return v * 2 - 1; // normalise to [-1, 1]
    });
  });
}

// ── Provider catalogue ────────────────────────────────────────────────────────

const PROVIDERS: ProviderConfig[] = [
  {
    name:     'openai',
    apiKey:   () => process.env.OPENAI_API_KEY,
    model:    'text-embedding-3-small',
    dims:     1536,
    generate: openAIEmbed,
  },
  {
    name:     'openrouter',
    apiKey:   () => process.env.OPENROUTER_API_KEY,
    model:    'text-embedding-3-small',
    dims:     1536,
    generate: openRouterEmbed,
  },
  {
    name:     'gemini',
    apiKey:   () => process.env.GEMINI_API_KEY,
    model:    'text-embedding-004',
    dims:     1536,
    generate: geminiEmbed,
  },
];

function selectProvider(): ProviderConfig | null {
  for (const p of PROVIDERS) {
    if (p.apiKey()) return p;
  }
  return null;
}

// ── Redis cache ───────────────────────────────────────────────────────────────

const EMBEDDING_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

function redisEmbedKey(hash: string): string {
  return cacheKey('emb', hash);
}

async function redisCacheGet(hash: string): Promise<number[] | null> {
  return cacheGet<number[]>(redisEmbedKey(hash));
}

async function redisCacheSet(hash: string, embedding: number[]): Promise<void> {
  await cacheSet(redisEmbedKey(hash), embedding, EMBEDDING_CACHE_TTL);
}

// ── Supabase persistent cache ─────────────────────────────────────────────────

async function dbCacheGet(hash: string): Promise<number[] | null> {
  if (!isAdminConfigured()) return null;
  try {
    const sb = getAdminSupabase();
    const { data, error } = await sb
      .from('embedding_cache')
      .select('embedding')
      .eq('content_hash', hash)
      .single();
    if (error || !data) return null;
    return data.embedding as number[];
  } catch {
    return null;
  }
}

async function dbCacheSet(
  hash:    string,
  preview: string,
  embedding: number[],
  model:   EmbeddingModel
): Promise<void> {
  if (!isAdminConfigured()) return;
  try {
    const sb = getAdminSupabase();
    await sb.from('embedding_cache').upsert({
      content_hash:    hash,
      content_preview: preview,
      embedding,
      model,
    }, { onConflict: 'content_hash', ignoreDuplicates: true });
  } catch {
    // non-fatal
  }
}

// ── Core: embed single text ───────────────────────────────────────────────────

export async function embed(text: string): Promise<EmbeddingResult> {
  const provider = selectProvider();
  const model: EmbeddingModel = provider?.model ?? 'mock';
  const hash = contentHash(text, model);

  // 1) Redis cache
  const fromRedis = await redisCacheGet(hash);
  if (fromRedis) return { embedding: fromRedis, model, cached: true, dims: fromRedis.length };

  // 2) Supabase cache
  const fromDb = await dbCacheGet(hash);
  if (fromDb) {
    await redisCacheSet(hash, fromDb);
    return { embedding: fromDb, model, cached: true, dims: fromDb.length };
  }

  // 3) Generate
  let vectors: number[][];
  if (provider) {
    const key = provider.apiKey()!;
    try {
      vectors = await provider.generate([text], key);
    } catch (err) {
      console.warn(`[CGNTX][Embed] ${provider.name} failed, falling back to mock:`, (err as Error).message);
      vectors = mockEmbed([text]);
    }
  } else {
    vectors = mockEmbed([text]);
  }

  const embedding = vectors[0];
  await redisCacheSet(hash, embedding);
  await dbCacheSet(hash, text.slice(0, 120), embedding, model);

  return { embedding, model, cached: false, dims: embedding.length };
}

// ── Core: batch embed ─────────────────────────────────────────────────────────

export async function embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
  if (!texts.length) {
    return { embeddings: [], model: 'mock', cached: [] };
  }

  const provider = selectProvider();
  const model: EmbeddingModel = provider?.model ?? 'mock';

  const hashes = texts.map((t) => contentHash(t, model));
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const cachedFlags: boolean[] = new Array(texts.length).fill(false);

  // Check caches in parallel
  await Promise.all(
    hashes.map(async (hash, i) => {
      const r = await redisCacheGet(hash) ?? await dbCacheGet(hash);
      if (r) { results[i] = r; cachedFlags[i] = true; }
    })
  );

  // Collect uncached
  const uncachedIndexes = results.reduce<number[]>((acc, r, i) => {
    if (r === null) acc.push(i);
    return acc;
  }, []);

  if (uncachedIndexes.length) {
    const uncachedTexts = uncachedIndexes.map((i) => texts[i]);
    let vectors: number[][];

    if (provider) {
      const key = provider.apiKey()!;
      try {
        vectors = await provider.generate(uncachedTexts, key);
      } catch (err) {
        console.warn(`[CGNTX][Embed] batch ${provider.name} failed, using mock:`, (err as Error).message);
        vectors = mockEmbed(uncachedTexts);
      }
    } else {
      vectors = mockEmbed(uncachedTexts);
    }

    await Promise.all(
      uncachedIndexes.map(async (origIdx, batchIdx) => {
        const embedding = vectors[batchIdx];
        results[origIdx] = embedding;
        const hash = hashes[origIdx];
        await redisCacheSet(hash, embedding);
        await dbCacheSet(hash, texts[origIdx].slice(0, 120), embedding, model);
      })
    );
  }

  return {
    embeddings: (results as number[][]).map((embedding, i) => ({
      embedding,
      model,
      cached: cachedFlags[i],
      dims:   embedding.length,
    })),
    model,
    cached: cachedFlags,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector length mismatch');
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function activeEmbeddingModel(): EmbeddingModel {
  return selectProvider()?.model ?? 'mock';
}

export function isEmbeddingConfigured(): boolean {
  return selectProvider() !== null;
}
