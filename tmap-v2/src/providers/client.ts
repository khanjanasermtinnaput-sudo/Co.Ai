import type { AnyMessage, ResolvedProvider, ChatOpts } from '../types.js';

const MOCK_NOTE =
  '[mock] No API key configured. Set one in .env (run `npm run doctor`).';

/**
 * One OpenAI-compatible chat client for every vendor.
 * POST {baseURL}/chat/completions  — works for Gemini (openai endpoint),
 * DeepSeek, Qwen (DashScope compatible-mode), Llama (Groq) and OpenRouter.
 */
export async function chat(
  provider: ResolvedProvider,
  messages: AnyMessage[],
  opts: ChatOpts = {},
): Promise<string> {
  if (provider.mode === 'mock') {
    return mockReply(provider.role, messages);
  }

  const url = `${provider.baseURL}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  };
  // OpenRouter recommends these (optional) attribution headers.
  if (provider.mode === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/aof-code';
    headers['X-Title'] = 'AOF Code';
  }

  const body = JSON.stringify({
    model: provider.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  });

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
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (e) {
      const timedOut = controller.signal.aborted && !opts.signal?.aborted;
      const reason = timedOut ? `timed out after ${timeoutMs}ms` : (e as Error).message;
      throw new Error(`network error calling ${provider.providerName}: ${reason}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `${provider.providerName} HTTP ${res.status}: ${detail.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
    };
    const content =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      '';
    if (!content) throw new Error(`${provider.providerName}: empty response`);
    return String(content).trim();
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
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
    return `\`\`\`js\n// main.js — ${MOCK_NOTE}\nexport function main() {\n  console.log("hello from AOF mock");\n}\nmain();\n\`\`\``;
  if (role === 'reviewer')
    return `LOW | general | ${MOCK_NOTE} Add error handling and tests.`;
  return `skipped | ${MOCK_NOTE}`;
}
