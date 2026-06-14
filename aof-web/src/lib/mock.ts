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

/** Reply in the same language the user wrote in: Thai input → Thai reply. */
function isThai(text: string): boolean {
  return /[฀-๿]/.test(text);
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

  if (th) {
    return {
      answer:
        "นี่คือผลลัพธ์ พร้อมเหตุผลแบบเต็มในแท็บ **Steps** และแนวคิดเบื้องหลังในแท็บ **Concept**",
      steps: [
        "เรียบเรียงโจทย์ด้วยคำของคุณเอง และแยกว่าอะไรคือสิ่งที่ให้มากับสิ่งที่ต้องหา",
        "เลือกกฎหรือสูตรที่เชื่อมสิ่งที่ให้มากับสิ่งที่ต้องหา",
        "แทนค่าที่ทราบลงไปและจัดรูปอย่างระมัดระวัง",
        "ตรวจสอบคำตอบเทียบกับค่าประมาณหรือหน่วย",
      ],
      concept:
        "โจทย์ส่วนใหญ่จะง่ายขึ้นเมื่อแยกสิ่งที่รู้ออกจากสิ่งที่ต้องการ แล้วเชื่อมช่องว่างด้วยหลักการเดียว สร้างแบบจำลองความคิดก่อน ส่วนการคำนวณเป็นแค่งานบันทึก",
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

function attachmentPreamble(attachments: Attachment[], th: boolean): string {
  if (attachments.length === 0) return "";
  const img = attachments.filter((a) => a.kind === "image").length;
  const pdf = attachments.filter((a) => a.kind === "pdf").length;
  const code = attachments.filter((a) => a.kind === "code").length;
  const parts: string[] = [];
  if (th) {
    if (img) parts.push(`รูปภาพ ${img} ไฟล์ (กำลังอ่านข้อความและอธิบายสิ่งที่เห็น)`);
    if (pdf) parts.push(`PDF ${pdf} ไฟล์ (กำลังดึงและสรุปเนื้อหา)`);
    if (code) parts.push(`ไฟล์โค้ด ${code} ไฟล์ (กำลังวิเคราะห์โครงสร้างและตรรกะ)`);
    if (parts.length === 0) return "";
    return `รับ${parts.join(" ")}ของคุณแล้วครับ\n\n`;
  }
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
  const th = isThai(message);
  const pre = attachmentPreamble(attachments, th);
  const m = message.toLowerCase();

  if (route.target === "search") {
    if (th) {
      const baseTh = `กำลังค้นหาเว็บสำหรับ **${message.trim().slice(0, 60)}**…\n\nในเวิร์กสเปซจริง **Search Agent** จะคืนผลลัพธ์ที่จัดอันดับพร้อมแหล่งอ้างอิง นี่คือวิธีที่ผมจะเรียบเรียงคำตอบเมื่อได้ผลลัพธ์มา:`;
      if (style === "short") return `${pre}${baseTh}\n\n- ผลลัพธ์เด่นที่สุด\n- แหล่งอ้างอิงสนับสนุนหนึ่งแห่ง`;
      return `${pre}${baseTh}\n\n1. ดึงแหล่งข้อมูลที่ใหม่และน่าเชื่อถือที่สุด\n2. ตรวจสอบข้อมูลสำคัญข้ามอย่างน้อยสองแหล่ง\n3. สรุปพร้อมลิงก์เพื่อให้คุณตรวจสอบได้`;
    }
    const base = `Searching the web for **${message.trim().slice(0, 60)}**…\n\nIn a live workspace the **Search Agent** would return ranked results with citations. Here's how I'd frame the answer once results are in:`;
    if (style === "short") return `${pre}${base}\n\n- Top finding\n- One supporting source`;
    return `${pre}${base}\n\n1. Pull the most recent, authoritative sources.\n2. Cross-check the key claim across two of them.\n3. Summarize with links so you can verify.`;
  }

  if (route.target === "code") {
    const topic = message.trim().replace(/\s+/g, " ").slice(0, 70);
    if (th) {
      if (style === "short")
        return `${pre}ได้เลยครับ — เรื่อง “${topic}” ตอบสั้น ๆ ได้ที่นี่ ถ้าอยากให้สร้างเป็นโปรเจกต์จริงพร้อมไฟล์ บอกได้ ผมเปิด **Aof Code** ให้ครับ`;
      return `${pre}ได้เลยครับ ผมช่วยเรื่อง “${topic}” ได้ทันที บอกบริบทนิดนึงจะตรงจุดขึ้น เช่น ใช้ภาษา/เฟรมเวิร์กอะไร และผลลัพธ์ที่อยากได้หน้าตาเป็นยังไง\n\nถ้าเป็นงานสร้างทั้งระบบ (เว็บ/แอป/API) แนะนำเปิด **Aof Code** ครับ — มันจะถามให้ครบ วางสถาปัตยกรรม แล้วค่อยลงมือเขียน ไม่รีบ generate ทันที`;
    }
    if (style === "short")
      return `${pre}Sure — happy to answer “${topic}” right here. If you'd rather I scaffold it into a real project with files, say the word and I'll open **Aof Code**.`;
    return `${pre}Happy to help with “${topic}”. Tell me a little context so I hit the mark — which language/framework you're on and what the result should look like — and I'll give you the actual code.\n\nIf this is a whole build (a site, app or API), **Aof Code** is the better room for it: it asks the right questions and designs the architecture before writing a line, instead of generating blindly.`;
  }

  if (route.target === "titan") {
    const topic = message.trim().replace(/\s+/g, " ").slice(0, 70);
    if (th) {
      if (style === "short")
        return `${pre}คำถามนี้ลึกพอจะใช้การคิดเป็นระบบครับ สั้น ๆ: แยกเป็นส่วนย่อย ชั่งน้ำหนักข้อดีข้อเสียของแต่ละทาง แล้วค่อยเลือก เปิด **Titan** เพื่อให้ผมวิเคราะห์เต็มรูปแบบได้`;
      return `${pre}เรื่อง “${topic}” เป็นโจทย์ที่ควรคิดให้รอบด้านก่อนสรุป แนวทางที่ผมจะทำ: แตกปัญหาออกเป็นส่วน ๆ, เทียบทางเลือกพร้อมข้อแลกเปลี่ยน, ชี้ความเสี่ยง, แล้วให้คำแนะนำที่ชัดเจน\n\nนี่คือสิ่งที่ **Titan** ถนัดโดยเฉพาะ — โหมดให้เหตุผลและวิจัยเชิงลึก เปิด Titan แล้วผมจะลงรายละเอียดให้ครับ`;
    }
    if (style === "short")
      return `${pre}This one deserves real reasoning. In short: break it into parts, weigh the trade-offs of each option, then commit to one. Open **Titan** and I'll do the full analysis.`;
    return `${pre}“${topic}” is worth thinking through properly before answering. Here's how I'd approach it: break the problem into its parts, compare the realistic options with their trade-offs, flag the risks, and land on a clear recommendation.\n\nThat's exactly what **Titan** is built for — its deep reasoning and research mode. Open Titan and I'll take it all the way.`;
  }

  if (/(hello|hi|hey|สวัสดี|หวัดดี)/.test(m) && attachments.length === 0) {
    if (th) {
      return `สวัสดีครับ! ผมคือ **Aof** วันนี้อยากให้ช่วยเรื่องอะไรดีครับ? ถามได้ทุกเรื่อง อยากให้สร้างซอฟต์แวร์ก็มี **Aof Code** หรือถ้าเป็นโจทย์คิดลึก ๆ ก็มี **Titan** ครับ`;
    }
    return `Hey! I'm **Aof**. What can I help you with today? Ask me anything — and if you want to build software there's **Aof Code**, or **Titan** for the deeper thinking.`;
  }

  // ── General chat ────────────────────────────────────────────────────────────
  // The offline engine has no live knowledge, so instead of inventing facts (or
  // padding with a robotic TL;DR/Why template) it answers conversationally and asks
  // a focused follow-up — which is also how the real Aof behaves when intent is thin.
  if (th) {
    if (style === "short") {
      return `${pre}${pick([
        "ได้เลยครับ ขอถามนิดเดียวให้ตอบได้ตรงจุด:",
        "ยินดีช่วยครับ ขอรายละเอียดเพิ่มอีกนิด:",
      ])} คุณอยากโฟกัสที่ส่วนไหนของเรื่องนี้มากที่สุด?`;
    }
    if (style === "detailed") {
      return `${pre}${pick([
        "ยินดีช่วยเต็มที่ครับ",
        "เรื่องนี้น่าสนใจครับ",
      ])} เพื่อให้คำตอบลงลึกและตรงกับสิ่งที่คุณต้องการจริง ๆ ขอเข้าใจบริบทอีกนิด — คุณกำลังพยายามทำอะไรให้สำเร็จ และตอนนี้ติดตรงไหนอยู่?

พอผมเห็นภาพแล้ว ผมจะอธิบายแบบทีละขั้น พร้อมตัวอย่างจริงให้ครับ`;
    }
    return `${pre}${pick([
      "ยินดีช่วยครับ",
      "ได้เลยครับ",
    ])} เล่าบริบทเพิ่มอีกนิดได้ไหม — คุณอยากได้คำตอบไปใช้ทำอะไร? ผมจะได้ตอบให้ตรงจุดแทนที่จะเดาครับ`;
  }

  if (style === "short") {
    return `${pre}${pick([
      "Happy to help — one quick thing so I nail it:",
      "Sure thing. To point this the right way:",
    ])} what part of this matters most to you?`;
  }
  if (style === "detailed") {
    return `${pre}${pick([
      "Glad to dig into this.",
      "Good question.",
    ])} To give you a genuinely useful, in-depth answer rather than a generic one, tell me a bit about your context — what are you trying to accomplish, and where are you stuck right now?

Once I have that, I'll walk you through it step by step with concrete examples.`;
  }
  // normal
  return `${pre}${pick([
    "Happy to help with this.",
    "Sure — let's get into it.",
  ])} Can you give me a little more context on what you're trying to do with the answer? That way I can be specific instead of guessing.`;
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
}
