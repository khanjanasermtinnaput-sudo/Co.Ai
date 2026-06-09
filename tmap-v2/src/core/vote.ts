// Voting / Consensus Engine (TDD §5 — parallel agents, majority vote)
// Used in pro mode: runs Coder twice in parallel, Reviewer picks the better result.

import type { LLMCall, CodeFile, Blackboard } from '../types.js';
import { runCoder } from './agents.js';

export interface VoteResult {
  files: CodeFile[];
  winnerIndex: number;   // 0 or 1
  reason: string;
}

/**
 * Run two Coder instances in parallel, then use a Reviewer call to pick the better one.
 * Falls back to candidate A if the reviewer call fails.
 */
export async function runCoderVote(
  coderCall: LLMCall,
  reviewerCall: LLMCall,
  bb: Blackboard,
  critique?: string,
): Promise<VoteResult> {
  // Run two coders in parallel with slightly different temperatures
  const [candidateA, candidateB] = await Promise.all([
    runCoder(coderCall, bb, critique),
    runCoder(coderCall, bb, critique),   // same call, different random seed from temperature
  ]);

  // Ask reviewer to pick the better candidate
  try {
    const prompt = buildVotePrompt(bb.task, candidateA, candidateB);
    const decision = await reviewerCall([
      { role: 'system', content: 'You are a code quality judge. Pick the better implementation and explain why in one sentence. Respond ONLY with: PICK: A or PICK: B\nREASON: <one sentence>' },
      { role: 'user', content: prompt },
    ], { temperature: 0.1, maxTokens: 120 });

    const pickB = /PICK:\s*B/i.test(decision);
    const reasonMatch = decision.match(/REASON:\s*(.+)/i);
    return {
      files: pickB ? candidateB : candidateA,
      winnerIndex: pickB ? 1 : 0,
      reason: reasonMatch?.[1]?.trim() ?? (pickB ? 'Candidate B selected' : 'Candidate A selected'),
    };
  } catch {
    // Reviewer unavailable — fall back to candidate A
    return { files: candidateA, winnerIndex: 0, reason: 'Reviewer unavailable; defaulted to candidate A' };
  }
}

function buildVotePrompt(task: string, a: CodeFile[], b: CodeFile[]): string {
  const fmt = (files: CodeFile[], label: string) =>
    `=== CANDIDATE ${label} (${files.length} file(s)) ===\n` +
    files.map((f) => `--- ${f.path} ---\n${f.content.slice(0, 800)}`).join('\n');
  return `Task: ${task}\n\n${fmt(a, 'A')}\n\n${fmt(b, 'B')}`;
}
