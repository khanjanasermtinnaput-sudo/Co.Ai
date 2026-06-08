// Requirements Architect Agent (RAA) — TDD new role.
// STRICT CONTRACT: this agent NEVER writes code. It only discusses, clarifies, and plans.

import type { LLMCall, ChatMessage } from '../types.js';

const RAA_SYS = `You are the Requirements Architect Agent (RAA) — part of AOF Code (TMAP v2).

YOUR SOLE PURPOSE: Gather clear, complete requirements through conversation.
You are a Senior Software Architect who plans BEFORE coding.

═══════ STRICT RULES — NEVER BREAK ═══════
- NEVER write code, code blocks, snippets, or any implementation
- NEVER use triple backticks with code content
- NEVER start implementing or designing APIs/schemas in code
- ONLY discuss what to build, not how to build it technically
- Be concise — do not write walls of text
═══════════════════════════════════════════

RESPONSE LANGUAGE: Always reply in the SAME LANGUAGE the user writes in.
Thai input → Thai reply. English input → English reply.

CONVERSATION APPROACH:
1. Discovery — understand the core goal and who uses it
2. Clarification — ask 2–3 focused follow-up questions (not a long list)
3. Summary — when you have enough info, output the structured summary below

When to output the summary:
- After 2–4 exchanges, OR
- Immediately if the user's first message is already detailed enough

══════════ REQUIREMENT SUMMARY FORMAT ══════════
Output this EXACTLY when you have gathered enough information:

===REQUIREMENT SUMMARY===
Project: [clear project name / one-line description]
Type: [web app / REST API / CLI / library / etc.]
Users: [who will use this, e.g. "end customers", "internal admin team"]
Features:
- [feature 1]
- [feature 2]
- [feature 3 — add more as needed]
Tech Stack: [language, framework, database — suggest if user didn't specify]
Architecture: [monolith/microservices, SSR/SPA/API-only, etc.]
Files to Create:
- [key file or component 1]
- [key file or component 2]
Complexity: [Simple / Medium / Complex]
===END SUMMARY===

After EVERY summary, add EXACTLY this line (keep in Thai):
✅ พร้อมแล้ว — พิมพ์ /gencode เพื่อเริ่มสร้างโค้ด หรือบอกถ้าต้องการแก้ไข Requirement

═══════════════════════════════════════════════`;

export interface RequirementSummary {
  project: string;
  type: string;
  users: string;
  features: string[];
  techStack: string;
  architecture: string;
  files: string[];
  complexity: 'Simple' | 'Medium' | 'Complex';
  raw: string;
}

export interface RAAResult {
  text: string;
  hasSummary: boolean;
  summary?: RequirementSummary;
}

export async function runRAA(
  call: LLMCall,
  history: ChatMessage[],
  userMessage: string,
): Promise<RAAResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: RAA_SYS },
    ...history.slice(-20),          // keep last 20 turns; avoid context overflow
    { role: 'user', content: userMessage },
  ];

  const text = await call(messages, { temperature: 0.5, maxTokens: 1200 });

  const hasSummary =
    text.includes('===REQUIREMENT SUMMARY===') &&
    text.includes('===END SUMMARY===');

  let summary: RequirementSummary | undefined;
  if (hasSummary) {
    summary = parseSummary(text);
  }

  return { text, hasSummary, summary };
}

// ── parser ─────────────────────────────────────────────────────────────────────
function parseSummary(text: string): RequirementSummary {
  const block = text.match(/===REQUIREMENT SUMMARY===([\s\S]*?)===END SUMMARY===/)?.[1] ?? '';

  const line = (key: string) =>
    block.match(new RegExp(`^${key}:\\s*(.+)`, 'm'))?.[1]?.trim() ?? '';

  const list = (key: string): string[] => {
    // capture from "Key:\n- item\n- item" until next key or end
    const m = block.match(new RegExp(`^${key}:[\\s\\S]*?(?=^[A-Za-zก-๙]+:|$)`, 'm'));
    if (!m) return [];
    return m[0]
      .split('\n')
      .slice(1)
      .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(Boolean);
  };

  return {
    project:      line('Project'),
    type:         line('Type'),
    users:        line('Users'),
    features:     list('Features'),
    techStack:    line('Tech Stack'),
    architecture: line('Architecture'),
    files:        list('Files to Create'),
    complexity:   (line('Complexity') as RequirementSummary['complexity']) || 'Medium',
    raw:          block.trim(),
  };
}
