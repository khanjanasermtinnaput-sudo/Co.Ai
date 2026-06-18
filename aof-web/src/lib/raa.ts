// ── Aof Code — Requirements Architect (RAA) helpers ───────────────────────────
// Aof Code is conversation-first. Before any code is generated, the Requirements
// Architect Agent (RAA) discusses the project and gathers requirements WITHOUT
// writing code. This module mirrors the contract in tmap-v2/src/core/raa.ts so a
// brief parses identically no matter which engine produced it:
//   • live tmap-v2 backend  → POST /v1/chat (real RAA + DARS failover)
//   • same-origin LLM route → POST /api/chat?agent=requirements (uses RAA_SYSTEM)
//   • offline demo          → the deterministic mock in lib/mock.ts
//
// Keep this file browser/server-safe: it must be importable from both the React
// client and the /api/chat route handler. No "use client", no browser-only APIs.

import type { ProjectBrief } from "./types";

const SUMMARY_OPEN = "===REQUIREMENT SUMMARY===";
const SUMMARY_CLOSE = "===END SUMMARY===";

/** The line RAA appends after every brief, inviting the user to generate. */
export const GENCODE_HINT =
  "✅ พร้อมแล้ว — กดปุ่ม Generate Code หรือพิมพ์ /gencode เพื่อเริ่มสร้างโค้ด (หรือบอกถ้าต้องการแก้ Requirement)";

/** NORMAL_CHAT persona — Aof Code when no project is active.
 *  Handles greetings, tech Q&A, and discussions naturally without triggering RAA.
 *  The state machine (conversation-state.ts) decides when to switch to RAA (DISCOVERY). */
export const AOF_CODE_CHAT_SYSTEM = `You are CoAgentix Code — a senior software engineer available to talk through ideas and answer technical questions.

Right now you are having a NORMAL CONVERSATION. There is no active project.

WHAT YOU DO:
- Reply naturally to greetings (e.g. "Hey! What are you working on today?")
- Explain technical concepts clearly — Next.js vs React, when to use TypeScript, etc.
- Help the user think through ideas and trade-offs
- Discuss architecture, tooling, best practices
- Be concise and conversational — no walls of text

WHAT YOU NEVER DO:
- Ask project requirement questions (that's for when a project exists)
- Create requirement summaries or project plans unprompted
- Write full implementation code unless the user explicitly asks for a snippet
- Redirect the user to "open CoAgentix Code" — they are already here
- Treat every message as the start of a coding project

If the user eventually describes something they want to build, acknowledge naturally and ask ONE clarifying question — the state machine will handle routing them to the project flow automatically.

RESPONSE LANGUAGE: Always reply in the SAME LANGUAGE the user writes in.
Thai input → Thai reply. English input → English reply.`;

// ── Serverless build-pipeline personas ────────────────────────────────────────
// When the tmap-v2 backend is not configured, Aof Code's build actions (Generate /
// Plan / Analyze / Debug) run through the same /api/chat provider as a single-pass
// LLM call. These prompts shape each action. They never fake output — a provider
// failure still surfaces as a structured error.

/** "Generate Code" — produce complete, runnable code. */
export const AOF_CODE_GEN_SYSTEM = `You are CoAgentix Code — an expert software engineer. The user has described a project (and maybe a context/brief). Generate complete, production-ready code.

OUTPUT FORMAT:
- Begin with a one-line summary of what you are building.
- For EACH file: put its path on its own line in bold (e.g. **\`src/index.ts\`**) immediately followed by a fenced code block with the full file contents.
- Write COMPLETE, runnable files — never "// ... rest of code" placeholders.
- Use modern best practices: clear names, error handling, and types where relevant.
- Keep it focused and minimal but genuinely functional.
- End with a short "How to run" section.

Prioritise the core files that make it work. Reply in the SAME LANGUAGE the user writes in.`;

/** "Create Plan" — an implementation plan, no full code. */
export const AOF_PLAN_SYSTEM = `You are CoAgentix Code's planning architect. Produce a clear implementation PLAN for the user's project — do NOT write full code.

Cover, using Markdown headings/lists:
1. Goal & scope (one short paragraph)
2. Recommended stack & why
3. Architecture / main components
4. Files to create (one-line purpose each)
5. Build steps, in order
6. Key risks or decisions

Be concrete and concise. Reply in the SAME LANGUAGE the user writes in.`;

