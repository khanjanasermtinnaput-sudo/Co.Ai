// Coagentix Titan — the highest-level planning and architecture mode in Coagentix Code.
// STRICT CONTRACT: Titan NEVER writes code. Think First, Build Later.
// Workflow: Discovery → Smart Questions → Deep Analysis → Multi-Plan →
// Devil's Advocate → Self Review → Architecture → Risks → Planning Score →
// APPROVAL GATE → (only then) hand a Blueprint to the TMAP pipeline.
//
// Three stages are ENFORCED IN CODE, not just prompted:
//   1. Confidence Check — a plan with Overall Confidence < minConfidence is
//      withheld and replaced by follow-up questions (extra LLM call).
//   2. Self Review Loop — 5 real review passes (Logic / Architecture /
//      Security / Scalability / Maintainability), then one revision call
//      that applies the findings to the plan.
//   3. Project Memory — callers inject persistent memory context and record
//      approved blueprints as durable architecture decisions.

import type { LLMCall, ChatMessage } from '../types.js';

const TITAN_SYS = `You are AOF TITAN — the highest-level planning and architecture mode in AOF Code.

CORE PHILOSOPHY: Think First, Build Later.
You are NOT a coding assistant. You are an AI System Architect.
Your job: deeply understand goals, discover hidden requirements, analyze multiple
solutions, identify risks, design the architecture — and ONLY release a build
blueprint after explicit user approval.

═══════ STRICT RULES — NEVER BREAK ═══════
- NEVER write code, code blocks with implementation, snippets, or file contents
- NEVER proceed to the blueprint without explicit user approval (option 1)
- Never assume missing requirements — ask instead
- Challenge your own conclusions before presenting them
- Prefer long-term quality over short-term convenience
- Be structured and scannable — headings + short bullet lines, no walls of text
═══════════════════════════════════════════

RESPONSE LANGUAGE: Always reply in the SAME LANGUAGE the user writes in.
Thai input → Thai reply. English input → English reply.

══════════ TITAN WORKFLOW (strict order) ══════════

PHASE 1 — DISCOVERY (your FIRST reply in a session)
Present interactive numbered questions. Always include these three, then add
2–4 SMART QUESTIONS that adapt to the specific project (users, auth, data,
budget, hosting, mobile, scaling, integrations — whatever actually matters here):

## Primary Goal
1. Learning  2. Portfolio  3. Real-world Use  4. Commercial Product  5. Startup

## Quality Target
1. Fastest Development  2. Balanced  3. High Quality  4. Highly Scalable  5. Enterprise Grade

## Complexity Level
1. Beginner  2. Intermediate  3. Advanced  4. Professional  5. Expert

Tell the user they can answer compactly (e.g. "3, 2, 4" + free text).

PHASE 2 — CONFIDENCE CHECK
After each user reply, internally score:
Requirement Understanding / Architecture / Security / Scalability (0–100%).
If OVERALL < 85% → ask up to 3 more focused questions. Do NOT plan yet.
If OVERALL ≥ 85% → produce the FULL PLAN (Phase 3).
The system WILL parse your "Overall Confidence" line and WILL reject the plan
if it is below the threshold — be honest, never inflate the number.

PHASE 3 — FULL PLAN
Output EXACTLY this structure, wrapped in the markers:

===TITAN PLAN===
# Deep Analysis
[requirements, feasibility, performance, security, scalability, cost,
maintainability, UX, long-term growth — from both developer & business view; 5-10 bullets]

# Plans
## Plan A — Fastest
Description / Advantages / Disadvantages / Complexity / Est. Cost / Scalability x/10 / Maintainability x/10
## Plan B — Balanced
(same fields)
## Plan C — Best Long-Term
(same fields)
Ranking: [most suitable → least, with one-line reason]

# Devil's Advocate
[attack the recommended plan: weaknesses, hidden risks, future problems,
cost issues, security concerns, scaling limits — minimum 4 points]

# Architecture
[system architecture, module structure, service layout, database design,
API structure, agent structure, deployment strategy — concise diagrams in
plain text allowed (ascii arrows), but NO code]

# Tech Stack
[each choice: why use it / why not alternatives / tradeoffs]

# Risk Prediction
[bottlenecks, vulnerabilities, tech debt, cost explosion, scaling, maintenance
— each with a mitigation strategy]

# Planning Score
Requirement Understanding: xx%
Architecture Quality: xx%
Security Readiness: xx%
Scalability Readiness: xx%
Cost Efficiency: xx%
Maintainability: xx%
Overall Confidence: xx%
[one line of reasoning per score]
===END PLAN===

Then ALWAYS end with EXACTLY this menu:

APPROVAL REQUIRED
1. Approve and Generate Code
2. Revise Plan
3. Compare More Alternatives
4. Ask More Questions

PHASE 4 — APPROVAL GATE
- If the user picks 2/3/4 (or asks anything) → revise / compare / answer, then
  re-present the updated ===TITAN PLAN=== and the menu again.
- ONLY if the user explicitly approves (replies "1", "approve", "อนุมัติ",
  "เอาเลย", "ตกลง สร้างเลย" or equivalent) → output the final blueprint:

===TITAN BLUEPRINT===
Project: [one-line project name]
Goal: [primary goal + quality target]
Type: [web app / REST API / CLI / etc.]
Users: [who]
Chosen Plan: [A/B/C — name]
Tech Stack: [final stack]
Architecture: [final architecture, compact]
Modules:
- [module — responsibility]
Database:
- [tables/collections + key fields, plain text]
API Endpoints:
- [METHOD /path — purpose]
Files to Create:
- [path — intent]
Implementation Order:
1. [step]
Quality Requirements:
- [non-functional requirements the Coder must honor]
Risks to Mitigate:
- [risk → mitigation the Coder must implement]
===END BLUEPRINT===

After the blueprint add EXACTLY this line (keep in Thai):
✅ Blueprint อนุมัติแล้ว — พิมพ์ /gencode เพื่อส่งให้ TMAP engine สร้างโค้ดตามพิมพ์เขียวนี้
═══════════════════════════════════════════════`;

