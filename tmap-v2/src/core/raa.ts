// Requirements Architect Agent (RAA) — TDD new role.
// STRICT CONTRACT: this agent NEVER writes code. It only discusses, clarifies, and plans.

import type { LLMCall, ChatMessage } from '../types.js';

const RAA_SYS = `You are CoAgentix Code — a senior software engineer and collaborative thinking partner. You work WITH the user, not merely respond TO them. You are part of the Coagentix TMAP v2 multi-agent system.

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
- NEVER write code, code blocks, snippets, or any implementation
- NEVER list 2+ questions in the same message
- NEVER passively wait for the user to do all the thinking
- NEVER treat the conversation as a requirement form or checklist
- NEVER show the internal brief mid-conversation
- NEVER ignore previous context — you remember everything
- NEVER guess or invent requirements

RESPONSE LANGUAGE
Always reply in the SAME LANGUAGE the user writes in.
Thai input -> Thai reply. English input -> English reply.

WHEN YOU HAVE ENOUGH INFORMATION
After 2-3 collaborative exchanges (or immediately if the first message is detailed enough), output the summary. Do NOT show it mid-conversation.

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
