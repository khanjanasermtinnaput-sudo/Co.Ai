// Self-Critique System — agents evaluate their own output before handing off.
// A quick LLM-based sanity check that catches obvious gaps without a full review
// cycle, reducing downstream correction iterations.

import type { LLMCall, CodeFile } from '../types.js';

export type CritiqueSeverity = 'none' | 'minor' | 'major' | 'blocking';

export interface CritiqueResult {
  pass: boolean;              // true when severity is none or minor
  severity: CritiqueSeverity;
  issues: string[];
}

// ── Plan self-critique ────────────────────────────────────────────────────────

const PLAN_CRITIQUE_SYS = `You are the Plan Self-Critic in Coagentix Code.
Review the plan against the task. Check only:
1. Covers every part of the task?
2. Missing critical files?
3. Steps in wrong order?
4. Scope too large or too small?

Reply in EXACTLY this format (no other text):
VERDICT: pass | minor | major | blocking
ISSUES:
- <issue or "none">`;

export async function selfCritiquePlan(
  call: LLMCall,
  task: string,
  planText: string,
): Promise<CritiqueResult> {
  try {
    const raw = await call([
      { role: 'system', content: PLAN_CRITIQUE_SYS },
      { role: 'user', content: `Task: ${task}\n\nPlan:\n${planText.slice(0, 2000)}` },
    ], { temperature: 0.2, maxTokens: 400 });
    return parseCritique(raw);
  } catch {
    return { pass: true, severity: 'none', issues: [] };
  }
}

// ── Code self-critique ────────────────────────────────────────────────────────

const CODE_CRITIQUE_SYS = `You are the Code Self-Critic in Coagentix Code.
Review the generated code against the task and plan. Check only:
1. Code implements what the plan describes?
2. Obvious logic errors or missing null checks?
3. Any hardcoded secrets or obvious XSS/injection risks?
4. Cross-file interface consistency (if multiple files)?

Reply in EXACTLY this format (no other text):
VERDICT: pass | minor | major | blocking
ISSUES:
- <issue or "none">`;

export async function selfCritiqueCode(
  call: LLMCall,
  task: string,
  files: CodeFile[],
  planText: string,
): Promise<CritiqueResult> {
  if (files.length === 0) {
    return { pass: false, severity: 'blocking', issues: ['No files were generated'] };
  }

  const preview = files
    .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 500)}`)
    .join('\n\n')
    .slice(0, 3000);

  try {
    const raw = await call([
      { role: 'system', content: CODE_CRITIQUE_SYS },
      {
        role: 'user',
        content: `Task: ${task}\n\nPlan summary:\n${planText.slice(0, 500)}\n\nGenerated files (preview):\n${preview}`,
      },
    ], { temperature: 0.2, maxTokens: 500 });
    return parseCritique(raw);
  } catch {
    return { pass: true, severity: 'none', issues: [] };
  }
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parseCritique(raw: string): CritiqueResult {
  const verdictMatch = raw.match(/VERDICT:\s*(pass|minor|major|blocking)/i);
  const verdictRaw = verdictMatch?.[1]?.toLowerCase() ?? 'minor';
  const severity: CritiqueSeverity = verdictRaw === 'pass' ? 'none' : (verdictRaw as CritiqueSeverity);

  const issueSection = raw.split(/ISSUES:/i)[1] ?? '';
  const issues = issueSection
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter((l) => l && !/^none$/i.test(l));

  return { pass: severity === 'none' || severity === 'minor', severity, issues };
}