// ── Self Review Loop (real multi-pass review, TDD-style) ─────────────────────
const REVIEW_PASSES: Array<[name: string, focus: string]> = [
  ['Logic',           'logical consistency: contradictions, missing steps, wrong assumptions, gaps between the requirements and the plan'],
  ['Architecture',    'architecture quality: module boundaries, coupling, data flow, separation of concerns, deployment fit'],
  ['Security',        'security: authentication, secrets handling, injection risks, data exposure, rate limiting, abuse vectors'],
  ['Scalability',     'scalability: bottlenecks, state management, horizontal scaling, growth limits, cost under load'],
  ['Maintainability', 'maintainability: complexity, testability, documentation, technical debt the plan would create'],
];

const REVISION_SYS = `You are AOF TITAN revising your own plan after a multi-pass self review.
Apply the review findings and output the COMPLETE revised plan in the exact same
===TITAN PLAN=== ... ===END PLAN=== format (same sections, updated Planning Score),
followed by the APPROVAL REQUIRED menu with its 4 options.
Never write code. Reply in the same language as the original plan.`;

export interface TitanBlueprint {
  project: string;
  chosenPlan: string;
  techStack: string;
  raw: string; // full blueprint block — fed to the TMAP pipeline as context
}

export type TitanEmit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

export interface TitanOpts {
  emit?: TitanEmit;          // progress reporting (self-review passes etc.)
  memoryContext?: string;    // persistent project memory injected into the system prompt
  selfReview?: boolean;      // default true — real 5-pass review + revision of every plan
  minConfidence?: number;    // default 85 — plans below this are withheld (enforced in code)
}

export interface TitanResult {
  text: string;
  hasPlan: boolean;            // a ===TITAN PLAN=== block is present (approval gate shown)
  hasBlueprint: boolean;       // user approved — blueprint ready for /gencode
  blueprint?: TitanBlueprint;
  confidence?: number;         // parsed "Overall Confidence" (0–100)
  confidenceBlocked?: boolean; // plan was withheld because confidence < minConfidence
  reviewFindings?: string[];   // findings applied by the self-review loop
}

export async function runTitan(
  call: LLMCall,
  history: ChatMessage[],
  userMessage: string,
  opts: TitanOpts = {},
): Promise<TitanResult> {
  const emit = opts.emit ?? (() => {});
  const minConfidence = opts.minConfidence ?? 85;
  const selfReview = opts.selfReview ?? true;

  const systemContent = opts.memoryContext
    ? `${TITAN_SYS}\n\n${opts.memoryContext}\n(Use this project memory: stay consistent with past decisions, do not re-ask what is already known.)`
    : TITAN_SYS;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...history.slice(-30),          // Titan sessions run long — keep more turns than RAA
    { role: 'user', content: userMessage },
  ];

  let text = await call(messages, { temperature: 0.4, maxTokens: 3500 });

  // Blueprint turns (post-approval) skip review — the plan was already reviewed.
  if (hasBlueprintMarkers(text)) {
    return {
      text,
      hasPlan: hasPlanMarkers(text),
      hasBlueprint: true,
      blueprint: parseBlueprint(text),
      confidence: parseConfidence(text) ?? undefined,
    };
  }

  if (!hasPlanMarkers(text)) {
    return { text, hasPlan: false, hasBlueprint: false };
  }

  // ── ENFORCED CONFIDENCE CHECK ──────────────────────────────────────────────
  const confidence = parseConfidence(text);
  if (confidence !== null && confidence < minConfidence) {
    emit('titan', `confidence check FAILED: ${confidence}% < ${minConfidence}% — withholding plan, asking follow-up questions`, 'status');
    const enforcement = await call([
      ...messages,
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `SYSTEM ENFORCEMENT (Titan Confidence Check): your Overall Confidence is ${confidence}%, below the required ${minConfidence}%. Per the TITAN CONFIDENCE CHECK rule you must NOT present the plan yet. Ask the user the focused questions (max 5) needed to raise confidence above ${minConfidence}%. Output the questions only — do NOT include any ===TITAN PLAN=== block.`,
      },
    ], { temperature: 0.3, maxTokens: 800 });
    return {
      text: stripPlanBlock(enforcement),
      hasPlan: false,
      hasBlueprint: false,
      confidence,
      confidenceBlocked: true,
    };
  }

  // ── REAL SELF REVIEW LOOP — 5 passes + revision ───────────────────────────
  let reviewFindings: string[] = [];
  if (selfReview) {
    const planBlock = extractPlanBlock(text);
    reviewFindings = await runReviewPasses(call, planBlock, emit);
    if (reviewFindings.length) {
      emit('titan', `self-review: applying ${reviewFindings.length} finding(s) to the plan`, 'status');
      const revised = await call([
        { role: 'system', content: REVISION_SYS },
        {
          role: 'user',
          content: `${planBlock}\n\nSelf-review findings to apply:\n${reviewFindings.map((f) => `- ${f}`).join('\n')}`,
        },
      ], { temperature: 0.3, maxTokens: 3500 });
      // Replace the plan (and everything after it — the menu) with the revision.
      // If the revision lost the markers, keep the original plan instead.
      if (hasPlanMarkers(revised)) {
        text = text.slice(0, text.indexOf('===TITAN PLAN===')) + revised.trim();
      } else {
        emit('titan', 'self-review revision lost the plan format — keeping the original plan', 'status');
      }
    } else {
      emit('titan', 'self-review: all 5 passes clean — plan unchanged', 'status');
    }
  }

  return {
    text,
    hasPlan: true,
    hasBlueprint: false,
    confidence: parseConfidence(text) ?? confidence ?? undefined,
    reviewFindings: reviewFindings.length ? reviewFindings : undefined,
  };
}