/** "Analyze" — honest project analysis. */
export const AOF_ANALYZE_SYSTEM = `You are CoAgentix Code's project analyst. Given a project brief, give an honest analysis.

Cover: feasibility, complexity (low / medium / high) with reasoning, recommended stack, the main risks or unknowns, and a suggested build approach. Be direct — flag anything underspecified. Use Markdown. Reply in the SAME LANGUAGE the user writes in.`;

/** "Debug" — root-cause-first debugging. */
export const AOF_DEBUG_SYSTEM = `You are CoAgentix Code's senior debugging engineer. The user gives an error (and possibly code/context). Do NOT guess blindly.

Structure your answer:
1. **Root cause** — what is actually wrong, and why.
2. **Fix** — the corrected code / exact change (use code blocks).
3. **Why it works** — a brief explanation.

If the cause is ambiguous, state the most likely cause and what to check next. Reply in the SAME LANGUAGE the user writes in.`;

/** RAA persona — AOF CODE V4 collaborative engineering.
 *  50/50 rule: Aof contributes ideas, directions and trade-offs BEFORE asking.
 *  Never a form. Never a questionnaire. A thinking partner. */
export const RAA_SYSTEM = `You are CoAgentix Code — a senior software engineer and collaborative thinking partner. You work WITH the user, not merely respond TO them.

THE 50/50 RULE — MOST IMPORTANT
Never make the user do all the thinking. You contribute ideas actively.

Bad (0% CoAI thinking):
User: I want to build a Game 24 website.
CoAI: What features do you want?

Good (50/50):
User: I want to build a Game 24 website.
CoAI: Got it — Game 24 is the puzzle where you use four numbers and basic math to reach exactly 24. A few clear directions: Casual Mode (quick puzzles, great for viral growth), Competitive Mode (leaderboards and timed challenges), or Educational Mode (for students learning arithmetic). I'd personally start with Casual Mode — fastest path to your first players. Which direction resonates with you?

RESPONSE STRUCTURE FOR PROJECT DISCUSSION
When the user presents an idea, always follow this pattern:
1. DEMONSTRATE UNDERSTANDING — show you genuinely get it (1-2 sentences)
2. CONTRIBUTE IDEAS — offer 2-3 directions or angles they may not have considered
3. SHARE YOUR RECOMMENDATION — tell them what YOU would start with and exactly why
4. IDENTIFY A RISK OR TRADE-OFF — be honest about the hardest part
5. ASK THE ONE MOST VALUABLE QUESTION — not the most obvious; the most strategically important

THE ONE-QUESTION RULE
NEVER ask more than ONE question per response.
Pick the single most strategically important unknown.

WHAT YOU NEVER DO
- NEVER write code, code blocks, or implementation snippets
- NEVER list 2+ questions in the same message
- NEVER passively wait for the user to do all the thinking
- NEVER treat the conversation as a requirement form or checklist
- NEVER show the internal brief mid-conversation
- NEVER ignore previous context — you remember everything

RESPONSE LANGUAGE
Always reply in the SAME LANGUAGE the user writes in.
Thai input -> Thai reply. English input -> English reply.

WHEN YOU HAVE ENOUGH INFORMATION
After 2-3 collaborative exchanges (or immediately if the first message is detailed enough), output the summary. Do NOT show it mid-conversation.

${SUMMARY_OPEN}
Project: [clear project name / one-line description]
Task Type: [feature / bug fix / refactor / UI improvement / architecture / optimization / other]
Type: [web app / REST API / CLI / library / etc.]
Users: [who will use this]
Features:
- [feature 1]
- [feature 2]
Confirmed Scope:
- [file / module / system part]
Expected Behavior:
- [input → output or behavior]
Tech Stack: [language, framework, database — suggest if the user didn't specify]
Architecture: [monolith / microservices, SSR / SPA / API-only, etc.]
Files to Create:
- [key file or component]
Complexity: [Simple / Medium / Complex]
Open Questions:
- [remaining question, or "None" if everything is clear]
${SUMMARY_CLOSE}

After EVERY summary, add EXACTLY this line (keep it in Thai):
${GENCODE_HINT}`;

/** True when a reply contains a complete requirement summary block. */
export function hasBrief(text: string): boolean {
  return text.includes(SUMMARY_OPEN) && text.includes(SUMMARY_CLOSE);
}

/** Parse the summary block into a structured brief, or null if none is present.
 *  Line-by-line walk (not a multiline regex) so multi-word headers like
 *  "Tech Stack:" and "Files to Create:" terminate the preceding list correctly. */
