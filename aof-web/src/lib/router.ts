// ── Co.AI Universal Router ────────────────────────────────────────────────────
// Classifies all user requests into one of 16 task categories and routes them
// to the appropriate Co.AI system. Users never need to select a mode manually.

import type { Attachment, RouteDecision, RouteTarget } from "./types";

export type TaskCategory =
  | 'coding'
  | 'image_generation'
  | 'image_editing'
  | 'research'
  | 'writing'
  | 'mathematics'
  | 'science'
  | 'data_analysis'
  | 'education'
  | 'business'
  | 'translation'
  | 'ui_design'
  | 'ux_design'
  | 'product_design'
  | 'video'
  | 'audio'
  | 'multi_step';

export interface ClassificationResult {
  categories: TaskCategory[];
  primary: TaskCategory;
  isMultiStep: boolean;
}

const LABEL: Record<RouteTarget, string> = {
  chat: "Co.AI",
  code: "CoCode",
  search: "Search Agent",
};

// ── Category rule definitions ─────────────────────────────────────────────────

interface CategoryRule {
  category: TaskCategory;
  weight: number;
  patterns: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'image_generation',
    weight: 10,
    patterns: [
      /\bgenerate\b.{0,30}\bimage\b/i, /\bcreate\b.{0,30}\b(image|picture|photo)\b/i,
      /\bdraw\b/i, /\billustrat/i, /\bartwork\b/i, /\bpaint(ing)?\b/i,
      /\bai.{0,10}(image|art|picture)/i, /\btext.{0,10}to.{0,10}image\b/i,
      /สร้างรูป/i, /วาดรูป/i, /ภาพ.{0,10}AI/i,
    ],
  },
  {
    category: 'image_editing',
    weight: 10,
    patterns: [
      /\bedit\b.{0,30}\bimage\b/i, /\bremove\b.{0,30}(background|object)/i,
      /\bupscale\b/i, /\binpaint/i, /\bstyle transfer/i, /\bretouche?/i,
      /แก้ไขรูป/i, /ตัดพื้นหลัง/i,
    ],
  },
  {
    category: 'coding',
    weight: 8,
    patterns: [
      /\bcode\b/i, /\bcoding\b/i, /\bprogram(ming)?\b/i, /\bdebug\b/i,
      /\bfunction\b/i, /\bclass\b|\bapi\b/i, /\bscript\b/i,
      /\barchitecture\b|\bsystem design\b/i,
      /\bwebsite\b|\bweb ?app\b|\bfront[- ]?end\b|\bback[- ]?end\b/i,
      /\bmobile app\b|\bapp dev(elopment)?\b/i,
      /\bgithub\b|\bpull request\b|\brepo(sitory)?\b/i,
      /\bdeploy(ment)?\b|\bci[\/-]?cd\b/i,
      /\breact\b|\bnext\.?js\b|\bnode\.?js\b|\bpython\b|\btypescript\b|\bjavascript\b/i,
      /\bdocker\b|\bkubernetes\b|\bsql\b|\bdatabase\b|\bschema\b/i,
      /เขียนโปรแกรม|เขียนโค้ด|โค้ด|ดีบัก|แก้บั๊ก/i,
      /สถาปัตยกรรมซอฟต์แวร์|ออกแบบระบบ|ฐานข้อมูล/i,
      /เว็บไซต์|เว็บแอป|แอปพลิเคชัน/i,
    ],
  },
  {
    category: 'ui_design',
    weight: 9,
    patterns: [
      /\bui\b/i, /\buser interface\b/i,
      /\bdesign\b.{0,20}\b(page|screen|layout|component|button|form)\b/i,
      /\bwireframe\b/i, /\bmockup\b/i, /\bprototype\b/i, /\bfigma\b/i,
      /\bcolor\b.{0,20}(scheme|palette|system)/i,
      /ออกแบบ.{0,20}หน้าจอ/i, /ออกแบบ.{0,20}UI/i,
    ],
  },
  {
    category: 'ux_design',
    weight: 9,
    patterns: [
      /\bux\b/i, /\buser experience\b/i, /\buser flow\b/i, /\buser journey\b/i,
      /\busability\b/i, /\baccessibility\b/i, /\bpersona\b/i, /\bempathy map\b/i,
      /ประสบการณ์ผู้ใช้/i,
    ],
  },
  {
    category: 'product_design',
    weight: 7,
    patterns: [
      /\bproduct design\b/i, /\bproduct strategy\b/i, /\bprd\b/i,
      /\bproduct requirements?\b/i, /\broadmap\b/i, /\bfeature.{0,20}spec\b/i,
      /ออกแบบผลิตภัณฑ์/i, /กลยุทธ์ผลิตภัณฑ์/i,
    ],
  },
  {
    category: 'research',
    weight: 5,
    patterns: [
      /\bresearch\b/i, /\bsummarize\b/i, /\bsummary\b/i,
      /\bwhat is\b/i, /\bhow does\b/i, /\bwhy does\b/i,
      /\bcompare\b/i, /\bfind information\b/i, /\blook up\b/i,
      /วิจัย/i, /ค้นหาข้อมูล/i, /อธิบาย/i, /สรุป/i,
    ],
  },
  {
    category: 'writing',
    weight: 6,
    patterns: [
      /\bwrite\b.{0,20}\b(blog|article|post|essay|report|email|letter|story|content)\b/i,
      /\bdocument(ation)?\b/i, /\bcopywriting\b/i, /\bproofreading?\b/i,
      /\bdraft\b/i, /\bparaphrase\b/i,
      /เขียน.{0,20}(บทความ|รายงาน|อีเมล|จดหมาย)/i,
    ],
  },
  {
    category: 'mathematics',
    weight: 9,
    patterns: [
      /\bcalculate\b/i, /\bsolve\b.{0,20}\b(equation|math|problem)\b/i,
      /\bintegral\b/i, /\bderivative\b/i, /\bmatrix\b/i, /\bstatistic\b/i,
      /\balgebra\b/i, /\bcalculus\b/i, /\bprobability\b/i,
      /\d+\s*[+\-*/^]\s*\d+/,
      /คำนวณ/i, /สมการ/i, /คณิตศาสตร์/i,
    ],
  },
  {
    category: 'science',
    weight: 6,
    patterns: [
      /\bphysics\b/i, /\bchemistry\b/i, /\bbiology\b/i, /\bastronomy\b/i,
      /\bquantum\b/i, /\bmolecule\b/i, /\bgenetics\b/i, /\bscientific\b/i,
      /ฟิสิกส์/i, /เคมี/i, /ชีววิทยา/i, /วิทยาศาสตร์/i,
    ],
  },
  {
    category: 'data_analysis',
    weight: 8,
    patterns: [
      /\bdata analysis\b/i, /\banalyze data\b/i, /\bcsv\b/i, /\bspreadsheet\b/i,
      /\bchart\b|\bgraph\b|\bvisualization\b|\bdataset\b/i,
      /\bmachine learning\b|\bml model\b|\bai model\b/i,
      /วิเคราะห์ข้อมูล/i, /แผนภูมิ/i,
    ],
  },
  {
    category: 'education',
    weight: 5,
    patterns: [
      /\bteach\b|\btutor\b|\blearn\b/i, /\blesson\b|\bcourse\b/i,
      /\bquiz\b|\bexercise\b|\bhomework\b/i,
      /สอน/i, /เรียน/i, /การศึกษา/i, /แบบทดสอบ/i,
    ],
  },
  {
    category: 'business',
    weight: 6,
    patterns: [
      /\bbusiness plan\b/i, /\bmarketing\b|\bstrategy\b/i, /\bfinancial\b/i,
      /\bstartup\b|\bpitch deck\b|\bswot\b|\bkpi\b/i,
      /แผนธุรกิจ/i, /การตลาด/i,
    ],
  },
  {
    category: 'translation',
    weight: 9,
    patterns: [
      /\btranslate\b/i, /\btranslation\b/i, /\blocalize\b/i,
      /\bfrom (english|thai|japanese|chinese|french|spanish|german)\b/i,
      /\bto (english|thai|japanese|chinese|french|spanish|german)\b/i,
      /แปล(ภาษา)?/i,
    ],
  },
  {
    category: 'video',
    weight: 9,
    patterns: [
      /\bvideo\b.{0,20}(script|edit|create|generate)/i,
      /\bscreenplay\b|\bstoryboard\b|\byoutube\b|\btiktok\b/i,
      /วิดีโอ/i, /สคริปต์วิดีโอ/i,
    ],
  },
  {
    category: 'audio',
    weight: 9,
    patterns: [
      /\bpodcast\b|\bsong\b|\blyric\b|\bmusic\b/i,
      /\bsound effect\b|\bvoiceover\b/i,
      /เพลง/i, /เนื้อเพลง/i, /พอดแคสต์/i,
    ],
  },
];

