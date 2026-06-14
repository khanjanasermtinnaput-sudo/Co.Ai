// Architect Agent — the design-reasoning stage that runs BEFORE the Planner.
//
// Closes the "no architecture stage" gap: instead of jumping from a requirement
// straight to file generation, the Architect decides the approach, which files
// are NEW vs MODIFY (so the Coder extends instead of duplicating), the target
// tech stack, and the up-front architectural risks. Its decision is injected
// into the Planner and recorded into project memory.

import type { LLMCall, Blackboard, ArchitectDecision } from '../types.js';

const ARCHITECT_SYS = `You are the Architect agent in AOF Code (TMAP v2).
You design BEFORE any code is written. You do NOT write code.

Given the task and the existing project context, decide the implementation strategy.
Be decisive and concrete. Prefer extending existing files over creating new ones.

Output EXACTLY these labelled sections, nothing else:

APPROACH: <one or two sentences describing the design/pattern>
TECH_STACK: <languages/frameworks to use, consistent with existing project>
NEW_FILES:
- <path> — <why this new file is needed>
MODIFY_FILES:
- <path> — <what changes and why>
RISKS:
- <architectural risk or pitfall to avoid>

Rules:
- If the project already exists, reuse its stack and conventions.
- If a file already exists for a concern, put it under MODIFY_FILES, not NEW_FILES.
- If a section has no items, write "- none".
- No code, no prose outside these sections.
- Write the descriptive text (after APPROACH/RISKS and after each "— " in the file
  lists) in the SAME LANGUAGE the user wrote the task in (Thai task → Thai text).
  Keep the section labels, file paths and "- none" markers exactly as specified.`;

export async function runArchitect(
  call: LLMCall, bb: Blackboard,
): Promise<ArchitectDecision> {
  const userParts = [
    `Task: ${bb.task}`,
    `Mode: ${bb.mode}`,
    `Project context:\n${bb.context || '(fresh project — no existing files)'}`,
  ];
  if (bb.contextMeta?.relevantFiles?.length) {
    userParts.push(`Most relevant existing files: ${bb.contextMeta.relevantFiles.join(', ')}`);
  }
  if (bb.contextMeta?.conventions?.length) {
    userParts.push(`Conventions to follow: ${bb.contextMeta.conventions.join(' · ')}`);
  }

  const raw = await call([
    { role: 'system', content: ARCHITECT_SYS },
    { role: 'user', content: userParts.join('\n\n') },
  ], { temperature: 0.3, maxTokens: 700 });

  return parseArchitect(raw);
}

export function parseArchitect(raw: string): ArchitectDecision {
  const approach = section1(raw, 'APPROACH');
  const techStack = section1(raw, 'TECH_STACK');
  const newFiles = sectionList(raw, 'NEW_FILES').map(firstPath).filter(Boolean);
  const modifyFiles = sectionList(raw, 'MODIFY_FILES').map(firstPath).filter(Boolean);
  const risks = sectionList(raw, 'RISKS');
  return { approach, techStack, newFiles, modifyFiles, risks, raw: raw.trim() };
}

/** Render the decision as a context block to prepend to the Planner's input. */
export function architectToContext(d: ArchitectDecision): string {
  const lines: string[] = ['## Architecture Decision (follow this)'];
  if (d.approach) lines.push(`Approach: ${d.approach}`);
  if (d.techStack) lines.push(`Tech stack: ${d.techStack}`);
  if (d.newFiles.length) lines.push(`Create these files: ${d.newFiles.join(', ')}`);
  if (d.modifyFiles.length) lines.push(`Modify these existing files: ${d.modifyFiles.join(', ')}`);
  if (d.risks.length) {
    lines.push('Avoid these risks:');
    for (const r of d.risks) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

// ── parsing helpers ────────────────────────────────────────────────────────────
const LABELS = ['APPROACH', 'TECH_STACK', 'NEW_FILES', 'MODIFY_FILES', 'RISKS'];

function section1(raw: string, label: string): string {
  const m = raw.match(new RegExp(`^${label}:\\s*(.+)`, 'mi'));
  return m ? m[1].trim() : '';
}

function sectionList(raw: string, label: string): string[] {
  // capture everything under "LABEL:" until the next known label or end
  const others = LABELS.filter((l) => l !== label).join('|');
  const re = new RegExp(`^${label}:\\s*([\\s\\S]*?)(?=^(?:${others}):|$)`, 'mi');
  const block = raw.match(re)?.[1] ?? '';
  return block
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter((l) => l && l.toLowerCase() !== 'none');
}

function firstPath(line: string): string {
  // "src/auth.ts — reason" -> "src/auth.ts"
  return line.split(/\s|—|--|:/)[0].trim();
}
