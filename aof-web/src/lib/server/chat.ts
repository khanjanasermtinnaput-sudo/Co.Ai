// Server-side chat utility for API routes that need a simple string response
// (not a streaming Response object). Tries each configured provider in
// priority order via the shared adapter layer (ai-providers.ts) and returns
// the first one that answers.

import { adapterFor, configuredProviders, type AdapterInput } from "./ai-providers";

export interface StreamChatOptions {
  message: string;
  agent?: string;
  systemContext?: string;
  userId?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

async function drainToText(gen: AsyncGenerator<string, unknown>): Promise<string> {
  let text = "";
  for (;;) {
    const next = await gen.next();
    if (next.done) return text;
    text += next.value;
  }
}

const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  analyze:    "You are a senior software architect. Analyze code, systems, and problems objectively. Identify trade-offs, risks, and concrete improvements. Be specific and actionable.",
  plan:       "You are a software engineering planner. Break problems into clear, sequenced tasks. Identify risks, dependencies, and success criteria. Prefer simple solutions over complex ones.",
  debug:      "You are an expert debugger. Identify root causes, not symptoms. Propose minimal targeted fixes. Always explain *why* a bug occurs.",
  "code-gen": "You are a senior engineer writing production-quality code. Write clean, type-safe, and well-structured code. Prefer clarity over cleverness.",
  requirements:"You are a requirements analyst. Extract clear, testable requirements. Ask clarifying questions. Separate functional from non-functional requirements.",
  chat:       "You are Co.AI, a helpful AI engineering assistant.",
};

/**
 * Call the first configured AI provider and return the full response as a
 * plain string. Used in server-side API routes that need an AI response but
 * don't need to stream it to the browser.
 */
export async function streamChat({ message, agent = "chat", systemContext, userId: _userId }: StreamChatOptions): Promise<string> {
  const providers = configuredProviders();
  if (providers.length === 0) {
    throw new Error("No AI provider configured — cannot call AI provider from server route");
  }

  const system = systemContext
    ?? AGENT_SYSTEM_PROMPTS[agent]
    ?? AGENT_SYSTEM_PROMPTS["chat"];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    let lastError: unknown;
    for (const provider of providers) {
      const input: AdapterInput = {
        system,
        history: [],
        message,
        maxTokens: 2048,
        temperature: 0.7,
        signal: ctrl.signal,
      };
      try {
        return await drainToText(adapterFor(provider.id)(input));
      } catch (thrown) {
        lastError = thrown;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All configured providers failed");
  } finally {
    clearTimeout(timer);
  }
}