// ── Build-intent detection ────────────────────────────────────────────────────
// Coding-related messages split into two kinds: *build intents* (the user wants
// an artifact produced or worked on — CoCode territory) and *engineering
// questions* (the user wants advice or an explanation — answer directly in
// chat). Deflecting a question to CoCode reads as a brush-off, so only route
// there when the user actually asked for work to be done.

const BUILD_INTENT_PATTERNS: RegExp[] = [
  // do-verb … artifact: "build a todo app", "create a REST API", "make me a game"
  /\b(build|create|make|generate|scaffold|implement|develop|prototype)\b.{0,40}\b(app|apps|website|web ?app|site|page|api|game|bot|script|tool|dashboard|component|service|backend|frontend|cli|extension|plugin)\b/i,
  // "write (me) some code / a script / a function"
  /\bwrite\b.{0,20}\b(code|script|program|function|class|component|test)\b/i,
  // working on a concrete artifact the user has: "debug this function", "fix my code"
  /\b(debug|fix|refactor|optimize|review)\b.{0,10}\b(this|my|the)\b.{0,30}\b(code|function|class|component|script|bug|error|file)\b/i,
  // designing a system/architecture is a work product, not a lookup
  /\b(design|plan)\b.{0,30}\b(architecture|schema|system|database)\b/i,
  // Thai build intents: สร้าง/ทำ/เขียน + สิ่งที่ได้ชิ้นงาน
  /(สร้าง|ทำ|เขียน).{0,20}(เว็บ|แอป|เกม|api|บอท|ระบบ|โปรแกรม|โค้ด|สคริปต์|หน้าเว็บ)/i,
  /(แก้บั๊ก|ดีบัก|แก้โค้ด|รีแฟคเตอร์)/i,
];