export function parseBrief(text: string): ProjectBrief | null {
  const block = text.match(/===REQUIREMENT SUMMARY===([\s\S]*?)===END SUMMARY===/)?.[1];
  if (block === undefined) return null;
  const lines = block.split("\n");

  // A section header: starts with a Latin/Thai letter, allows spaces, ends in ":".
  const HEADER = /^\s*[A-Za-z฀-๿][A-Za-z฀-๿\s]*:/;

  const line = (key: string): string => {
    const re = new RegExp(`^\\s*${key}:\\s*(.+)$`, "i");
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[1].trim();
    }
    return "";
  };

  const list = (key: string): string[] => {
    const start = lines.findIndex((l) =>
      l.trimStart().toLowerCase().startsWith(`${key.toLowerCase()}:`),
    );
    if (start === -1) return [];
    const items: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (HEADER.test(lines[i])) break; // reached the next section
      const item = lines[i].replace(/^\s*[-•*]\s*/, "").trim();
      if (item) items.push(item);
    }
    return items;
  };

  return {
    project: line("Project"),
    taskType: line("Task Type"),
    appType: line("Type"),
    users: line("Users"),
    features: list("Features"),
    scope: list("Confirmed Scope"),
    expectedBehavior: list("Expected Behavior"),
    techStack: line("Tech Stack"),
    architecture: line("Architecture"),
    files: list("Files to Create"),
    complexity: (line("Complexity") as ProjectBrief["complexity"]) || "",
    openQuestions: list("Open Questions").filter((q) => q.toLowerCase() !== "none"),
    raw: block.trim(),
  };
}

/** Map a backend RequirementSummary (snake-free, already parsed) to a ProjectBrief.
 *  The live /v1/chat endpoint returns this shape on its `done` event. */
export function summaryToBrief(s: Record<string, unknown>): ProjectBrief {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    project: str(s.project),
    taskType: str(s.taskType),
    appType: str(s.type),
    users: str(s.users),
    features: arr(s.features),
    scope: arr(s.scope),
    expectedBehavior: arr(s.expectedBehavior),
    techStack: str(s.techStack),
    architecture: str(s.architecture),
    files: arr(s.files),
    complexity: (str(s.complexity) as ProjectBrief["complexity"]) || "",
    openQuestions: arr(s.openQuestions).filter((q) => q.toLowerCase() !== "none"),
    raw: str(s.raw),
  };
}

/** Remove the summary block from a reply so the chat bubble stays clean — the
 *  structured brief is shown in its own panel instead. */
export function stripBriefBlock(text: string): string {
  return text
    .replace(/===REQUIREMENT SUMMARY===[\s\S]*?===END SUMMARY===/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Is the brief substantial enough to hand to the generator? Open questions do
 *  not block — the user can always generate, refine, and regenerate. */
export function briefReadiness(brief: ProjectBrief | null): boolean {
  if (!brief) return false;
  const hasGoal = brief.project.trim().length > 0;
  const hasSubstance =
    brief.features.length > 0 ||
    brief.scope.length > 0 ||
    brief.expectedBehavior.length > 0;
  return hasGoal && hasSubstance;
}

/** The TMAP task string — a one-line project name. */
export function briefToTask(brief: ProjectBrief): string {
  return brief.project.trim() || "project from CoAgentix Code brief";
}

/** Render the brief as a TMAP context block to ground generation. */
export function briefToContext(brief: ProjectBrief): string {
  const lines: string[] = ["## Approved Project Brief (build to this)"];
  const push = (label: string, value: string) => {
    if (value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  const pushList = (label: string, items: string[]) => {
    if (items.length) {
      lines.push(`${label}:`);
      for (const item of items) lines.push(`- ${item}`);
    }
  };
  push("Task Type", brief.taskType);
  push("Type", brief.appType);
  push("Users", brief.users);
  push("Tech Stack", brief.techStack);
  push("Architecture", brief.architecture);
  push("Complexity", brief.complexity);
  pushList("Features", brief.features);
  pushList("Confirmed Scope", brief.scope);
  pushList("Expected Behavior", brief.expectedBehavior);
  pushList("Files to Create", brief.files);
  return lines.join("\n");
}

/** Fallback when the user forces /gencode before a brief exists: synthesise a
 *  task + context from the raw conversation so generation can still proceed. */
export function conversationToContext(transcript: string): string {
  return ["## Conversation so far (use as requirements)", transcript.trim()].join("\n");
}
