// ── Offline mock engine ───────────────────────────────────────────────────────
// Makes the whole Aof experience work with zero backend / zero API keys, mirroring
// the tmap-v2 "mock mode" philosophy. Responses are contextual and streamed token
// by token so the UI feels alive. When a real backend is configured (see api.ts)
// these are bypassed in favour of the live /v1/* SSE endpoints.

import type { ChatModel } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Split text into realistic streaming chunks (word + whitespace groups). */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

export interface StreamHandlers {
  onToken: (chunk: string) => void;
  signal?: AbortSignal;
}

/** Stream an arbitrary string token-by-token with human-ish pacing. */
export async function streamText(text: string, { onToken, signal }: StreamHandlers) {
  const tokens = tokenize(text);
  for (const t of tokens) {
    if (signal?.aborted) return;
    onToken(t);
    // Slightly randomised cadence; faster on short tokens.
    await sleep(Math.min(46, 14 + t.length * 6) + Math.random() * 22);
  }
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Build a contextual chat reply for the offline engine. */
function composeChatReply(message: string, model: ChatModel): string {
  const m = message.toLowerCase();
  const opener = pick([
    "Great question — here's how I'd approach it.",
    "Happy to help with that.",
    "Let's break this down.",
    "Sure — here's a clear path forward.",
  ]);

  if (/(plan|build|app|website|game|software|project)/.test(m)) {
    return `${opener}

If you want to actually **build** this, I'd suggest moving over to **Aof Code**, where I can plan the architecture, generate the files, and review them in a loop. For a quick outline though:

1. **Goal** — nail down the single most important outcome.
2. **Scope** — what's in v1 vs. later.
3. **Stack** — pick something you can ship fast and maintain.
4. **Milestones** — small, demoable steps.

Want me to turn this into a real project? Open **Aof Code** and I'll take it from idea to working code.`;
  }

  if (/(hello|hi|hey|สวัสดี)/.test(m)) {
    return `Hi! I'm **Aof** — your AI workspace. I can chat through ideas, help you learn something new, or jump into **Aof Code** to build real software. What are we working on today?`;
  }

  if (/(learn|study|explain|research|how does|what is|why)/.test(m)) {
    return `${opener}

Here's the short version, then the detail:

**TL;DR** — ${pick([
      "the core idea is simpler than it looks once you see the moving parts.",
      "it comes down to a few principles you can reuse everywhere.",
    ])}

**Detail**
- Start from the problem it solves, not the jargon.
- Build a small mental model you can test.
- Then layer in the edge cases.

Ask me to go deeper on any part and I'll expand it.`;
  }

  const depth =
    model === "normal"
      ? "\n\nSince you're on **Normal**, I've reasoned through a couple of angles before answering — switch to **Lite** any time you just want a fast take."
      : "";

  return `${opener}

${pick([
    "Here's a focused answer with the essentials, no fluff.",
    "I'll keep this practical and to the point.",
  ])} If you'd like, I can expand into examples, trade-offs, or next steps — just say the word.${depth}`;
}

/** Stream a mock chat reply. */
export async function mockChat(message: string, model: ChatModel, h: StreamHandlers) {
  await sleep(220 + Math.random() * 240);
  await streamText(composeChatReply(message, model), h);
}

/** Stream a mock Aof Code build log + summary (Lite / 1.0 / Pro). */
export async function mockCodeRun(
  task: string,
  mode: "lite" | "1.0" | "pro",
  h: StreamHandlers,
) {
  const passes = mode === "lite" ? 0 : mode === "1.0" ? 1 : 3;
  const lines = [
    `**Planning** the build for: _${task.slice(0, 80)}_\n`,
    `→ Planner drafted the file map.\n`,
    `→ Coder generating implementation…\n`,
    `→ Validator running syntax checks… ✓\n`,
  ];
  for (let i = 0; i < passes; i++) {
    lines.push(`→ Reviewer critique pass ${i + 1}/${passes}… applied fixes.\n`);
  }
  lines.push(
    `\n**Done.** Generated a starter you can run. In a live workspace you'd see the file tree, a diff view, and a one-click download.\n`,
  );
  await sleep(200);
  for (const l of lines) {
    if (h.signal?.aborted) return;
    await streamText(l, h);
    await sleep(160);
  }
}