async function runReviewPasses(call: LLMCall, planBlock: string, emit: TitanEmit): Promise<string[]> {
  const findings: string[] = [];
  for (let i = 0; i < REVIEW_PASSES.length; i++) {
    const [name, focus] = REVIEW_PASSES[i];
    emit('titan', `self-review pass ${i + 1}/${REVIEW_PASSES.length}: ${name}`, 'status');
    try {
      const reply = await call([
        {
          role: 'system',
          content: `You are the Titan Self-Review engine (pass: ${name}). Strictly review the plan below ONLY for ${focus}. Reply with at most 3 concrete improvement bullets (each starting with "- "), or exactly "OK" if nothing needs improving. Never write code. Reply in the same language as the plan.`,
        },
        { role: 'user', content: planBlock },
      ], { temperature: 0.2, maxTokens: 350 });

      if (/^\s*OK\b/i.test(reply.trim())) continue;
      for (const line of reply.split('\n')) {
        const m = line.match(/^\s*[-•*]\s+(.{4,})$/);
        if (m) findings.push(`[${name}] ${m[1].trim()}`);
      }
    } catch (e) {
      // A failed pass must not kill the whole planning turn.
      emit('titan', `self-review pass ${name} skipped: ${(e as Error).message}`, 'status');
    }
  }
  return findings;
}

// ── markers + parsers ──────────────────────────────────────────────────────────
function hasPlanMarkers(text: string): boolean {
  return text.includes('===TITAN PLAN===') && text.includes('===END PLAN===');
}
function hasBlueprintMarkers(text: string): boolean {
  return text.includes('===TITAN BLUEPRINT===') && text.includes('===END BLUEPRINT===');
}

function extractPlanBlock(text: string): string {
  const m = text.match(/===TITAN PLAN===[\s\S]*?===END PLAN===/);
  return m ? m[0] : text;
}

function stripPlanBlock(text: string): string {
  return text.replace(/===TITAN PLAN===[\s\S]*?===END PLAN===/g, '').trim();
}

/** Parse the (last) "Overall Confidence: xx%" line. null when absent. */
export function parseConfidence(text: string): number | null {
  const matches = [...text.matchAll(/Overall Confidence:\s*(\d{1,3})\s*%/gi)];
  if (!matches.length) return null;
  const v = Number(matches[matches.length - 1][1]);
  return Number.isFinite(v) ? Math.min(v, 100) : null;
}

export function parseBlueprint(text: string): TitanBlueprint {
  const block = text.match(/===TITAN BLUEPRINT===([\s\S]*?)===END BLUEPRINT===/)?.[1] ?? '';
  const line = (key: string) =>
    block.match(new RegExp(`^${key}:\\s*(.+)`, 'm'))?.[1]?.trim() ?? '';
  return {
    project:    line('Project'),
    chosenPlan: line('Chosen Plan'),
    techStack:  line('Tech Stack'),
    raw:        block.trim(),
  };
}

// Turn an approved blueprint into TMAP build inputs.
export function blueprintToBuild(bp: TitanBlueprint): { task: string; context: string } {
  return {
    task: bp.project || 'project from Titan blueprint',
    context: `## Approved Titan Blueprint (follow this exactly)\n${bp.raw}`,
  };
}
