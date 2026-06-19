// Voting / Consensus Engine (TDD §5 — parallel agents, weighted vote).
// Used in pro mode: runs the Coder N times in parallel at different
// temperatures (genuine diversity), then a Reviewer call scores them on a
// weighted rubric and picks the best one.

import type { LLMCall, CodeFile, Blackboard } from '../types.js';
import { runCoder } from './agents.js';

export interface VoteResult {
  files: CodeFile[];
  winnerIndex: number;    // 0-based index of the chosen candidate
  candidateCount: number; // how many viable candidates were judged
  reason: string;
}

// ≥3 candidates per the Consensus Engine spec. Varying the temperature is what
// actually makes the candidates differ — same temperature twice was nearly a
// no-op in the previous implementation.
const VOTE_TEMPS = [0.2, 0.5, 0.8];

const JUDGE_SYS = `You are a code quality judge in Coagentix (TMAP v2).
Score each candidate implementation on:
- accuracy / correctness (40%)
- completeness vs the task (30%)
- logic consistency (20%)
- efficiency & clarity (10%)
Pick the single best candidate overall.
Respond with EXACTLY two lines:
PICK: <letter>
REASON: <one short sentence>`;

/**
 * Generate diverse Coder candidates in parallel, then have the Reviewer pick the
 * best per the weighted rubric. Falls back to the first viable candidate if the
 * judge call fails.
 */
export async function runCoderVote(
  coderCall: LLMCall,
  reviewerCall: LLMCall,
  bb: Blackboard,
  critique?: string,
  temps: number[] = VOTE_TEMPS,
): Promise<VoteResult> {
  const settled = await Promise.allSettled(
    temps.map((t) => runCoder(coderCall, bb, critique, t)),
  );
  const candidates = settled
    .filter((s): s is PromiseFulfilledResult<CodeFile[]> => s.status === 'fulfilled' && s.value.length > 0)
    .map((s) => s.value);

  if (candidates.length === 0) {
    return { files: [], winnerIndex: 0, candidateCount: 0, reason: 'all coder candidates failed' };
  }
  if (candidates.length === 1) {
    return { files: candidates[0], winnerIndex: 0, candidateCount: 1, reason: 'only one viable candidate' };
  }

  try {
    const decision = await reviewerCall([
      { role: 'system', content: JUDGE_SYS },
      { role: 'user', content: buildVotePrompt(bb.task, candidates) },
    ], { temperature: 0.1, maxTokens: 160 });

    const winnerIndex = parsePick(decision, candidates.length);
    const reason = parseReason(decision) ?? `Candidate ${letter(winnerIndex)} selected`;
    return { files: candidates[winnerIndex], winnerIndex, candidateCount: candidates.length, reason };
  } catch {
    return { files: candidates[0], winnerIndex: 0, candidateCount: candidates.length, reason: 'Judge unavailable; defaulted to candidate A' };
  }
}

export function letter(i: number): string {
  return String.fromCharCode(65 + i);
}

export function parsePick(decision: string, count: number): number {
  const m = decision.match(/PICK:\s*([A-Za-z])/);
  if (!m) return 0;
  const idx = m[1].toUpperCase().charCodeAt(0) - 65;
  return idx >= 0 && idx < count ? idx : 0;
}

function parseReason(decision: string): string | undefined {
  return decision.match(/REASON:\s*(.+)/i)?.[1]?.trim();
}

function buildVotePrompt(task: string, candidates: CodeFile[][]): string {
  const fmt = (files: CodeFile[], label: string) =>
    `=== CANDIDATE ${label} (${files.length} file(s)) ===\n` +
    files.map((f) => `--- ${f.path} ---\n${f.content.slice(0, 800)}`).join('\n');
  return `Task: ${task}\n\n` + candidates.map((c, i) => fmt(c, letter(i))).join('\n\n');
}
