// Project Analyst agent — assess a brief BEFORE building (Coagentix Code "Analyze Project").
// Gives a senior-engineer read on feasibility, risks and recommendations. No code.

import type { LLMCall } from '../types.js';

const ANALYZER_SYS = `You are the Project Analyst in Coagentix Code (TMAP v2).
Given a project brief or description, give a senior engineer's assessment. You do NOT write code.

Output EXACTLY these labelled sections, in this order, nothing else:

FEASIBILITY: <one or two sentences — is this realistic, and at what effort level?>
RISKS:
- <a concrete risk or pitfall to watch>
RECOMMENDATIONS:
- <an actionable recommendation: scope, stack, sequencing, etc.>

Rules:
- Be concrete and specific to THIS project, not generic advice.
- No code. Keep it tight.
- Write the descriptive text in the SAME LANGUAGE the user wrote in
  (Thai brief → Thai text). Keep the section labels exactly as specified.`;

export interface AnalysisResult {
  feasibility: string;
  risks: string[];
  recommendations: string[];
  raw: string;
}

export async function runAnalyzer(call: LLMCall, brief: string): Promise<AnalysisResult> {
  const raw = await call([
    { role: 'system', content: ANALYZER_SYS },
    { role: 'user', content: `Project brief:\n${brief}` },
  ], { temperature: 0.3, maxTokens: 900 });

  return parseAnalysis(raw);
}

const LABELS = ['FEASIBILITY', 'RISKS', 'RECOMMENDATIONS'];

export function parseAnalysis(raw: string): AnalysisResult {
  return {
    feasibility: oneLine(raw, 'FEASIBILITY'),
    risks: listBlock(raw, 'RISKS'),
    recommendations: listBlock(raw, 'RECOMMENDATIONS'),
    raw: raw.trim(),
  };
}

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
