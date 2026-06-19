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
    headers['HTTP-Referer'] = 'https://github.com/khanjanasermtinnaput-sudo/Aof-code';
    headers['X-Title'] = 'Coagentix';
  }

  const body = JSON.stringify({
    model: provider.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2048,
    stream: false,
  });

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: opts.signal });
  } catch (e) {
    throw new Error(`network error calling ${provider.providerName}: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `${provider.providerName} HTTP ${res.status}: ${detail.slice(0, 300)}`,
    );
  }

  const data: any = await res.json();
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    '';
  if (!content) throw new Error(`${provider.providerName}: empty response`);
  return String(content).trim();
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
