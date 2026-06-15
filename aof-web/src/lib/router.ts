// ── Aof Router ─────────────────────────────────────────────────────────────────
// Inspects each request (text + attachments) and decides which system handles it,
// so the user never has to pick a model. Mirrors the routing rules in the product
// spec:
//   • General questions / knowledge / summaries → Aof Chat
//   • Programming / debug / architecture / web & app dev / GitHub / file analysis → Aof Code
//   • Explicit web-search requests → Search Agent

import type { Attachment, RouteDecision, RouteTarget } from "./types";

const LABEL: Record<RouteTarget, string> = {
  chat: "Aof Chat",
  code: "Aof Code",
  search: "Search Agent",
};

// Keyword sets (English + Thai, matching the rest of the product copy).
const SEARCH: RegExp[] = [
  /\bsearch\b/,
  /\bweb\s*search\b/,
  /\bgoogle\b/,
  /\blook\s*up\b/,
  /\blatest\b/,
  /\bnews\b/,
  /\bcurrent(ly)?\b/,
  /\btoday'?s\b/,
  /\bright now\b/,
  /ค้นหา/,
  /ค้นเว็บ/,
  /ข่าว/,
  /ล่าสุด/,
  /ราคา.*(วันนี้|ตอนนี้)/,
];

const CODE: RegExp[] = [
  /\bcode\b/,
  /\bcoding\b/,
  /\bprogram(ming)?\b/,
  /\bdebug\b/,
  /\bbug\b/,
  /\berror\b|\bexception\b|\bstack ?trace\b/,
  /\brefactor\b/,
  /\bfunction\b|\bclass\b|\bapi\b/,
  /\barchitecture\b|\bsystem design\b/,
  /\bwebsite\b|\bweb ?app\b|\bfront[- ]?end\b|\bback[- ]?end\b/,
  // narrowed: removed bare \bapp\b (too broad — matched "app" in general conversation)
  /\bmobile app\b|\bapp dev(elopment)?\b/,
  /\bgithub\b|\bpull request\b|\bpr\b|\brepo(sitory)?\b|\bcommit\b/,
  // narrowed: removed bare \bbuild\b (matched "build confidence", "build a habit", etc.)
  /\bdeploy(ment)?\b|\bci[\/-]?cd\b/,
  /\breact\b|\bnext\.?js\b|\bnode\.?js\b|\bpython\b|\btypescript\b|\bjavascript\b/,
  /\bdocker\b|\bkubernetes\b|\bterraform\b|\baws\b|\bgcp\b|\bazure\b/,
  /\bsql\b|\bdatabase\b|\bschema\b|\bmigration\b/,
  // Thai — split into multiple entries so each adds independently to the match count
  /เขียนโปรแกรม|เขียนโค้ด|โค้ด|ดีบัก|แก้บั๊ก/,
  /สถาปัตยกรรมซอฟต์แวร์|ออกแบบระบบ|ฐานข้อมูล|เซิร์ฟเวอร์/,
  // narrowed: removed bare แอป — too ambiguous; require specific compound forms
  /เว็บไซต์|เว็บแอป|แอปพลิเคชัน|แอปมือถือ/,
  /ฟังก์ชัน|คลาส|เมธอด|ตัวแปร|ลูป/,
  /บั๊ก|อีเรอร์|ข้อผิดพลาด|แก้ไขโค้ด|สคริปต์/,
];

/** Count how many patterns match (each pattern counts once regardless of occurrences). */
function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((re) => re.test(text)).length;
}

/** Confidence from match count: 1 match → 35, 2 → 60, 3+ → 85, capped at 95. */
function codeConfidence(matches: number): number {
  return Math.min(Math.round(matches * 30 + 5), 95);
}

/** Decide where a request should go. Attachments can force a route. */
export function routeRequest(text: string, attachments: Attachment[] = []): RouteDecision {
  const t = text.toLowerCase();

  // 1. Code / document files are file-analysis → Aof Code.
  const codeFile = attachments.find((a) => a.kind === "code");
  if (codeFile) {
    return {
      target: "code",
      label: LABEL.code,
      reason: `Analyzing ${codeFile.name} — file analysis runs in Aof Code.`,
      confidence: 100,
    };
  }

  // 2. Explicit web-search intent wins over everything textual.
  const searchMatches = countMatches(t, SEARCH);
  if (searchMatches > 0) {
    return {
      target: "search",
      label: LABEL.search,
      reason: "This looks like a live web-search request.",
      confidence: Math.min(searchMatches * 45, 90),
    };
  }

  // 3. Engineering intent → Aof Code.
  const codeMatches = countMatches(t, CODE);
  if (codeMatches > 0) {
    return {
      target: "code",
      label: LABEL.code,
      reason: "Detected a software / engineering task.",
      confidence: codeConfidence(codeMatches),
    };
  }

  // 4. Images & PDFs without a coding ask → Aof Chat (image & PDF understanding).
  const visual = attachments.find((a) => a.kind === "image" || a.kind === "pdf");
  if (visual) {
    return {
      target: "chat",
      label: LABEL.chat,
      reason:
        visual.kind === "image"
          ? "Understanding the image you shared."
          : "Reading the PDF you shared.",
      confidence: 80,
    };
  }

  // 5. Default — general questions, knowledge, summaries → Aof Chat.
  return {
    target: "chat",
    label: LABEL.chat,
    reason: "General question — handled by Aof Chat.",
    confidence: 70,
  };
}

export function routeLabel(target: RouteTarget): string {
  return LABEL[target];
}
