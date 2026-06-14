// ── Aof Router ─────────────────────────────────────────────────────────────────
// Inspects each request (text + attachments) and decides which system handles it,
// so the user never has to pick a model. Mirrors the routing rules in the product
// spec:
//   • General questions / knowledge / explanations → Aof Chat
//   • Coding / debug / web & app dev / file analysis → Aof Code
//   • Deep reasoning / architecture / strategy / research → Titan
//   • Explicit web-search requests → Search Agent

import type { Attachment, RouteDecision, RouteTarget } from "./types";

const LABEL: Record<RouteTarget, string> = {
  chat: "Aof Chat",
  code: "Aof Code",
  search: "Search Agent",
  titan: "Titan",
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

// Titan handles deep reasoning, system design, strategy and research — not a quick
// how-to (that's Aof Code) and not a casual explainer (that's Aof Chat).
const TITAN = [
  /\barchitect(ure)?\b/,
  /\bsystem design\b/,
  /\bscalab(le|ility)\b/,
  /\bdistributed\b/,
  /\bhigh[- ]?level design\b/,
  /\bdesign (a|an|the|my)?\s*(system|platform|service|pipeline|infrastructure|architecture)/,
  /\bstrateg(y|ic)\b/,
  /\broadmap\b/,
  /\btrade[- ]?offs?\b/,
  /\bpros and cons\b/,
  /\bbusiness (plan|model|case|strategy)\b/,
  /\bproduct (plan|strategy|roadmap|spec)\b/,
  /\b(research|investigate|deep dive|analy[sz]e)\b.*\b(approach|option|market|landscape|feasibilit)/,
  /\b(compare|evaluate)\b.*\b(approach|architecture|stack|framework|database|option)/,
  /\bshould (i|we) (use|choose|pick|go with)\b/,
  /\bplan (a|an|the|my)?\s*(product|platform|migration|rollout|launch)/,
  /ออกแบบระบบ|สถาปัตยกรรม|กลยุทธ์|ขยายระบบ|วางแผนผลิตภัณฑ์|วิเคราะห์เชิงลึก|ข้อดีข้อเสีย/,
];

const CODE = [
  /\bcode\b/,
  /\bcoding\b/,
  /\bprogram(ming)?\b/,
  /\bdebug\b/,
  /\bbug\b/,
  /\berror\b|\bexception\b|\bstack ?trace\b/,
  /\brefactor\b/,
  /\bfunction\b|\bclass\b|\bcomponent\b|\bapi\b/,
  /\bwebsite\b|\bweb ?app\b|\bfront[- ]?end\b|\bback[- ]?end\b/,
  /\bapp\b|\bmobile app\b/,
  /\bcss\b|\bhtml\b|\btailwind\b|\bflex ?box\b|\bgrid\b|\bdiv\b/,
  /\bcenter (a|the)?\s*\w+/, // "center a div", "center the box"
  /\bstyl(e|ing)\b|\blayout\b|\bresponsive\b/,
  /\bsql\b|\bquery\b|\bregex\b|\balgorithm\b|\bsnippet\b/,
  /\bgithub\b|\bpull request\b|\brepo(sitory)?\b|\bcommit\b/,
  /\bdeploy\b|\bbuild (me|a|an|the)\b/,
  /\breact\b|\bnext\.?js\b|\bvue\b|\bnode\b|\bpython\b|\btypescript\b|\bjavascript\b/,
  /เขียนโปรแกรม|เขียนโค้ด|โค้ด|ดีบัก|แก้บั๊ก|เว็บไซต์|แอป|ฟังก์ชัน/,
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

  // 3. Deep reasoning / architecture / strategy / research → Titan.
  if (anyMatch(t, TITAN)) {
    return {
      target: "titan",
      label: LABEL.titan,
      reason: "Deep reasoning, design or strategy — a job for Titan.",
    };
  }

  // 4. Engineering / coding intent → Aof Code.
  if (anyMatch(t, CODE)) {
    return {
      target: "code",
      label: LABEL.code,
      reason: "Detected a software / engineering task.",
    };
  }

  // 5. Images & PDFs without a coding ask → Aof Chat (image & PDF understanding).
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

  // 6. Default — general questions, knowledge, explanations → Aof Chat.
  return {
    target: "chat",
    label: LABEL.chat,
    reason: "General question — handled by Aof Chat.",
  };
}

export function routeLabel(target: RouteTarget): string {
  return LABEL[target];
}
