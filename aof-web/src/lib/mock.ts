// ── Offline mock engine ───────────────────────────────────────────────────────
// Makes the whole Co.AI experience work with zero backend / zero API keys, mirroring
// the tmap-v2 "mock mode" philosophy. Responses are contextual and streamed token
// by token so the UI feels alive. When a real backend is configured (see api.ts)
// these are bypassed in favour of the live /v1/* SSE endpoints.

import type {
  Attachment,
  LearningAnswer,
  RouteDecision,
} from "./types";
import type { AofProviderError, FailoverNotice, ModelNotice, SourcesNotice, StageNotice, UsageNotice } from "./errors";
import { makeUsageNotice } from "./errors";
import { GENCODE_HINT } from "./raa";
import { estimateTokensFor } from "@/store/usage-store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Split text into realistic streaming chunks (word + whitespace groups). */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

export interface StreamHandlers {
  onToken: (chunk: string) => void;
  signal?: AbortSignal;
  /** Called when a provider fails — the caller must show an error, not fake a reply. */
  onError?: (error: AofProviderError) => void;
  /** Called when the route falls over from one provider to another. */
  onFailover?: (notice: FailoverNotice) => void;
  /** Called once the answering model is known. */
  onModel?: (notice: ModelNotice) => void;
  /** Called when the reply was grounded on live web-search sources. */
  onSources?: (notice: SourcesNotice) => void;
  /** Called once real (or, in demo mode, estimated) token usage is known. */
  onUsage?: (notice: UsageNotice) => void;
  /** Called on progress through a multi-stage Model Workflow request (Kanon's
   *  Context Builder → Processing → Deep Think → Review) — never fired by the
   *  offline mock engine, which is single-pass and effort-agnostic. */
  onStage?: (notice: StageNotice) => void;
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

/** Reply in the same language the user wrote in: Thai input → Thai reply. */
function isThai(text: string): boolean {
  return /[฀-๿]/.test(text);
}

/** Demo mode has no real provider, so usage is estimated the same way the
 *  UI's other token estimate is (text.length / 4) — still non-zero and
 *  proportional, so the usage badge behaves consistently offline. */
function emitMockUsage(h: StreamHandlers, input: string, output: string): void {
  h.onUsage?.(makeUsageNotice(estimateTokensFor(input), estimateTokensFor(output)));
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
  const re = /(-?\d+(?:\.\d+)?(?:\s*[+\-*/×÷^]\s*-?\d+(?:\.\d+)?)+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message))) {
    // A numeric run glued to an identifier or a larger expression (x^2 - 5,
    // the "3 + 4" inside "12 × (3 + 4)") is a FRAGMENT — computing just the
    // fragment answers the wrong question, so skip it rather than intercept.
    const before = message[match.index - 1];
    const after = message[match.index + match[0].length];
    if (before && /[A-Za-z0-9_^.()]/.test(before)) continue;
    if (after && /[A-Za-z0-9_.()]/.test(after)) continue;
    const expr = match[1].replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**");
    // Only digits, operators, parens, dots and spaces are allowed through.
    if (!/^[\d+\-*/.()\s*]+$/.test(expr.replace(/\*\*/g, "*"))) continue;
    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict";return (${expr});`)() as number;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `${match[1].trim()} = ${Number(value.toFixed(6))}`;
      }
    } catch {
      /* not evaluable — try the next candidate */
    }
  }
  return null;
}

/** Build a structured Math/Learning answer (answer · steps · concept).
 *
 *  Returns `null` for anything it cannot genuinely compute (only flat
 *  arithmetic expressions are solvable here), so the caller falls through to
 *  the live model instead of intercepting the question with filler — a
 *  question this engine can't answer must never be swallowed by a template
 *  (Master Prompt: no fake/placeholder workflows). */
