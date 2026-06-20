// Voting / Consensus Engine (TDD §5 — parallel agents, weighted vote).
// Phase 4 upgrade: 5-dimension per-candidate scoring with explicit rubric,
// consensus threshold, and per-candidate score exposure.
// Used in pro mode: runs the Coder N times in parallel at different
// temperatures (genuine diversity), then a Reviewer call scores them.

import type { LLMCall, CodeFile, Blackboard } from '../types.js';
import { runCoder } from './agents.js';

export interface CandidateScore {
  letter: string;
  correctness: number;   // 0-10
  completeness: number;  // 0-10
  security: number;      // 0-10
  efficiency: number;    // 0-10
  clarity: number;       // 0-10
  weighted: number;      // final weighted score
}

export interface VoteResult {
  files: CodeFile[];
  winnerIndex: number;       // 0-based index of the chosen candidate
  candidateCount: number;    // how many viable candidates were judged
  reason: string;
  candidateScores?: CandidateScore[];  // per-candidate breakdown (Phase 4)
  consensusScore?: number;             // avg weighted score of all candidates
}

// ≥3 candidates per the Consensus Engine spec. Varying the temperature is what
// actually makes the candidates differ — same temperature twice was nearly a
// no-op in the previous implementation.
const VOTE_TEMPS = [0.2, 0.5, 0.8];

// Phase 4: 5-dimension rubric with explicit weights
const JUDGE_SYS = `You are a code quality judge in Coagentix Code (TMAP v2).
Score EACH candidate on 5 dimensions (each 0-10):
- correctness  (40%): logic correct, no bugs, correct algorithms
- completeness (30%): all task requirements addressed
- security     (15%): no obvious vulnerabilities or hardcoded secrets
- efficiency   (10%): no obvious performance problems
- clarity       (5%): readable, well-named, clean structure

For each candidate output a score block, then pick the overall winner.
Format:
CANDIDATE <letter>: correctness=<n> completeness=<n> security=<n> efficiency=<n> clarity=<n>
(repeat for each candidate)
PICK: <letter>
REASON: <one short sentence explaining why this candidate wins>`;

/**
 * Generate diverse Coder candidates in parallel, then have the Reviewer score each
 * on a 5-dimension rubric and pick the best. Falls back to candidate A on judge failure.
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
    ], { temperature: 0.1, maxTokens: 400 });

    const winnerIndex = parsePick(decision, candidates.length);
    const reason = parseReason(decision) ?? `Candidate ${letter(winnerIndex)} selected`;
    const candidateScores = parseCandidateScores(decision, candidates.length);
    const consensusScore = candidateScores.length
      ? Math.round(candidateScores.reduce((s, c) => s + c.weighted, 0) / candidateScores.length * 10) / 10
      : undefined;

    return {
      files: candidates[winnerIndex],
      winnerIndex,
      candidateCount: candidates.length,
      reason,
      candidateScores,
      consensusScore,
    };
  } catch {
    return {
      files: candidates[0],
      winnerIndex: 0,
      candidateCount: candidates.length,
      reason: 'Judge unavailable; defaulted to candidate A',
    };
  }
}

// ── Phase 4: per-candidate score parser ──────────────────────────────────────

function parseCandidateScores(decision: string, count: number): CandidateScore[] {
  const scores: CandidateScore[] = [];
  // Match: CANDIDATE A: correctness=8 completeness=7 security=9 efficiency=7 clarity=8
  const pattern = /CANDIDATE\s+([A-Z]):\s+correctness=(\d+)\s+completeness=(\d+)\s+security=(\d+)\s+efficiency=(\d+)\s+clarity=(\d+)/gi;
  for (const m of decision.matchAll(pattern)) {
    const idx = m[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < count) {
      const c = Number(m[2]);
      const comp = Number(m[3]);
      const sec = Number(m[4]);
      const eff = Number(m[5]);
      const cla = Number(m[6]);
      // Weights: correctness 40%, completeness 30%, security 15%, efficiency 10%, clarity 5%
      const weighted = Math.round((c * 0.40 + comp * 0.30 + sec * 0.15 + eff * 0.10 + cla * 0.05) * 10) / 10;
      scores.push({ letter: m[1].toUpperCase(), correctness: c, completeness: comp, security: sec, efficiency: eff, clarity: cla, weighted });
    }
  }
  return scores;
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
