// Reflection Loop — post-iteration root cause analysis.
// After each TMAP iteration that fails, the Reflection Engine diagnoses WHY
// and produces targeted coaching hints for the next Coder call.
// The LLM call uses the planner role (low temperature = deterministic analysis).

import type { LLMCall, Blackboard } from '../types.js';

export interface ReflectionNote {
  iterationNum: number;
  validationFailures: string[];
  reviewFailures: string[];
  rootCause: string;
  patternTag: string;   // 'missing-import' | 'type-error' | 'logic-error' | etc.
  coachingHint: string; // bullet-point coaching injected into next Coder call
  ts: number;
}

const REFLECTOR_SYS = `You are the Coagentix Reflection Engine.
A code-generation iteration just failed. Diagnose the ROOT CAUSE and write
precise, actionable coaching hints for the NEXT attempt.

Reply in EXACTLY this format:
ROOT_CAUSE: <one sentence>
PATTERN: <one tag: missing-import | type-error | logic-error | missing-file | incomplete | wrong-api | security | scope-creep | other>
COACHING:
- <specific instruction for next iteration>
- <specific instruction for next iteration>`;

export async function reflect(
  call: LLMCall,
  bb: Blackboard,
  iterationNum: number,
): Promise<ReflectionNote> {
  const validationFailures = bb.validations.filter((v) => !v.passed).map((v) => v.logs);
  const reviewFailures = bb.review
    .filter((r) => r.severity === 'HIGH')
    .map((r) => `[${r.severity}] ${r.file ? r.file + ': ' : ''}${r.message}`);

  // No failures to reflect on
  if (validationFailures.length === 0 && reviewFailures.length === 0) {
    return {
      iterationNum,
      validationFailures: [],
      reviewFailures: [],
      rootCause: 'No failures detected',
      patternTag: 'other',
      coachingHint: '',
      ts: Date.now(),
    };
  }

  const failureContext = [
    validationFailures.length
      ? `Validation failures:\n${validationFailures.map((v) => `- ${v}`).join('\n')}`
      : '',
    reviewFailures.length
      ? `Review failures:\n${reviewFailures.map((r) => `- ${r}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');

  try {
    const raw = await call([
      { role: 'system', content: REFLECTOR_SYS },
      {
        role: 'user',
        content: [
          `Task: ${bb.task}`,
          `Iteration: ${iterationNum + 1}`,
          `Files produced: ${bb.files.map((f) => f.path).join(', ')}`,
          '',
          failureContext,
        ].join('\n'),
      },
    ], { temperature: 0.15, maxTokens: 500 });

    const rootCause = raw.match(/ROOT_CAUSE:\s*(.+)/i)?.[1]?.trim() ?? 'Unknown';
    const patternTag = raw.match(/PATTERN:\s*(\S+)/i)?.[1]?.trim() ?? 'other';
    const coachingSection = raw.split(/COACHING:/i)[1] ?? '';
    const coachingHint = coachingSection
      .split('\n')
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
      .map((l) => `- ${l}`)
      .join('\n');

    return { iterationNum, validationFailures, reviewFailures, rootCause, patternTag, coachingHint, ts: Date.now() };
  } catch {
    // Fallback: derive coaching directly from failure messages
    const coachingHint = [...validationFailures, ...reviewFailures]
      .map((f) => `- Fix: ${f}`)
      .join('\n');
    return {
      iterationNum,
      validationFailures,
      reviewFailures,
      rootCause: 'Unable to analyse (reflection LLM call failed)',
      patternTag: 'other',
      coachingHint,
      ts: Date.now(),
    };
  }
}

/** Merge the coaching hints from recent reflection notes into a single block. */
export function buildCoachingFromReflections(notes: ReflectionNote[]): string {
  if (notes.length === 0) return '';
  const recent = notes.slice(-2);
  const hints = recent.flatMap((n) => n.coachingHint.split('\n').filter(Boolean));
  const unique = [...new Set(hints)];
  return `## Reflection Coaching (from ${recent.length} prior iteration(s)):\n${unique.join('\n')}`;
}