export function composeLearningReply(message: string): LearningAnswer | null {
  const th = isThai(message);
  const arithmetic = tryArithmetic(message);
  if (arithmetic) {
    const [, result] = arithmetic.split("=").map((s) => s.trim());
    if (th) {
      return {
        answer: arithmetic,
        steps: [
          "อ่านนิพจน์จากซ้ายไปขวาและสังเกตเครื่องหมายที่เกี่ยวข้อง",
          "ใช้ลำดับการดำเนินการ (วงเล็บ → เลขยกกำลัง → ×/÷ → +/−)",
          "ลดทอนทีละการดำเนินการ พร้อมเก็บผลรวมที่ทำอยู่",
          `ได้ค่าสุดท้าย: **${result}**`,
        ],
        concept:
          "เลขคณิตมีลำดับความสำคัญที่ตายตัว ทุกนิพจน์จึงมีค่าเดียวที่ไม่กำกวม เมื่อเชี่ยวชาญลำดับการดำเนินการแล้ว คุณก็คำนวณด้วยมือได้เหมือนเครื่องคิดเลข",
      };
    }
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

  return null;
}

// ── Chat reply (style- & attachment-aware) ────────────────────────────────────

function attachmentPreamble(attachments: Attachment[], th: boolean): string {
  if (attachments.length === 0) return "";
  const img = attachments.filter((a) => a.kind === "image").length;
  const code = attachments.filter((a) => a.kind === "code").length;
  const parts: string[] = [];
  if (th) {
    if (img) parts.push(`รูปภาพ ${img} ไฟล์ (กำลังอ่านข้อความและอธิบายสิ่งที่เห็น)`);
    if (code) parts.push(`ไฟล์โค้ด ${code} ไฟล์ (กำลังวิเคราะห์โครงสร้างและตรรกะ)`);
    if (parts.length === 0) return "";
    return `รับ${parts.join(" ")}ของคุณแล้วครับ\n\n`;
  }
  if (img) parts.push(`${img} image${img > 1 ? "s" : ""} (reading text & describing what I see)`);
  if (code) parts.push(`${code} code file${code > 1 ? "s" : ""} (analyzing structure & logic)`);
  if (parts.length === 0) return "";
  return `I've taken in your ${parts.join(", ")}.\n\n`;
}

/** Build a contextual chat reply. */
function composeChatReply(
  message: string,
  route: RouteDecision,
  attachments: Attachment[],
): string {
  const th = isThai(message);
  const pre = attachmentPreamble(attachments, th);
  const m = message.toLowerCase();

  if (route.target === "search") {
    if (th) {
      const baseTh = `กำลังค้นหาเว็บสำหรับ **${message.trim().slice(0, 60)}**…\n\nในเวิร์กสเปซจริง **Search Agent** จะคืนผลลัพธ์ที่จัดอันดับพร้อมแหล่งอ้างอิง นี่คือวิธีที่ผมจะเรียบเรียงคำตอบเมื่อได้ผลลัพธ์มา:`;
      return `${pre}${baseTh}\n\n1. ดึงแหล่งข้อมูลที่ใหม่และน่าเชื่อถือที่สุด\n2. ตรวจสอบข้อมูลสำคัญข้ามอย่างน้อยสองแหล่ง\n3. สรุปพร้อมลิงก์เพื่อให้คุณตรวจสอบได้`;
    }
    const base = `Searching the web for **${message.trim().slice(0, 60)}**…\n\nIn a live workspace the **Search Agent** would return ranked results with citations. Here's how I'd frame the answer once results are in:`;
    return `${pre}${base}\n\n1. Pull the most recent, authoritative sources.\n2. Cross-check the key claim across two of them.\n3. Summarize with links so you can verify.`;
  }

  if (route.target === "code") {
    if (th) {
      const baseTh = `งานนี้เป็นงานวิศวกรรม ผมจะส่งต่อให้ **CoCode**`;
      return `${pre}${baseTh}

1. **เป้าหมาย** — ระบุผลลัพธ์สำคัญที่สุดเพียงหนึ่งอย่าง
2. **ขอบเขต** — อะไรอยู่ใน v1 และอะไรไว้ทีหลัง
3. **เทคโนโลยี** — เลือกสิ่งที่ส่งมอบได้เร็วและดูแลต่อได้
4. **หมุดหมาย** — ขั้นเล็ก ๆ ที่เดโมได้

อยากให้ผมสร้างเลยไหมครับ? เปิด **CoCode** แล้วผมจะพาจากไอเดียไปเป็นโค้ดที่ใช้งานได้`;
    }
    const base = `This is an engineering task, so I'd hand it to **CoCode**.`;
    return `${pre}${base}

1. **Goal** — nail the single most important outcome.
2. **Scope** — what's in v1 vs. later.
3. **Stack** — something you can ship fast and maintain.
4. **Milestones** — small, demoable steps.

Want me to build it? Open **CoCode** and I'll take it from idea to working code.`;
  }

  if (/(hello|hi|hey|สวัสดี|หวัดดี)/.test(m) && attachments.length === 0) {
    if (th) {
      return `สวัสดีครับ! ผมคือ **CoAI** — เวิร์กสเปซ AI ของคุณ ผมช่วยระดมไอเดีย ช่วยเรียนรู้ อ่านรูปภาพ หรือกระโดดเข้า **CoCode** เพื่อสร้างซอฟต์แวร์จริงได้ วันนี้อยากทำอะไรดีครับ?`;
    }
    return `Hi! I'm **CoAI** — your AI workspace. I can chat through ideas, help you learn, read images, or jump into **CoCode** to build real software. What are we working on today?`;
  }

  if (th) {
    const openerTh = pick([
      "นี่คือแนวทางที่ผมจะทำครับ",
      "ยินดีช่วยเรื่องนี้ครับ",
      "มาแยกเรื่องนี้กันทีละส่วนครับ",
    ]);

    return `${pre}${openerTh}

**สรุป** — ${pick([
      "แก่นของเรื่องง่ายกว่าที่คิดเมื่อเห็นองค์ประกอบที่ขยับ",
      "มันสรุปลงที่หลักการไม่กี่ข้อที่นำไปใช้ซ้ำได้ทุกที่",
    ])}

**ทำไม**
- เริ่มจากปัญหาที่มันแก้ ไม่ใช่ศัพท์เทคนิค
- สร้างแบบจำลองความคิดเล็ก ๆ ที่ทดสอบได้
- แล้วค่อยเพิ่มกรณีขอบเข้าไป

บอกให้ผมเจาะลึกเพิ่มได้เลยครับ`;
  }

  const opener = pick([
    "Here's how I'd approach it.",
    "Happy to help with that.",
    "Let's break this down.",
  ]);

  return `${pre}${opener}

**TL;DR** — ${pick([
    "the core idea is simpler than it looks once you see the moving parts.",
    "it comes down to a few principles you can reuse everywhere.",
  ])}

**Why**
- Start from the problem it solves, not the jargon.
- Build a small mental model you can test.
- Then layer in the edge cases.

Ask me to go deeper on any part.`;
}

export interface ChatReplyOptions {
  route: RouteDecision;
  attachments?: Attachment[];
}

/** Stream a mock chat reply, honoring route and attachments. */
export async function mockChat(message: string, opts: ChatReplyOptions, h: StreamHandlers) {
  await sleep(220 + Math.random() * 240);
  const reply = composeChatReply(message, opts.route, opts.attachments ?? []);
  await streamText(reply, h);
  emitMockUsage(h, message, reply);
}

/** Stream a mock CoCode build log + summary (Lite / 1.0 / Pro). */
export async function mockCodeRun(
  task: string,
  mode: "lite" | "1.0" | "pro",
  h: StreamHandlers,
) {
  const passes = mode === "lite" ? 0 : mode === "1.0" ? 1 : 3;
  const th = isThai(task);
  const lines = th
    ? [
        `**กำลังวางแผน** การ build สำหรับ: _${task.slice(0, 80)}_\n`,
        `→ Planner ร่างแผนผังไฟล์แล้ว\n`,
        `→ Coder กำลังสร้างโค้ด…\n`,
        `→ Validator กำลังตรวจไวยากรณ์… ✓\n`,
      ]
    : [
        `**Planning** the build for: _${task.slice(0, 80)}_\n`,
        `→ Planner drafted the file map.\n`,
        `→ Coder generating implementation…\n`,
        `→ Validator running syntax checks… ✓\n`,
      ];
  for (let i = 0; i < passes; i++) {
    lines.push(
      th
        ? `→ Reviewer รอบที่ ${i + 1}/${passes}… ปรับแก้แล้ว\n`
        : `→ Reviewer critique pass ${i + 1}/${passes}… applied fixes.\n`,
    );
  }
  lines.push(
    th
      ? `\n**เสร็จแล้ว** สร้างโครงเริ่มต้นที่รันได้ให้คุณ ในเวิร์กสเปซจริงคุณจะเห็นแผนผังไฟล์ มุมมอง diff และปุ่มดาวน์โหลดในคลิกเดียว\n`
      : `\n**Done.** Generated a starter you can run. In a live workspace you'd see the file tree, a diff view, and a one-click download.\n`,
  );
  await sleep(200);
  for (const l of lines) {
    if (h.signal?.aborted) return;
    await streamText(l, h);
    await sleep(160);
  }
  emitMockUsage(h, task, lines.join(""));
}

// ── Mock CoCode NORMAL_CHAT replies ───────────────────────────────────────────

/** Mock reply for NORMAL_CHAT state in CoCode: greetings, tech Q&A, discussion.
 *  History-aware so follow-up messages get context-relevant replies, not repeated
 *  generic fallbacks. Returns the full reply text. */
export async function mockCodeChat(
  message: string,
  h: StreamHandlers,
  history: { role: string; content: string }[] = [],
): Promise<string> {
  await sleep(180 + Math.random() * 160);
  const th = isThai(message);
  const m = message.toLowerCase().trim();
  const isFollowUp = history.filter((x) => x.role === "user").length > 0;

  let text: string;

  // Greetings
  if (/^(hi|hello|hey|yo|sup|howdy|หวัดดี|สวัสดี|ไง|เฮ้)[\s!.?]*$/.test(m)) {
    text = th
      ? pick(["สวัสดีครับ! อยากสร้างอะไรวันนี้ครับ?", "หวัดดีครับ — มีโปรเจกต์อะไรในหัวอยู่ไหมครับ?", "เฮ้! วันนี้จะลงมือทำอะไรกันดีครับ?"])
      : pick(["Hey! What are you building today?", "Hi! Got a project in mind?", "Hey — what are we working on?"]);
  }
  // Thanks / short acks
  else if (/^(thanks|thank you|thx|ty|ขอบคุณ|ขอบใจ|โอเค|ok|cool|nice|great|ดีมาก|เยี่ยม)[\s!.?]*$/.test(m)) {
    text = th ? "ยินดีครับ! มีอะไรอยากทำต่อไหม?" : "Glad to help! Anything else on your mind?";
  }
  // "Continue / go on" follow-ups — guide toward describing a project
  else if (/^(ต่อ|ต่อเลย|ต่อได้เลย|continue|go on|go ahead|proceed|next)[\s!.?]*$/i.test(m)) {
    text = th
      ? "บอกผมได้เลยครับว่าอยากทำอะไร — เช่น เว็บ, แอป, เกม หรือ API แล้วผมจะช่วยวางแผนให้"
      : "Go ahead — tell me what you'd like to build and I'll help you plan it out.";
  }
  // "I have this much info" / vague context messages
  else if (/(ข้อมูล|ประมาณนี้|แค่นี้|เท่านี้|this much|that's it|that's all)/.test(m)) {
    text = th
      ? "โอเคครับ — จากที่บอกมา ขอให้ผมเข้าใจเป้าหมายหลักก่อน คุณอยากให้ผลลัพธ์สุดท้ายออกมาเป็นอะไรครับ?"
      : "Got it — based on what you've shared, what's the main outcome you're going for?";
  }
  // Tech comparison questions
  else if (/\bvs\b|versus|compared|difference|better|\bหรือ\b|ต่างกัน|ดีกว่า/.test(m)) {
    text = th
      ? "ขึ้นอยู่กับ use case ครับ เล่าให้ฟังหน่อยว่าจะเอาไปใช้ทำอะไร แล้วผมจะแนะนำให้ตรงจุดขึ้น"
      : "Depends on the use case. Tell me what you're trying to accomplish and I'll give you a more targeted take.";
  }
  // Follow-up (has prior history) — avoid repeating the same generic line
  else if (isFollowUp) {
    text = th
      ? pick([
          "เข้าใจครับ — ถ้ามีโปรเจกต์ที่อยากลงมือทำ เล่าให้ฟังได้เลย แล้วผมจะช่วยคิดด้วย",
          "โอเคครับ มีอะไรที่อยากสร้างหรืออยากแก้ไขอยู่ไหม? ผมพร้อมช่วยคิดด้วยครับ",
          "รับทราบครับ — ถ้าอยากทำโปรเจกต์อะไร บอกผมได้เลย เราวางแผนด้วยกันได้",
        ])
      : pick([
          "Got it — if you have a project in mind, describe it and I'll think through it with you.",
          "Sure — what are you looking to build or fix? I'm ready to dig in.",
          "Understood. Got a project you'd like to start? Tell me about it.",
        ]);
  }
  // First-turn general question
  else {
    text = th
      ? pick([
          "น่าสนใจครับ ขึ้นอยู่กับบริบท — เล่าให้ฟังเพิ่มหน่อยได้ไหม?",
          "ดีครับ คำตอบสั้น ๆ คือขึ้นอยู่กับว่าต้องการอะไร — บอกบริบทเพิ่มได้ไหมครับ?",
          "มีหลายแนวทางครับ แต่ละแบบมีข้อดีต่างกัน ต้องการ optimize อะไรเป็นหลักครับ?",
        ])
      : pick([
          "Interesting — depends on the context. Tell me a bit more?",
          "Good question. Short answer: it depends on your priorities. What matters most to you here?",
          "A few approaches work well here, each with different trade-offs. What are you optimizing for?",
        ]);
  }

  await streamText(text, h);
  emitMockUsage(h, message, text);
  return text;
}

// ── Mock CoCode Edit (file/diff-aware iteration on an existing project) ──────
// The unified agent's second flow: the workspace already has files, so a
// request is a change, not a new build. Produces a small, real, parseable
// unified diff (grounded in the active file when one is open) so the same
// review/accept flow a live provider reply would trigger still works offline.

export async function mockCodeEdit(
  message: string,
  activeFile: { path: string; content: string } | null,
  h: StreamHandlers,
): Promise<string> {
  await sleep(220 + Math.random() * 200);
  const th = isThai(message);
  const path = activeFile?.path ?? "index.html";
  const lines = (activeFile?.content ?? "<!doctype html>\n<html>\n<body>\n</body>\n</html>\n").split("\n");
  const anchor = Math.min(1, Math.max(0, lines.length - 1));
  const comment = th
    ? `<!-- แก้ไขตามที่ขอ: ${message.slice(0, 60)} -->`
    : `<!-- Edited per request: ${message.slice(0, 60)} -->`;

  const diff = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${anchor + 1},1 +${anchor + 1},2 @@`,
    ` ${lines[anchor] ?? ""}`,
    `+${comment}`,
  ].join("\n");

  const text = th
    ? `นี่คือการเปลี่ยนแปลงที่แนะนำสำหรับ \`${path}\`:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nตรวจสอบแล้วกด Apply เพื่อนำไปใช้ครับ`
    : `Here's the suggested change to \`${path}\`:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nReview it and hit Apply when you're happy with it.`;

  await streamText(text, h);
  emitMockUsage(h, message, text);
  return text;
}

// ── Mock Requirements Architect (RAA) ─────────────────────────────────────────
// Keeps CoCode's conversation-first flow working with zero backend. It asks a
// couple of clarifying questions, then emits a brief in the exact RAA summary
// format so lib/raa.ts parseBrief() can read it. Returns the full reply text.

interface MockHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export async function mockRequirements(
  message: string,
  history: MockHistoryItem[],
  h: StreamHandlers,
): Promise<string> {
  await sleep(200 + Math.random() * 200);
  const th = isThai(message);
  const priorUserTurns = history.filter((m) => m.role === "user").length;
  const detailed =
    message.trim().length > 80 ||
    /\b(stack|next\.?js|react|vue|svelte|node|python|go|api|auth|database|postgres|mongo)\b/i.test(message);

  // First, vague turn → 50/50 collaborative: show understanding, contribute
  // directions, recommend one, ask the one most strategically important question.
  if (priorUserTurns === 0 && !detailed) {
    const lc = message.toLowerCase();
    const isGame = /game|เกม/.test(lc);
    const isChat = /chat|messaging|แชท|คุย/.test(lc);
    const isTodo = /todo|task|tasks/.test(lc);
    const isSaaS = /saas|subscription|b2b/.test(lc);

    let text: string;
    if (isGame && th) {
      text = `น่าสนใจมากครับ — เกมประเภทนี้มีหลายทิศทาง: Casual Mode (เล่นสนุก เหมาะ viral growth), Competitive Mode (leaderboard + จับเวลา สำหรับคนชอบแข่ง), หรือ Educational Mode (สอนเด็กฝึกคิดเลข) ผมว่าเริ่ม Casual Mode ก่อนน่าจะ validate ง่ายสุด — ความเสี่ยงหลักคือ puzzle generation algorithm ที่ต้องแน่ใจว่าทุก set มีคำตอบ คุณสนใจทิศทางไหนครับ?`;
    } else if (isGame) {
      text = `Nice idea — games like this can go a few directions: Casual Mode (quick fun, great for viral growth), Competitive Mode (leaderboards and time pressure), or Educational Mode (teaching concepts through play). I'd start with Casual Mode — fastest path to your first players. The key technical risk is making sure the puzzle generator always produces solvable sets. Which direction interests you most?`;
    } else if (isChat && th) {
      text = `แชทแอปเป็นโปรเจกต์ที่น่าสนใจครับ มีหลาย angle: realtime chat ธรรมดา (ง่าย validate เร็ว), team messaging แบบ Slack (ซับซ้อนขึ้นมีช่อง/thread), หรือ AI-powered chat ผมว่าเริ่ม core realtime messaging ก่อนแล้วค่อย layer feature — ส่วนที่ยากที่สุดคือ realtime infra ถ้าเลือก WebSocket vs SSE ผิดจะแก้ทีหลังลำบาก ผู้ใช้กลุ่มหลักคือใครครับ?`;
    } else if (isChat) {
      text = `Chat apps have a few clear angles: simple realtime chat (easy to validate fast), team messaging like Slack (channels, threads, more complex), or AI-powered conversations. I'd start with core realtime messaging and layer on features — the hardest part is picking the right realtime infrastructure early (WebSocket vs SSE vs a managed service), since it's costly to change later. Who's the primary audience?`;
    } else if (isTodo && th) {
      text = `Todo app ดูง่ายแต่มี scope ได้กว้างมากครับ ทำเป็น personal task manager (ง่าย launch เร็ว), team collaboration tool (ซับซ้อน มี assignment/deadline), หรือ Notion-style workspace ผมแนะนำ personal + local-first ก่อน — validate ง่าย และ offline support ช่วยให้ UX ดีขึ้นมาก เป้าหมายหลักทำให้ตัวเองใช้หรือจะ launch ให้คนอื่นใช้ครับ?`;
    } else if (isTodo) {
      text = `Todo apps can range widely in scope: a personal task manager (simple, fast to launch), a team collaboration tool (assignments, deadlines, more complex), or a Notion-style workspace. I'd start personal and local-first — easiest to validate, and offline support makes the UX dramatically better. Is this for your own use or are you building for others?`;
    } else if (th) {
      text = `สนใจครับ — โปรเจกต์แบบนี้มีหลายทิศทาง เริ่ม MVP แบบ focused ก่อน หรือสร้างให้ครบฟีเจอร์ตั้งแต่ต้น ผมมักแนะนำ vertical slice ที่ demo ได้ก่อนเสมอ — ship เร็ว เรียนรู้จาก real user เร็ว ความเสี่ยงที่มักมาช้าคือ auth และ data model ถ้าวางทีหลังแก้ยากมาก ผู้ใช้กลุ่มหลักในใจคือใครครับ?`;
    } else {
      text = `Interesting project — a few directions worth considering: a tight MVP to validate fast, or a more complete v1 with the full feature set. I almost always recommend starting with a demoable vertical slice — ship fast, learn from real users. The risk that often surprises people is auth and data modelling: if you defer those, they're painful to retrofit. Who's the primary audience you're building for?`;
    }

    await streamText(text, h);
    emitMockUsage(h, message, text);
    return text;
  }

  // Enough signal → synthesise a structured brief.
  const text = buildMockBrief(message, history, th);
  await streamText(text, h);
  emitMockUsage(h, message, text);
  return text;
}

// ── Mock Create Plan / Analyze / Debug (offline) ──────────────────────────────

/** Mock "Create Plan" — a build plan, no code. Returns the full text. */
export async function mockPlan(task: string, h: StreamHandlers): Promise<string> {
  await sleep(200);
  const th = isThai(task);
  const text = th
    ? `## แผนการสร้าง — _${task.slice(0, 70)}_\n\n1. **โครงสร้างโปรเจกต์** — วางโฟลเดอร์ \`src/\` และไฟล์ตั้งต้น\n2. **โมเดลข้อมูล** — กำหนดชนิดข้อมูลหลักและ state\n3. **ฟีเจอร์หลัก** — สร้างทีละฟีเจอร์แบบ vertical slice\n4. **จัดการ error & ขอบเขต** — validation และสถานะ loading/error\n5. **เก็บงาน** — รีวิว, เอกสาร, และเตรียม deploy\n\n_นี่คือแผน ยังไม่สร้างโค้ด — กด **Generate Code** เมื่อพร้อม_`
    : `## Build plan — _${task.slice(0, 70)}_\n\n1. **Project structure** — lay out \`src/\` and entry files.\n2. **Data model** — define the core types and state.\n3. **Core features** — build one vertical slice at a time.\n4. **Error handling & edges** — validation and loading/error states.\n5. **Wrap up** — review, docs, and deploy prep.\n\n_This is the plan — no code yet. Hit **Generate Code** when ready._`;
  await streamText(text, h);
  emitMockUsage(h, task, text);
  return text;
}

/** Mock "Analyze Project" — feasibility, risks, recommendations. Returns the full text. */
export async function mockAnalyze(brief: string, h: StreamHandlers): Promise<string> {
  await sleep(220);
  const th = isThai(brief);
  const text = th
    ? `## วิเคราะห์โปรเจกต์\n\n**ความเป็นไปได้** — ทำได้จริงในระดับ MVP ถ้าล็อกขอบเขตให้แคบก่อน\n\n**ความเสี่ยง**\n- ขอบเขตบานปลายก่อนปล่อย v1\n- ฟีเจอร์ที่ซับซ้อนที่สุดอาจดันไทม์ไลน์\n- การจัดการ auth/ข้อมูลถ้าวางทีหลังจะแก้ยาก\n\n**ข้อแนะนำ**\n- เริ่มจาก vertical slice ที่เดโมได้\n- เลือก stack ที่ส่งมอบเร็วและดูแลต่อได้\n- ใส่ validation และ error handling ตั้งแต่ต้น`
    : `## Project analysis\n\n**Feasibility** — Realistic at MVP scope if you lock a thin slice first.\n\n**Risks**\n- Scope creep before v1 ships\n- The hardest feature can blow the timeline\n- Auth/data is costly to retrofit if deferred\n\n**Recommendations**\n- Start with a demoable vertical slice\n- Pick a stack you can ship fast and maintain\n- Bake in validation and error handling from day one`;
  await streamText(text, h);
  emitMockUsage(h, brief, text);
  return text;
}

/** Mock "Debug" — diagnose first, then a targeted fix (never blind regeneration). */
export async function mockDebug(error: string, h: StreamHandlers): Promise<string> {
  await sleep(220);
  const th = isThai(error);
  const snippet = error.trim().split("\n")[0].slice(0, 80);
  const text = th
    ? `## ผลวิเคราะห์ข้อผิดพลาด\n\n**Root cause** — \`${snippet}\` มักเกิดจากค่าที่เป็น undefined/null ถูกใช้งานก่อนถูกกำหนด หรือ promise ที่ไม่ได้ดักจับ\n\n**วิเคราะห์**\n- ไล่จากบรรทัดที่ error ชี้ ไปยังต้นทางของค่า\n- ตรวจว่าค่าถูกกำหนดครบทุกเส้นทางหรือไม่\n\n**วิธีแก้**\n- เพิ่มการตรวจค่า (guard) ก่อนใช้งาน และครอบ async ด้วย try/catch\n- คืน error ที่สื่อความหมายแทนปล่อยให้ crash\n\n_ในเวิร์กสเปซจริง Co.AI จะแนบ **patch** เป็นไฟล์ที่แก้ให้พร้อมนำไปใช้_`
    : `## Debug analysis\n\n**Root cause** — \`${snippet}\` usually means a value is undefined/null when used, or a promise was left unhandled.\n\n**Analysis**\n- Trace from the line the error points to back to where the value originates.\n- Check the value is set on every code path.\n\n**Solution**\n- Add a guard before use and wrap async calls in try/catch.\n- Return a meaningful error instead of letting it crash.\n\n_In a live workspace Co.AI attaches a ready-to-apply **patch** with the corrected files._`;
  await streamText(text, h);
  emitMockUsage(h, error, text);
  return text;
}

function buildMockBrief(message: string, history: MockHistoryItem[], th: boolean): string {
  const convo = [...history.map((m) => m.content), message].join(" \n ");
  const firstUser = history.find((m) => m.role === "user")?.content ?? message;
  const goal = firstUser.trim().replace(/\s+/g, " ").slice(0, 70) || (th ? "โปรเจกต์ใหม่" : "New project");

  const lc = convo.toLowerCase();
  const isApi = /\bapi\b|backend|rest|graphql/.test(lc);
  const isGame = /game|เกม/.test(lc);
  const isMobile = /mobile|ios|android|มือถือ|แอป/.test(lc);
  const appType = isApi ? "REST API" : isGame ? "browser game" : isMobile ? "mobile app" : "web app";

  const features: string[] = [];
  if (/auth|login|sign|บัญชี|เข้าสู่ระบบ/.test(lc)) features.push(th ? "ระบบล็อกอิน / สมัครสมาชิก" : "Authentication");
  if (/chat|message|แชท/.test(lc)) features.push(th ? "แชทแบบเรียลไทม์" : "Realtime chat");
  if (/dashboard|admin|แดชบอร์ด/.test(lc)) features.push(th ? "แดชบอร์ดผู้ดูแล" : "Admin dashboard");
  if (/pay|checkout|จ่าย|ชำระ/.test(lc)) features.push(th ? "ระบบชำระเงิน" : "Payments");
  while (features.length < 3) {
    const fill = th
      ? ["หน้าหลักที่ใช้งานได้จริง", "จัดการข้อมูลหลัก (CRUD)", "สถานะ loading / error ที่เรียบร้อย"]
      : ["A working main screen", "Core data management (CRUD)", "Clean loading / error states"];
    features.push(fill[features.length] ?? fill[0]);
  }

  const stack = isApi
    ? "Node.js + Express + PostgreSQL"
    : isMobile
      ? "React Native + Expo"
      : "Next.js + TypeScript + Tailwind";
  const architecture = isApi ? "API-only service" : "SSR + client components";
  const complexity = features.length >= 4 ? "Complex" : features.length >= 3 ? "Medium" : "Simple";

  return [
    th ? "เข้าใจครบแล้วครับ สรุป requirement ให้ดังนี้" : "Got it — here's the requirement summary:",
    "",
    "===REQUIREMENT SUMMARY===",
    `Project: ${goal}`,
    "Task Type: feature",
    `Type: ${appType}`,
    `Users: ${th ? "ผู้ใช้ทั่วไป" : "end users"}`,
    "Features:",
    ...features.map((f) => `- ${f}`),
    "Confirmed Scope:",
    "- src/app — UI and routes",
    "- src/lib — core logic",
    "Expected Behavior:",
    `- ${th ? "ผู้ใช้เปิดแอป → เห็นหน้าหลักที่ใช้งานได้" : "User opens the app → sees a working main screen"}`,
    `Tech Stack: ${stack}`,
    `Architecture: ${architecture}`,
    "Files to Create:",
    "- src/app/page.tsx — main screen",
    "- src/lib/store.ts — application state",
    `Complexity: ${complexity}`,
    "Open Questions:",
    "- None",
    "===END SUMMARY===",
    GENCODE_HINT,
  ].join("\n");
}
