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
    if (th) {
      const baseTh = `งานนี้เป็นงานวิศวกรรม ผมจะส่งต่อให้ **Aof Code**`;
      if (style === "short") return `${pre}${baseTh} เปิด **Aof Code** แล้วผมจะวางแผน สร้าง และรีวิวไฟล์ให้ครับ`;
      return `${pre}${baseTh}

1. **เป้าหมาย** — ระบุผลลัพธ์สำคัญที่สุดเพียงหนึ่งอย่าง
2. **ขอบเขต** — อะไรอยู่ใน v1 และอะไรไว้ทีหลัง
3. **เทคโนโลยี** — เลือกสิ่งที่ส่งมอบได้เร็วและดูแลต่อได้
4. **หมุดหมาย** — ขั้นเล็ก ๆ ที่เดโมได้

อยากให้ผมสร้างเลยไหมครับ? เปิด **Aof Code** แล้วผมจะพาจากไอเดียไปเป็นโค้ดที่ใช้งานได้`;
    }
    const base = `This is an engineering task, so I'd hand it to **Aof Code**.`;
    if (style === "short") return `${pre}${base} Open **Aof Code** and I'll plan, generate and review the files.`;
    return `${pre}${base}

1. **Goal** — nail the single most important outcome.
2. **Scope** — what's in v1 vs. later.
3. **Stack** — something you can ship fast and maintain.
4. **Milestones** — small, demoable steps.

Want me to build it? Open **Aof Code** and I'll take it from idea to working code.`;
  }

  if (/(hello|hi|hey|สวัสดี|หวัดดี)/.test(m) && attachments.length === 0) {
    if (th) {
      return `สวัสดีครับ! ผมคือ **Aof** — เวิร์กสเปซ AI ของคุณ ผมช่วยระดมไอเดีย ช่วยเรียนรู้ อ่านรูปภาพและ PDF หรือกระโดดเข้า **Aof Code** เพื่อสร้างซอฟต์แวร์จริงได้ วันนี้อยากทำอะไรดีครับ?`;
    }
    return `Hi! I'm **Aof** — your AI workspace. I can chat through ideas, help you learn, read images & PDFs, or jump into **Aof Code** to build real software. What are we working on today?`;
  }

  if (th) {
    const openerTh = pick([
      "นี่คือแนวทางที่ผมจะทำครับ",
      "ยินดีช่วยเรื่องนี้ครับ",
      "มาแยกเรื่องนี้กันทีละส่วนครับ",
    ]);

    if (style === "short") {
      return `${pre}${pick(["สรุปสั้น ๆ:", "พูดให้กระชับ:"])} ${pick([
        "พอเห็นแก่นหลักแล้วเรื่องนี้ก็ตรงไปตรงมาครับ",
        "มันสรุปลงที่หลักการสำคัญหนึ่งหรือสองข้อ",
      ])} ถ้าอยากได้เพิ่มบอกได้เลย เดี๋ยวผมขยายความให้`;
    }

    if (style === "detailed") {
      return `${pre}${openerTh}

**ภาพรวม**
ก่อนอื่นมองภาพใหญ่: ${pick([
        "แก่นของเรื่องง่ายกว่าที่คิดเมื่อเราจับองค์ประกอบที่เกี่ยวข้องได้ครบ",
        "ทั้งหมดวางอยู่บนหลักการไม่กี่ข้อที่นำไปใช้ซ้ำได้ทุกที่",
      ])}

**ทีละขั้น**
1. เริ่มจากปัญหาที่มันแก้ ไม่ใช่ศัพท์เทคนิค
2. สร้างแบบจำลองความคิดเล็ก ๆ ที่ทดสอบได้
3. ลองทำตัวอย่างให้ครบตั้งแต่ต้นจนจบ
4. แล้วค่อยเพิ่มกรณีขอบเข้าไป

**ตัวอย่าง**
ตัวอย่างจริงจะทำให้แต่ละขั้นชัดขึ้น บอกเคสของคุณมา เดี๋ยวผมใส่ให้

อยากให้เจาะลึกส่วนไหนเพิ่มอีกไหมครับ?`;
    }

    // normal
    return `${pre}${openerTh}

**สรุป** — ${pick([
      "แก่นของเรื่องง่ายกว่าที่คิดเมื่อเห็นองค์ประกอบที่ขยับ",
      "มันสรุปลงที่หลักการไม่กี่ข้อที่นำไปใช้ซ้ำได้ทุกที่",
    ])}

**ทำไม**
- เริ่มจากปัญหาที่มันแก้ ไม่ใช่ศัพท์เทคนิค
- สร้างแบบจำลองความคิดเล็ก ๆ ที่ทดสอบได้
- แล้วค่อยเพิ่มกรณีขอบเข้าไป

บอกให้ผมเจาะลึกเพิ่ม หรือสลับเป็นโหมด **Detailed** เพื่อดูแบบเต็มได้ครับ`;
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
