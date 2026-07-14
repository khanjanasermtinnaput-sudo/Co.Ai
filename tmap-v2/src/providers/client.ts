import type { AnyMessage, ResolvedProvider, ChatOpts, TokenUsage, ContentPart } from '../types.js';
import { forceOfflineForTest } from '../config.js';
import { globalInstancePool } from './instance-pool.js';

const MOCK_NOTE =
  '[mock] No API key configured. Set one in .env (run `npm run doctor`).';

const ANTHROPIC_VERSION = '2023-06-01';

/** A completed model call: the text plus provider-reported token usage when the
 *  upstream returned a `usage` block (omitted for mock / vendors that don't). */
export interface ChatResult {
  text: string;
  usage?: TokenUsage;
}

/**
 * One chat client for every vendor. Most speak the OpenAI-compatible
 * POST {baseURL}/chat/completions shape — Gemini (openai endpoint), DeepSeek,
 * Qwen (DashScope compatible-mode), Llama (Groq) and OpenRouter. Anthropic's
 * direct API is not OpenAI-shaped (its native Messages API), so it dispatches
 * to a separate implementation below — selected via `provider.protocol`, never
 * silently coerced into the wrong wire format.
 *
 * Backwards-compatible wrapper that returns just the text. Use chatWithUsage when
 * you also need the provider's exact token counts (e.g. cost tracking).
 */
export async function chat(
  provider: ResolvedProvider,
  messages: AnyMessage[],
  opts: ChatOpts = {},
): Promise<string> {
  return (await chatWithUsage(provider, messages, opts)).text;
}

/** Same call as chat(), but also surfaces provider-reported token usage. */
export async function chatWithUsage(
  provider: ResolvedProvider,
  messages: AnyMessage[],
  opts: ChatOpts = {},
): Promise<ChatResult> {
  // Mock providers, and ANY provider while the hermetic test suite is running,
  // resolve to a canned reply so no live (billed) upstream is ever contacted.
  if (provider.mode === 'mock' || forceOfflineForTest()) {
    return { text: mockReply(provider.role, messages) };
  }

  // Bound every provider call so a hung upstream fails fast (and the caller can
  // fail over) instead of holding the request open until the platform kills it.
  // Honors the caller's abort signal too (user pressed Stop / request cancelled).
  const timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS ?? 60_000);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return provider.protocol === 'anthropic'
      ? await callAnthropic(provider, messages, opts, controller, timeoutMs)
      : await callOpenAiCompat(provider, messages, opts, controller, timeoutMs);
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

/** POST + timeout-aware network-error classification, shared by both protocols
 *  below (identical failure-handling contract classify.ts depends on: a
 *  "network error calling X: ..." message on transport failure, and an
 *  "X HTTP <status>: ..." message — preserving the substring shape
 *  dars/classify.ts pattern-matches on — for a non-2xx response). */
