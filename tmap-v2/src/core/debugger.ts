// Debugger agent — senior-engineer debugging (TDD Phase 5).
// Contract: when given an error, DO NOT blindly regenerate. Diagnose first:
// analyze → explain the root cause → propose a solution → provide a targeted patch.

import type { LLMCall, CodeFile } from '../types.js';
import { parseCodeBlocks } from './agents.js';

const DEBUGGER_SYS = `You are the Debugger agent in AOF Code (TMAP v2).
You are a senior engineer. When given an error you DO NOT blindly rewrite everything —
you diagnose the real cause first, then make a targeted fix.

Output EXACTLY these labelled sections, in this order, nothing else:

ROOT CAUSE: <one or two sentences naming the underlying cause, not just the symptom>
ANALYSIS:
- <what is happening and why, step by step>
SOLUTION:
- <the concrete fix, described clearly — what to change and why>
PATCH:
\`\`\`path=<file path>
<full corrected file content>
\`\`\`

Rules:
- Always diagnose ROOT CAUSE before proposing a fix.
- Only include PATCH code blocks for files you are actually changing. Output full
  file contents, not diffs.
- If no source code was provided, write "PATCH:" then "- none" and put the fix in SOLUTION.
- Write the ANALYSIS and SOLUTION text in the SAME LANGUAGE the user wrote in
  (Thai problem → Thai text). Keep the section labels and file paths exactly as specified.`;

export interface DebugInput {
  error: string;
  code?: string;
  context?: string;
}

export interface DebugResult {
  rootCause: string;
  analysis: string[];
  solution: string[];
  patch: CodeFile[];
  raw: string;
}

export async function runDebugger(call: LLMCall, input: DebugInput): Promise<DebugResult> {
  const parts = [`Error / problem:\n${input.error}`];
  if (input.code?.trim()) parts.push(`Current code:\n${input.code}`);
  if (input.context?.trim()) parts.push(`Project context:\n${input.context}`);

  const raw = await call([
    { role: 'system', content: DEBUGGER_SYS },
    { role: 'user', content: parts.join('\n\n') },
  ], { temperature: 0.2, maxTokens: 2048 });

  return parseDebug(raw);
}

const LABELS = ['ROOT CAUSE', 'ANALYSIS', 'SOLUTION', 'PATCH'];

export function parseDebug(raw: string): DebugResult {
  const rootCause = oneLine(raw, 'ROOT CAUSE');
  const analysis = listBlock(raw, 'ANALYSIS');
  const solution = listBlock(raw, 'SOLUTION');

  // Everything after "PATCH:" holds the corrected files.
  const patchIdx = raw.search(/^PATCH:/m);
  let patch: CodeFile[] = [];
  if (patchIdx !== -1) {
    const patchText = raw.slice(patchIdx);
    patch = parseCodeBlocks(patchText).filter(
      (f) => f.path !== 'output.txt' && f.content.trim() && f.content.trim() !== '- none',
    );
  }

  return { rootCause, analysis, solution, patch, raw: raw.trim() };
}

// ── parsing helpers ────────────────────────────────────────────────────────────
function oneLine(raw: string, label: string): string {
  const m = raw.match(new RegExp(`^${label}:\\s*(.+)`, 'mi'));
  return m ? m[1].trim() : '';
}

function listBlock(raw: string, label: string): string[] {
  // Walk line-by-line until the next known label. A multiline regex with `$` would
  // stop at the first line break and capture only one item.
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${label}:`, 'i').test(l.trim()));
  if (start === -1) return [];
  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (LABELS.some((l) => new RegExp(`^${l}:`, 'i').test(lines[i].trim()))) break;
    const item = lines[i].replace(/^\s*[-•*]\s*/, '').trim();
    if (item && item.toLowerCase() !== 'none') items.push(item);
  }
  return items;
}
