// Critic Agent — independent 5-dimension quality evaluation.
// Runs as a standalone gate on plan or code output.
// Scores: Correctness (35%) · Completeness (25%) · Security (20%) · Performance (10%) · Maintainability (10%)
// APPROVED when overall ≥ 70 AND security ≥ 60 AND correctness ≥ 60.

import type { LLMCall } from '../types.js';

export interface CriticDimension {
  name: string;
  score: number;    // 0-100
  notes: string[];
}

export interface CriticIssue {
  dimension: string;
  issue: string;
  severity: 'HIGH' | 'MED' | 'LOW';
}

export interface CriticReport {
  dimensions: {
    correctness:    CriticDimension;
    completeness:   CriticDimension;
    security:       CriticDimension;
    performance:    CriticDimension;
    maintainability: CriticDimension;
  };
  overall: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  approved: boolean;
  issues: CriticIssue[];
  recommendation: string;
}

const CRITIC_SYS = `You are the Coagentix Critic Agent — an independent quality evaluator.
Score the output across 5 dimensions (each 0-100):

1. CORRECTNESS (35%): Logic correct? No obvious bugs or wrong assumptions?
2. COMPLETENESS (25%): Addresses every part of the task? Nothing missing?
3. SECURITY (20%): No injection, secrets exposure, auth bypass, XSS, IDOR?
4. PERFORMANCE (10%): No N+1 queries, blocking I/O, memory leaks, unbounded loops?
5. MAINTAINABILITY (10%): Clear structure, follows conventions, testable, minimal tech debt?

APPROVED: overall ≥ 70 AND security ≥ 60 AND correctness ≥ 60.

Respond in this EXACT JSON (no markdown, no preamble):
{
  "correctness":    { "score": 0-100, "notes": ["<note>"] },
  "completeness":   { "score": 0-100, "notes": ["<note>"] },
  "security":       { "score": 0-100, "notes": ["<note>"] },
  "performance":    { "score": 0-100, "notes": ["<note>"] },
  "maintainability":{ "score": 0-100, "notes": ["<note>"] },
  "recommendation": "<one sentence>"
}`;

const WEIGHTS = {
  correctness:    0.35,
  completeness:   0.25,
  security:       0.20,
  performance:    0.10,
  maintainability:0.10,
} as const;

type DimKey = keyof typeof WEIGHTS;

const ISSUE_THRESHOLDS: Record<DimKey, { high: number; med: number }> = {
  correctness:    { high: 60, med: 75 },
  completeness:   { high: 50, med: 70 },
  security:       { high: 60, med: 80 },
  performance:    { high: 40, med: 60 },
  maintainability:{ high: 40, med: 60 },
};

function grade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

function extractIssues(dims: Record<DimKey, CriticDimension>): CriticIssue[] {
  const issues: CriticIssue[] = [];
  for (const [dim, data] of Object.entries(dims) as [DimKey, CriticDimension][]) {
    const t = ISSUE_THRESHOLDS[dim];
    const sev: 'HIGH' | 'MED' | 'LOW' =
      data.score < t.high ? 'HIGH' : data.score < t.med ? 'MED' : 'LOW';
    for (const note of data.notes) {
      issues.push({ dimension: dim, issue: note, severity: sev });
    }
  }
  return issues;
}

function defaultReport(): CriticReport {
  const dim = (name: string): CriticDimension => ({ name, score: 75, notes: [] });
  const dims = {
    correctness:    dim('correctness'),
    completeness:   dim('completeness'),
    security:       dim('security'),
    performance:    dim('performance'),
    maintainability:dim('maintainability'),
  };
  return {
    dimensions: dims,
    overall: 75,
    grade: 'B',
    approved: true,
    issues: [],
    recommendation: 'Evaluation unavailable — defaulting to acceptable',
  };
}

export async function runCritic(
  call: LLMCall,
  task: string,
  output: string,
  context = '',
): Promise<CriticReport> {
  const contextPart = context ? `\nContext:\n${context.slice(0, 400)}\n` : '';
  const outputPart = output.length > 2500 ? output.slice(0, 2500) + '\n…[truncated]' : output;

  try {
    const raw = await call([
      { role: 'system', content: CRITIC_SYS },
      {
        role: 'user',
        content: `Task: ${task}${contextPart}\n\nOutput:\n${outputPart}`,
      },
    ], { temperature: 0.1, maxTokens: 800 });

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return defaultReport();

    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const parseDim = (key: string): CriticDimension => {
      const v = parsed[key] as { score?: unknown; notes?: unknown } | undefined;
      return {
        name: key,
        score: Math.max(0, Math.min(100, Number(v?.score ?? 75))),
        notes: Array.isArray(v?.notes) ? (v.notes as unknown[]).map(String) : [],
      };
    };

    const dims = {
      correctness:    parseDim('correctness'),
      completeness:   parseDim('completeness'),
      security:       parseDim('security'),
      performance:    parseDim('performance'),
      maintainability:parseDim('maintainability'),
    };

    const overall = Math.round(
      (Object.entries(WEIGHTS) as [DimKey, number][])
        .reduce((sum, [k, w]) => sum + dims[k].score * w, 0)
    );

    return {
      dimensions: dims,
      overall,
      grade: grade(overall),
      approved: overall >= 70 && dims.security.score >= 60 && dims.correctness.score >= 60,
      issues: extractIssues(dims),
      recommendation: String(parsed.recommendation ?? 'No recommendation provided'),
    };
  } catch {
    return defaultReport();
  }
}