async function postJson(
  url: string, headers: Record<string, string>, body: string,
  controller: AbortController, timeoutMs: number, opts: ChatOpts, providerName: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
  } catch (e) {
    const timedOut = controller.signal.aborted && !opts.signal?.aborted;
    const reason = timedOut ? `timed out after ${timeoutMs}ms` : (e as Error).message;
    throw new Error(`network error calling ${providerName}: ${reason}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${providerName} HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

async function callOpenAiCompat(
  provider: ResolvedProvider, messages: AnyMessage[], opts: ChatOpts,
  controller: AbortController, timeoutMs: number,
): Promise<ChatResult> {
  const url = `${provider.baseURL}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  };
  // OpenRouter recommends these (optional) attribution headers.
  if (provider.mode === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/coagentix';
    headers['X-Title'] = 'Coagentix Code';
  }

  const body = JSON.stringify({
    model: provider.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  });

  // Provider Load Balancer (Master Prompt 6.5): feed this call's real observed
  // latency back into the instance pool that picked provider.baseURL (a no-op
  // for single-instance cloud vendors, but real adaptive routing for a
  // multi-instance local-model pool — see providers/instance-pool.ts).
  const instanceT0 = Date.now();
  globalInstancePool.recordStart(provider.baseURL);
  let res: Response;
  try {
    res = await postJson(url, headers, body, controller, timeoutMs, opts, provider.providerName);
  } finally {
    globalInstancePool.recordEnd(provider.baseURL, Date.now() - instanceT0);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    '';
  if (!content) throw new Error(`${provider.providerName}: empty response`);

  // Provider-reported usage (OpenAI-compatible). Only trust it when both counts
  // are real numbers; otherwise leave undefined so the caller falls back to its
  // own estimate rather than recording a misleading 0.
  let usage: TokenUsage | undefined;
  const inTok = data?.usage?.prompt_tokens;
  const outTok = data?.usage?.completion_tokens;
  if (typeof inTok === 'number' && typeof outTok === 'number') {
    usage = { inputTokens: inTok, outputTokens: outTok };
  }

  return { text: String(content).trim(), usage };
}

async function callAnthropic(
  provider: ResolvedProvider, messages: AnyMessage[], opts: ChatOpts,
  controller: AbortController, timeoutMs: number,
): Promise<ChatResult> {
  const url = `${provider.baseURL}/v1/messages`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  const { system, anthropicMessages } = toAnthropicMessages(messages);
  const body = JSON.stringify({
    model: provider.model,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
    ...(system ? { system } : {}),
    messages: anthropicMessages,
  });

  const res = await postJson(url, headers, body, controller, timeoutMs, opts, provider.providerName);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content = (data?.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!content) throw new Error(`${provider.providerName}: empty response`);

  let usage: TokenUsage | undefined;
  const inTok = data?.usage?.input_tokens;
  const outTok = data?.usage?.output_tokens;
  if (typeof inTok === 'number' && typeof outTok === 'number') {
    usage = { inputTokens: inTok, outputTokens: outTok };
  }

  return { text: content.trim(), usage };
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string } };

/** Anthropic's Messages API has no "system" role inside `messages` — system
 *  prompts are a separate top-level string, and only user/assistant turns are
 *  allowed in the array. */
function toAnthropicMessages(messages: AnyMessage[]): {
  system?: string;
  anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }>;
} {
  const systemParts: string[] = [];
  const out: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(typeof m.content === 'string' ? m.content : flattenTextParts(m.content));
      continue;
    }
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
    } else {
      out.push({ role: m.role, content: m.content.map(toAnthropicBlock) });
    }
  }
  return { system: systemParts.length ? systemParts.join('\n\n') : undefined, anthropicMessages: out };
}

function toAnthropicBlock(part: ContentPart): AnthropicBlock {
  if (part.type === 'text') return { type: 'text', text: part.text };
  const url = part.image_url.url;
  const dataMatch = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (dataMatch) {
    return { type: 'image', source: { type: 'base64', media_type: dataMatch[1], data: dataMatch[2] } };
  }
  return { type: 'image', source: { type: 'url', url } };
}

function flattenTextParts(parts: ContentPart[]): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ');
}

// Offline fallback so the pipeline still demonstrates end-to-end without keys.
function mockReply(role: string, messages: AnyMessage[]): string {
  const rawLast = messages[messages.length - 1]?.content ?? '';
  // Multimodal content arrives as a parts array — flatten to text for the mock.
  const last = typeof rawLast === 'string'
    ? rawLast
    : rawLast.map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ');
  if (last.includes('"rawText"') || /image[_\s-]?(analysis|understanding)/i.test(last)) {
    // Vision pipeline asked for a structured JSON read of an image.
    return JSON.stringify({
      rawText: `[mock] no vision model configured. ${MOCK_NOTE}`,
      detectedLanguages: ['unknown'],
      objects: [], scene: 'unknown', uiElements: [],
      documentStructure: {}, confidence: 0,
    });
  }
  if (role === 'planner')
    return `1. entrypoint — main module\n2. core logic — feature implementation\n3. tests — basic coverage\n${MOCK_NOTE}`;
  if (role === 'coder')
    return `\`\`\`js\n// main.js — ${MOCK_NOTE}\nexport function main() {\n  console.log("hello from Coagentix mock");\n}\nmain();\n\`\`\``;
  if (role === 'reviewer')
    return `LOW | general | ${MOCK_NOTE} Add error handling and tests.`;
  return `skipped | ${MOCK_NOTE}`;
}
