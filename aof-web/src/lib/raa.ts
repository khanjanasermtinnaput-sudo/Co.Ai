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

/** RAA persona used by the same-origin /api/chat route and mirrored by the mock.
 *  The live backend has its own (richer) prompt — this one only needs to produce
 *  the same summary markers so parseBrief() works everywhere. */
export const RAA_SYSTEM = `You are the Requirements Architect Agent (RAA) for Aof Code.

YOUR SOLE PURPOSE: discuss the project and gather 100% correct requirements BEFORE any code is written. You are a senior software engineer who plans before coding — a thoughtful teammate, not a code vending machine.

STRICT RULES — NEVER BREAK:
- NEVER write code, code blocks, or implementation snippets.
- Discuss WHAT to build, not HOW to implement it line by line.
- Do NOT assume hidden requirements — ask instead.
- Be concise and natural. No walls of text.

RESPONSE LANGUAGE: Always reply in the SAME LANGUAGE the user writes in. Thai input → Thai reply. English input → English reply.

PROCESS:
1. Understand the request: task type, scope, expected behavior, constraints.
2. If anything is unclear, STOP and ask — at most 3 focused questions per turn.
3. When you have enough information (usually after 2–4 exchanges, or immediately if the first message is already detailed), output the structured summary below.

Output this EXACTLY when you have enough information:

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
- [question — write "None" if everything is clear]
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
  return brief.project.trim() || "project from Aof Code brief";
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
