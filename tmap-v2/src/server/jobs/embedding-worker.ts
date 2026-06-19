// BullMQ worker: generates and stores embeddings for queued content
import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';

interface EmbeddingJobData {
  userId:       string;
  texts:        string[];
  targetTable:  'memories' | 'conversation_turns';
  rowIds:       string[];
  scheduled?:   boolean;
  action?:      string;
}

type EmbeddingModel = 'text-embedding-3-small' | 'text-embedding-004' | 'mock';

// ── Embedding provider (mirrors aof-web/src/lib/server/embeddings.ts) ─────────

async function openAIEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body:    JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { data: { embedding: number[]; index: number }[] };
  data.data.sort((a, b) => a.index - b.index);
  return data.data.map((d) => d.embedding);
}

async function openRouterEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/khanjanasermtinnaput-sudo/Aof-code',
      'X-Title':      'Coagentix',
    },
    body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: texts }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { data: { embedding: number[]; index: number }[] };
  data.data.sort((a, b) => a.index - b.index);
  return data.data.map((d) => d.embedding);
}

async function geminiEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];
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
            model:                'models/text-embedding-004',
            content:              { parts: [{ text }] },
            outputDimensionality: 768,
          })),
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { embeddings: { values: number[] }[] };
    for (const emb of data.embeddings) {
      results.push([...emb.values, ...new Array(768).fill(0)]);
    }
  }
  return results;
}

function mockEmbed(texts: string[]): number[][] {
  return texts.map((text) => {
    const seed = [...Buffer.from(text.slice(0, 64))];
    return Array.from({ length: 1536 }, (_, i) => {
      const v = (seed[i % seed.length] ?? 0) / 255;
      return v * 2 - 1;
    });
  });
}

async function generateEmbeddings(texts: string[]): Promise<{ vectors: number[][]; model: EmbeddingModel }> {
  if (process.env.OPENAI_API_KEY) {
    return { vectors: await openAIEmbed(texts, process.env.OPENAI_API_KEY), model: 'text-embedding-3-small' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { vectors: await openRouterEmbed(texts, process.env.OPENROUTER_API_KEY), model: 'text-embedding-3-small' };
  }
  if (process.env.GEMINI_API_KEY) {
    return { vectors: await geminiEmbed(texts, process.env.GEMINI_API_KEY), model: 'text-embedding-004' };
  }
  return { vectors: mockEmbed(texts), model: 'mock' };
}

// ── Supabase admin client ─────────────────────────────────────────────────────

async function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured for embedding worker');

  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function contentHash(text: string, model: EmbeddingModel): string {
  return createHash('sha256').update(`${model}:${text}`).digest('hex');
}

async function persistToCache(
  hash:    string,
  preview: string,
  emb:     number[],
  model:   EmbeddingModel
): Promise<void> {
  try {
    const sb = await getSupabase();
    await sb.from('embedding_cache').upsert(
      { content_hash: hash, content_preview: preview, embedding: emb, model },
      { onConflict: 'content_hash', ignoreDuplicates: true }
    );
  } catch {
    // non-fatal
  }
}

// ── Main job handler ──────────────────────────────────────────────────────────

export async function processEmbeddingJob(job: Job<EmbeddingJobData>): Promise<{ count: number }> {
  const { texts, targetTable, rowIds, scheduled, action } = job.data;

  // Scheduled flush-pending: re-queue any rows without embeddings
  if (scheduled && action === 'flush-pending') {
    return flushPendingEmbeddings();
  }

  if (!texts?.length || !rowIds?.length || texts.length !== rowIds.length) {
    throw new Error('Invalid embedding job: texts and rowIds must be non-empty arrays of equal length');
  }

  await job.updateProgress(5);

  const { vectors, model } = await generateEmbeddings(texts);
  await job.updateProgress(60);

  const sb = await getSupabase();
  const updates = rowIds.map((id, i) => ({ id, embedding: vectors[i] }));

  const batchSize = 50;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    for (const { id, embedding } of batch) {
      await sb.from(targetTable).update({ embedding }).eq('id', id);
    }
    await job.updateProgress(60 + Math.round((40 * (i + batchSize)) / updates.length));
  }

  // Persist to embedding cache
  await Promise.allSettled(
    texts.map((text, i) =>
      persistToCache(contentHash(text, model), text.slice(0, 120), vectors[i], model)
    )
  );

  await job.updateProgress(100);
  return { count: texts.length };
}

async function flushPendingEmbeddings(): Promise<{ count: number }> {
  const sb = await getSupabase();
  let total = 0;

  for (const table of ['memories', 'conversation_turns'] as const) {
    const { data } = await sb
      .from(table)
      .select('id, content')
      .is('embedding', null)
      .limit(200);

    if (!data?.length) continue;

    const { vectors } = await generateEmbeddings(data.map((r) => r.content as string));
    for (let i = 0; i < data.length; i++) {
      await sb.from(table).update({ embedding: vectors[i] }).eq('id', data[i].id);
    }
    total += data.length;
  }

  return { count: total };
}