/** True when the user is asking for an artifact to be produced or worked on. */
export function isBuildIntent(text: string): boolean {
  return BUILD_INTENT_PATTERNS.some((p) => p.test(text));
}

// ── Web search patterns ───────────────────────────────────────────────────────

const SEARCH_PATTERNS: RegExp[] = [
  /\bsearch\b|\bweb\s*search\b|\bgoogle\b|\blook\s*up\b/i,
  /\blatest\b|\bnews\b|\bcurrent(ly)?\b|\btoday'?s\b|\bright now\b/i,
  /ค้นหา|ค้นเว็บ|ข่าว|ล่าสุด/,
  /ราคา.*(วันนี้|ตอนนี้)/,
];

// ── Classification logic ──────────────────────────────────────────────────────

function scoreCategories(text: string): Array<{ category: TaskCategory; score: number }> {
  const lower = text.toLowerCase();
  const results: Array<{ category: TaskCategory; score: number }> = [];

  for (const rule of CATEGORY_RULES) {
    const matches = rule.patterns.filter((p) => p.test(lower)).length;
    if (matches > 0) {
      results.push({ category: rule.category, score: matches * rule.weight });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function classifyRequest(text: string, attachments: Attachment[] = []): ClassificationResult {
  const scored = scoreCategories(text);
  const categories = scored.map((s) => s.category);
  const primary: TaskCategory = categories[0] ?? 'research';
  const isMultiStep = categories.length >= 3 || text.split(/[.!?]/).length >= 4;

  if (isMultiStep && !categories.includes('multi_step')) {
    categories.push('multi_step');
  }

  // Code file attachment forces coding category
  if (attachments.some((a) => a.kind === 'code') && !categories.includes('coding')) {
    categories.unshift('coding');
  }

  // Image attachment can indicate image_editing
  if (attachments.some((a) => a.kind === 'image') && !categories.includes('image_editing') && !categories.includes('image_generation')) {
    categories.unshift('image_editing');
  }

  return { categories: categories.slice(0, 8), primary, isMultiStep };
}

// ── Route decision (backward-compatible with existing 3-route system) ─────────

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((re) => re.test(text)).length;
}

/** Decide where a request should go. Attachments can force a route. */
export function routeRequest(text: string, attachments: Attachment[] = []): RouteDecision {
  const t = text.toLowerCase();

  // Code/document files → CoCode
  const codeFile = attachments.find((a) => a.kind === "code");
  if (codeFile) {
    return {
      target: "code",
      label: LABEL.code,
      reason: `Analyzing ${codeFile.name} — file analysis runs in CoCode.`,
      confidence: 100,
    };
  }

  // Explicit web-search intent
  const searchMatches = countMatches(t, SEARCH_PATTERNS);
  if (searchMatches > 0) {
    return {
      target: "search",
      label: LABEL.search,
      reason: "This looks like a live web-search request.",
      confidence: Math.min(searchMatches * 45, 90),
    };
  }

  // Build intent → CoCode. Only actual work requests go there; engineering
  // questions ("how do I deploy to Vercel?") are answered right here in chat,
  // because deflecting a question to another surface reads as a brush-off.
  if (isBuildIntent(text)) {
    return {
      target: "code",
      label: LABEL.code,
      reason: "This is a build request — routing to CoCode.",
      confidence: 85,
    };
  }

  // Classify using 16-category system
  const classification = classifyRequest(text, attachments);

  if (classification.categories.length > 0) {
    const primary = classification.primary;

    const categoryConfidence: Record<string, number> = {
      coding: 85, ui_design: 80, data_analysis: 80,
      image_generation: 75, image_editing: 75,
      mathematics: 70, science: 65, translation: 90,
      research: 65, writing: 65, business: 65,
    };

    // Images & PDFs → Co.AI reads them directly
    const visual = attachments.find((a) => a.kind === "image" || a.kind === "pdf");
    if (visual) {
      return {
        target: "chat",
        label: LABEL.chat,
        reason: visual.kind === "image" ? "Understanding the image you shared." : "Reading the PDF you shared.",
        confidence: 80,
      };
    }

    const codeTopics = new Set<TaskCategory>(['coding', 'data_analysis', 'ui_design']);
    const reason = codeTopics.has(primary)
      ? "Engineering question — answering here."
      : `Handling as ${classification.categories.slice(0, 2).map((c) => c.replace(/_/g, ' ')).join(' + ')} request.`;

    return { target: "chat", label: LABEL.chat, reason, confidence: categoryConfidence[primary] ?? 70 };
  }

  // Default → Co.AI
  return {
    target: "chat",
    label: LABEL.chat,
    reason: "General question — handled by Co.AI.",
    confidence: 70,
  };
}

export function routeLabel(target: RouteTarget): string {
  return LABEL[target];
}
