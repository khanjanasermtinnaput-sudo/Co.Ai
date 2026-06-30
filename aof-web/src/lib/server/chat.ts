// Server-side chat utility — wraps the Anthropic SDK for use in API routes
// that need a simple string response (not a streaming Response object).
// Falls back gracefully when ANTHROPIC_API_KEY is not set.

import Anthropic from "@anthropic-ai/sdk";

export interface StreamChatOptions {
  message: string;
  agent?: string;
  systemContext?: string;
  userId?: string;
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
 * Call the Anthropic API (or a configured fallback) and return the full
 * response as a plain string. Used in server-side API routes that need an AI
 * response but don't need to stream it to the browser.
 */
export async function streamChat({ message, agent = "chat", systemContext, userId: _userId }: StreamChatOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured — cannot call AI provider from server route");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

  const system = systemContext
    ?? AGENT_SYSTEM_PROMPTS[agent]
    ?? AGENT_SYSTEM_PROMPTS["chat"];

  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: message }],
  });

  return msg.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("");
}
