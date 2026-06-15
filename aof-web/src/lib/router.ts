// ── Aof Router ─────────────────────────────────────────────────────────────────
// Inspects each request (text + attachments) and decides which agent handles it,
// so the user never has to pick manually. Agent priority order:
//   1. code file attachment            → Aof Code
//   2. explicit web-search intent      → Search Agent
//   3. deep analysis / strategy        → Aof Reasoning
//   4. research / fact-finding         → Aof Research
//   5. teaching / learning intent      → Aof Tutor
//   6. engineering / programming       → Aof Code
//   7. image / PDF (no coding ask)     → Aof Chat
//   8. default                         → Aof Chat

import type { Attachment, RouteDecision, RouteTarget } from "./types";

const LABEL: Record<RouteTarget, string> = {
  chat: "Aof Chat",
  code: "Aof Code",
  search: "Search Agent",
  tutor: "Aof Tutor",
  reasoning: "Aof Reasoning",
  research: "Aof Research",
};

// Keyword sets (English + Thai).
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

const REASONING = [
  /\btradeoff\b|\btrade[- ]off\b/,
  /\bstrategic\b|\bstrategy\b/,
  /\broot cause\b/,
  /\bdecision\b/,
  /\bpros?\s+and\s+cons?\b/,
  /\bcompare\b.*\bvs\b|\bvs\b.*\bcompare\b/,
  /\banalyz(e|is)\b.*\b(system|product|business|design|project)\b/,
  /\bshould\s+i\s+(choose|use|pick|go with)\b/,
  /วิเคราะห์|เปรียบเทียบ|ตัดสินใจ|กลยุทธ์|ข้อดีข้อเสีย/,
];

const RESEARCH = [
  /\bresearch\b/,
  /\binvestigate\b/,
  /\bfind\s+out\b/,
  /\bhistory\s+of\b/,
  /\bwho\s+(is|was|invented|created|made|founded)\b/,
  /\bwhen\s+(was|did|were)\b/,
  /\bwhy\s+(did|does|is|are|was|were)\b/,
  /วิจัย|ค้นคว้า|ประวัติ|ใครคือ|ทำไม.*ถึง/,
];

const TUTOR = [
  /\bteach\s*me\b/,
  /\bexplain\b/,
  /\btutorial\b/,
  /\bhow\s+to\s+learn\b/,
  /\bi\s+(want|need)\s+to\s+(learn|understand|know)\b/,
  /\bwhat\s+is\s+(a\s+)?\b/,
  /\bwhat\s+are\s+(the\s+)?\b/,
  /\bhow\s+does\b/,
  /\bconcept\s+of\b/,
  /สอน|อธิบาย|เรียนรู้|ทำความเข้าใจ|คืออะไร|ทำงานยังไง/,
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

  // 1. Code / document files → Aof Code.
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

  // 3. Deep analysis / strategy / decisions → Aof Reasoning.
  if (anyMatch(t, REASONING)) {
    return {
      target: "reasoning",
      label: LABEL.reasoning,
      reason: "Complex analytical task — routed to Aof Reasoning.",
    };
  }

  // 4. Research / fact-finding → Aof Research.
  if (anyMatch(t, RESEARCH)) {
    return {
      target: "research",
      label: LABEL.research,
      reason: "Research or fact-finding request — routed to Aof Research.",
    };
  }

  // 5. Teaching / learning → Aof Tutor.
  if (anyMatch(t, TUTOR)) {
    return {
      target: "tutor",
      label: LABEL.tutor,
      reason: "Learning or explanation request — routed to Aof Tutor.",
    };
  }

  // 6. Engineering intent → Aof Code.
  if (anyMatch(t, CODE)) {
    return {
      target: "code",
      label: LABEL.code,
      reason: "Detected a software / engineering task.",
    };
  }

  // 7. Images & PDFs without a coding ask → Aof Chat.
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

  // 8. Default — general questions, knowledge, summaries → Aof Chat.
  return {
    target: "chat",
    label: LABEL.chat,
    reason: "General question — handled by Aof Chat.",
  };
}

export function routeLabel(target: RouteTarget): string {
  return LABEL[target];
}
