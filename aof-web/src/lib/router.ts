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

// Keyword sets (English + a little Thai, matching the rest of the product copy).
const SEARCH = [
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

const CODE = [
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
  /\bapp\b|\bmobile app\b/,
  /\bgithub\b|\bpull request\b|\bpr\b|\brepo(sitory)?\b|\bcommit\b/,
  /\bdeploy\b|\bbuild\b/,
  /\breact\b|\bnext\.?js\b|\bnode\b|\bpython\b|\btypescript\b|\bjavascript\b/,
  /เขียนโปรแกรม|เขียนโค้ด|โค้ด|ดีบัก|แก้บั๊ก|สถาปัตยกรรม|เว็บไซต์|แอป/,
];

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
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
    };
  }

  // 2. Explicit web-search intent wins over everything textual.
  if (anyMatch(t, SEARCH)) {
    return {
      target: "search",
      label: LABEL.search,
      reason: "This looks like a live web-search request.",
    };
  }

  // 3. Engineering intent → Aof Code.
  if (anyMatch(t, CODE)) {
    return {
      target: "code",
      label: LABEL.code,
      reason: "Detected a software / engineering task.",
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
    };
  }

  // 5. Default — general questions, knowledge, summaries → Aof Chat.
  return {
    target: "chat",
    label: LABEL.chat,
    reason: "General question — handled by Aof Chat.",
  };
}

export function routeLabel(target: RouteTarget): string {
  return LABEL[target];
}
