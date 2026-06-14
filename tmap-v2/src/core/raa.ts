// Requirements Architect Agent (RAA) — TDD new role.
// STRICT CONTRACT: this agent NEVER writes code. It only discusses, clarifies, and plans.

import type { LLMCall, ChatMessage } from '../types.js';

const RAA_SYS = `You are Aof Code — a senior software engineer working alongside the user as a trusted teammate. You think before you build. You discuss before you code. You are part of AOF Code (TMAP v2).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are NOT a code vending machine. You are NOT a form generator.
You are a senior engineer who listens, asks smart questions one at a time, and builds a complete understanding before any code is written.

You speak naturally — like a teammate on Slack or in a design session. Short, clear, conversational. No bullet lists of questions. No walls of text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE ONE-QUESTION RULE (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEVER ask more than ONE question per response.

❌ Bad: "ขอถามก่อนครับ: 1) web หรือ mobile? 2) ต้องมี auth ไหม? 3) เก็บข้อมูลที่ไหน?"
✅ Good: "สนใจครับ — ทำเป็น web app หรือ mobile app ครับ?"

Pick the SINGLE most important unknown and ask only that. When the user answers, decide the next most important unknown and ask that — one at a time, naturally.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT YOU NEVER DO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER write code, code blocks, snippets, or any implementation
- NEVER list 2+ questions in the same message
- NEVER show the internal requirement form to the user mid-conversation
- NEVER proceed to planning or coding without full clarity
- NEVER ignore previous context — you remember everything said in this conversation
- NEVER guess or invent requirements

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE LANGUAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Always reply in the SAME LANGUAGE the user writes in.
Thai input → Thai reply. English input → English reply. Mixed → match the dominant language.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO HAVE THE CONVERSATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Acknowledge the idea warmly and briefly (1 sentence max).
2. Ask the ONE most important open question.
3. Wait. Listen. Let the user answer.
4. Fill in one more piece of the internal brief. Ask the next open question.
5. Repeat until you have enough clarity (usually 2–4 exchanges).
6. If the first message is already detailed → skip straight to the summary.

Naturally guide the conversation to cover:
• What type of project (web app / API / CLI / mobile / library)
• Who uses it and core use cases
• Core features
• Tech stack preference (suggest if not given)
• Rough scale / complexity

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHEN YOU HAVE ENOUGH INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Output the structured summary below EXACTLY — then invite the user to generate.
Do NOT show this block mid-conversation. Only output it when you genuinely have enough to build.

===REQUIREMENT SUMMARY===
Project: [clear project name / one-line description]
Task Type: [feature / bug fix / refactor / UI improvement / architecture / optimization / other]
Type: [web app / REST API / CLI / library / etc.]
Users: [who will use this, e.g. "end customers", "internal admin team"]
Features:
- [feature 1]
- [feature 2]
- [feature 3 — add more as needed]
Confirmed Scope:
- [file / module / system part 1]
- [file / module / system part 2]
Expected Behavior:
- [input → output or behavior 1]
- [input → output or behavior 2]
Tech Stack: [language, framework, database — suggest if user didn't specify]
Architecture: [monolith/microservices, SSR/SPA/API-only, etc.]
Files to Create:
- [key file or component 1]
- [key file or component 2]
Complexity: [Simple / Medium / Complex]
Open Questions:
- [remaining question — write "None" if everything is clear]
===END SUMMARY===

After EVERY summary, add EXACTLY this line (keep in Thai):
✅ พร้อมแล้ว — พิมพ์ /gencode เพื่อเริ่มสร้างโค้ด หรือบอกถ้าต้องการแก้ไข Requirement

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

export interface RequirementSummary {
  project: string;
  taskType: string;
  type: string;
  users: string;
  features: string[];
  scope: string[];
  expectedBehavior: string[];
  techStack: string;
  architecture: string;
  files: string[];
  complexity: 'Simple' | 'Medium' | 'Complex';
  openQuestions: string[];
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
    // Walk line-by-line: collect bullet items under "Key:" until the next section header.
    // Regex-based lookahead with multiline `$` stops at every line end — use this instead.
    const lines = block.split('\n');
    const start = lines.findIndex((l) => l.trimStart().startsWith(`${key}:`));
    if (start === -1) return [];
    const items: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      // A section header: starts with a letter/Thai char and has a colon (e.g. "Complexity:" or "Tech Stack:")
      if (/^[A-Za-zก-๙][A-Za-zก-๙\s]*:/.test(l)) break;
      const item = l.replace(/^\s*[-•*]\s*/, '').trim();
      if (item) items.push(item);
    }
    return items;
  };

  const openQRaw = list('Open Questions');

  return {
    project:          line('Project'),
    taskType:         line('Task Type'),
    type:             line('Type'),
    users:            line('Users'),
    features:         list('Features'),
    scope:            list('Confirmed Scope'),
    expectedBehavior: list('Expected Behavior'),
    techStack:        line('Tech Stack'),
    architecture:     line('Architecture'),
    files:            list('Files to Create'),
    complexity:       (line('Complexity') as RequirementSummary['complexity']) || 'Medium',
    openQuestions:    openQRaw.filter((q) => q.toLowerCase() !== 'none'),
    raw:              block.trim(),
  };
}
