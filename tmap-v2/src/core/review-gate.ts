// Quality Review Gate — scores outputs 0-100 and retries if score < 90.
// This is the Co.AI self-correction layer that ensures quality before delivery.

import type { LLMCall, QualityScore, TaskCategory } from '../types.js';
import { categoryLabel } from './classifier.js';

const REVIEWER_SYS = `You are the Quality Review Agent in Co.AI.
Your job is to objectively score a generated response against the user's original request.

Evaluate across these dimensions:
1. ACCURACY (0-25): Is the information correct? No hallucinations?
2. COMPLETENESS (0-25): Does it fully address every part of the request?
3. QUALITY (0-25): Is it well-written, well-structured, and professional?
4. RELEVANCE (0-25): Is it focused and on-topic? No unnecessary padding?

Scoring:
- 90-100: Excellent — ready to deliver
- 75-89: Good — minor improvements possible but acceptable
- 60-74: Adequate — noticeable gaps or issues
- Below 60: Poor — needs significant revision

Output ONLY a JSON object:
{
  "score": <number 0-100>,
  "issues": ["specific issue 1", "specific issue 2"],
  "improvements": ["what to fix", "what to add"]
}`;

export async function scoreResponse(
  call: LLMCall,
  task: string,
  response: string,
  categories: TaskCategory[] = [],
): Promise<QualityScore> {
  const catContext = categories.length
    ? `Task type: ${categories.slice(0, 2).map(categoryLabel).join(', ')}\n`
    : '';

  try {
    const raw = await call([
      { role: 'system', content: REVIEWER_SYS },
      {
        role: 'user',
        content: `${catContext}Original request:\n${task}\n\nGenerated response:\n${response}\n\nScore this response.`,
      },
    ], { temperature: 0.1, maxTokens: 500 });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { score?: number; issues?: string[] };
      const score = Math.max(0, Math.min(100, Number(parsed.score ?? 75)));
      const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      return { score, issues, passed: score >= 90 };
    }
  } catch { /* fall through to default */ }

  return { score: 75, issues: [], passed: false };
}

const MAX_REVIEW_ATTEMPTS = 3;

export interface ReviewLoopResult {
  response: string;
  qualityScore: number;
  iterations: number;
  passed: boolean;
}

/**
 * Run a generation function with quality review loop.
 * If score < 90, pass issues back to generator and retry (up to MAX_REVIEW_ATTEMPTS).
 */
export async function reviewLoop(
  call: LLMCall,
  generate: (critique?: string) => Promise<string>,
  task: string,
  categories: TaskCategory[] = [],
  onIteration?: (iter: number, score: number) => void,
): Promise<ReviewLoopResult> {
  let response = '';
  let lastScore = 0;
  let critique: string | undefined;

  for (let iter = 0; iter < MAX_REVIEW_ATTEMPTS; iter++) {
    response = await generate(critique);
    const quality = await scoreResponse(call, task, response, categories);
    lastScore = quality.score;
    onIteration?.(iter + 1, lastScore);

    if (quality.passed) {
      return { response, qualityScore: lastScore, iterations: iter + 1, passed: true };
    }

    if (iter < MAX_REVIEW_ATTEMPTS - 1 && quality.issues.length > 0) {
      critique = `Quality score: ${lastScore}/100. Issues to fix:\n${quality.issues.map((i) => `- ${i}`).join('\n')}\n\nPlease revise the response to address these issues.`;
    }
  }

  return { response, qualityScore: lastScore, iterations: MAX_REVIEW_ATTEMPTS, passed: lastScore >= 75 };
}
