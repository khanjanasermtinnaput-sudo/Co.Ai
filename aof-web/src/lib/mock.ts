// ── Offline mock engine ───────────────────────────────────────────────────────
// Makes the whole Aof experience work with zero backend / zero API keys, mirroring
// the tmap-v2 "mock mode" philosophy. Responses are contextual and streamed token
// by token so the UI feels alive. When a real backend is configured (see api.ts)
// these are bypassed in favour of the live /v1/* SSE endpoints.

import type {
  Attachment,
  LearningAnswer,
  ResponseStyle,
  RouteDecision,
} from "./types";

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

// ── Math & Learning detection ─────────────────────────────────────────────────

/** Heuristic: does this read like a math/science/step-by-step problem? */
export function isLearningProblem(message: string): boolean {
  const m = message.toLowerCase();
  if (/[0-9]\s*[+\-*/×÷=^]\s*[0-9]/.test(m)) return true; // contains arithmetic
  if (/\b(solve|calculate|compute|evaluate|simplify|derive|integrate|prove|factor)\b/.test(m))
    return true;
  if (/\b(equation|inequality|fraction|percentage|probability|derivative|integral|theorem)\b/.test(m))
    return true;
  if (/(แก้สมการ|คำนวณ|พิสูจน์|หาค่า|สมการ|โจทย์)/.test(m)) return true;
  return false;
}

/** Try to evaluate a simple arithmetic expression safely (no eval). */
function tryArithmetic(message: string): string | null {
  const match = message.match(/(-?\d+(?:\.\d+)?(?:\s*[+\-*/×÷^]\s*-?\d+(?:\.\d+)?)+)/);
  if (!match) return null;
  const expr = match[1].replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**");
  // Only digits, operators, parens, dots and spaces are allowed through.
  if (!/^[\d+\-*/.()\s*]+$/.test(expr.replace(/\*\*/g, "*"))) return null;
  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict";return (${expr});`)() as number;
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${match[1].trim()} = ${Number(value.toFixed(6))}`;
    }
  } catch {
    /* not evaluable */
  }
  return null;
}

/** Build a structured Math/Learning answer (answer · steps · concept). */
export function composeLearningReply(message: string): LearningAnswer {
  const arithmetic = tryArithmetic(message);
  if (arithmetic) {
    const [, result] = arithmetic.split("=").map((s) => s.trim());
    return {
      answer: arithmetic,
      steps: [
        "Read the expression left to right and note the operators involved.",
        "Apply order of operations (parentheses → exponents → ×/÷ → +/−).",
        "Reduce each operation one at a time, carrying the running total.",
        `Reach the final value: **${result}**.`,
      ],
      concept:
        "Arithmetic follows a fixed precedence so every expression has one unambiguous value. Master the order of operations and you can evaluate anything by hand the same way a calculator does.",
    };
  }

  return {
    answer:
      "Here's the result, with the full reasoning in the **Steps** tab and the underlying idea in **Concept**.",
    steps: [
      "Restate the problem in your own words and list what's given vs. unknown.",
      "Pick the rule or formula that connects the givens to the unknown.",
      "Substitute the known values and simplify carefully.",
      "Sanity-check the answer against an estimate or units.",
    ],
    concept:
      "Most problems become easy once you separate what you know from what you want, then bridge the gap with a single principle. Build the mental model first; the arithmetic is just bookkeeping.",
  };
}

// ── Chat reply (style- & attachment-aware) ────────────────────────────────────

function attachmentPreamble(attachments: Attachment[]): string {
  if (attachments.length === 0) return "";
  const img = attachments.filter((a) => a.kind === "image").length;
  const pdf = attachments.filter((a) => a.kind === "pdf").length;
  const code = attachments.filter((a) => a.kind === "code").length;
  const parts: string[] = [];
  if (img) parts.push(`${img} image${img > 1 ? "s" : ""} (reading text & describing what I see)`);
  if (pdf) parts.push(`${pdf} PDF${pdf > 1 ? "s" : ""} (extracting & summarizing the contents)`);
  if (code) parts.push(`${code} code file${code > 1 ? "s" : ""} (analyzing structure & logic)`);
  if (parts.length === 0) return "";
  return `I've taken in your ${parts.join(", ")}.\n\n`;
}

/** Build a contextual chat reply honoring the requested verbosity. */
function composeChatReply(
  message: string,
  style: ResponseStyle,
  route: RouteDecision,
  attachments: Attachment[],
): string {
  const pre = attachmentPreamble(attachments);
  const m = message.toLowerCase();

  if (route.target === "search") {
    const base = `Searching the web for **${message.trim().slice(0, 60)}**…\n\nIn a live workspace the **Search Agent** would return ranked results with citations. Here's how I'd frame the answer once results are in:`;
    if (style === "short") return `${pre}${base}\n\n- Top finding\n- One supporting source`;
    return `${pre}${base}\n\n1. Pull the most recent, authoritative sources.\n2. Cross-check the key claim across two of them.\n3. Summarize with links so you can verify.`;
  }

  if (route.target === "code") {
    const base = `This is an engineering task, so I'd hand it to **Aof Code**.`;
    if (style === "short") return `${pre}${base} Open **Aof Code** and I'll plan, generate and review the files.`;
    return `${pre}${base}

1. **Goal** — nail the single most important outcome.
2. **Scope** — what's in v1 vs. later.
3. **Stack** — something you can ship fast and maintain.
4. **Milestones** — small, demoable steps.

Want me to build it? Open **Aof Code** and I'll take it from idea to working code.`;
  }

  if (/(hello|hi|hey|สวัสดี)/.test(m) && attachments.length === 0) {
    return `Hi! I'm **Aof** — your AI workspace. I can chat through ideas, help you learn, read images & PDFs, or jump into **Aof Code** to build real software. What are we working on today?`;
  }

  const opener = pick([
    "Here's how I'd approach it.",
    "Happy to help with that.",
    "Let's break this down.",
  ]);

  if (style === "short") {
    return `${pre}${pick([
      "Short version:",
      "In brief:",
    ])} ${pick([
      "the essentials are straightforward once you see the core idea.",
      "it comes down to one or two key principles.",
    ])} Ask for more and I'll expand.`;
  }

  if (style === "detailed") {
    return `${pre}${opener}

**Overview**
First, the big picture: ${pick([
      "the core idea is simpler than it looks once you map the moving parts.",
      "this rests on a few principles you can reuse everywhere.",
    ])}

**Step by step**
1. Start from the problem it solves, not the jargon.
2. Build a small mental model you can test.
3. Work an example end to end.
4. Then layer in the edge cases.

**Example**
A worked example here would make each step concrete — tell me your exact case and I'll plug it in.

Want me to go even deeper on any part?`;
  }

  // normal
  return `${pre}${opener}

**TL;DR** — ${pick([
    "the core idea is simpler than it looks once you see the moving parts.",
    "it comes down to a few principles you can reuse everywhere.",
  ])}

**Why**
- Start from the problem it solves, not the jargon.
- Build a small mental model you can test.
- Then layer in the edge cases.

Ask me to go deeper or switch to **Detailed** for a full walkthrough.`;
}

export interface ChatReplyOptions {
  style: ResponseStyle;
  route: RouteDecision;
  attachments?: Attachment[];
}

/** Stream a mock chat reply, honoring style, route and attachments. */
export async function mockChat(message: string, opts: ChatReplyOptions, h: StreamHandlers) {
  await sleep(220 + Math.random() * 240);
  await streamText(
    composeChatReply(message, opts.style, opts.route, opts.attachments ?? []),
    h,
  );
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
