import type { ChatMessage, ResolvedProvider, ChatOpts } from '../types.js';

const MOCK_NOTE =
  '[mock] No API key configured. Set one in .env (run `npm run doctor`).';

/**
 * One OpenAI-compatible chat client for every vendor.
 * POST {baseURL}/chat/completions  — works for Gemini (openai endpoint),
 * DeepSeek, Qwen (DashScope compatible-mode), Llama (Groq) and OpenRouter.
 */
// Token usage extracted from a provider response (may be absent on some vendors).
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// Augmented return value so callers can record real token counts.
export interface ChatResult {
  text: string;
  usage?: TokenUsage;
}

export async function chat(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  opts: ChatOpts = {},
): Promise<ChatResult> {
  if (provider.mode === 'mock') {
    const text = mockReply(provider.role, messages);
    return { text };
  }

  // Anthropic speaks its own /messages shape (system is top-level, not a message role).
  if (provider.api === 'anthropic') {
    return chatAnthropic(provider, messages, opts);
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
    max_tokens: opts.maxTokens ?? 4096,
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

  const usage: TokenUsage | undefined = data?.usage
    ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
    : undefined;

  return { text: String(content).trim(), usage };
}

/**
 * Anthropic Messages API (https://api.anthropic.com/v1/messages).
 * Differs from the OpenAI shape: `system` is a top-level string, `messages`
 * carries only user/assistant turns, auth is `x-api-key` + `anthropic-version`,
 * and `max_tokens` is required.
 */
async function chatAnthropic(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  opts: ChatOpts,
): Promise<ChatResult> {
  const url = `${provider.baseURL}/messages`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01',
  };

  // Hoist all system turns into the single top-level `system` field.
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  // Anthropic requires the conversation to be non-empty and to start with a user turn.
  if (!turns.length || turns[0].role !== 'user') {
    turns.unshift({ role: 'user', content: system || 'continue' });
  }

  const body = JSON.stringify({
    model: provider.model,
    ...(system ? { system } : {}),
    messages: turns,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.2,
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
    throw new Error(`${provider.providerName} HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data: any = await res.json();
  // content is an array of blocks; concatenate the text blocks.
  const content = Array.isArray(data?.content)
    ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
    : '';
  if (!content) throw new Error(`${provider.providerName}: empty response`);

  const usage: TokenUsage | undefined = data?.usage
    ? { inputTokens: data.usage.input_tokens ?? 0, outputTokens: data.usage.output_tokens ?? 0 }
    : undefined;

  return { text: String(content).trim(), usage };
}

// Offline fallback so the pipeline still demonstrates end-to-end without keys.
function mockReply(role: string, messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]?.content ?? '';
  if (role === 'planner')
    return `1. entrypoint — main module\n2. core logic — feature implementation\n3. tests — basic coverage\n${MOCK_NOTE}`;
  if (role === 'coder')
    return `\`\`\`path=main.js\n// main.js — ${MOCK_NOTE}\nexport function main() {\n  console.log("hello from AOF mock");\n}\nmain();\n\`\`\``;
  if (role === 'reviewer')
    return `LOW | general | ${MOCK_NOTE} Add error handling and tests.`;
  return `skipped | ${MOCK_NOTE}`;
}
