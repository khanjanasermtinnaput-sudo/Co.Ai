// Multi-Agent Debate System: Architect → Reviewer → Security → Performance → Final Plan

import chalk from "chalk";
import type { CoaiApiClient } from "./api.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentRole = "architect" | "reviewer" | "security" | "performance";

export interface AgentOpinion {
  role: AgentRole;
  proposal?: string;   // architect only
  critique: string;
  score: number;       // 0–10
  blockers: string[];  // must-fix issues
  suggestions: string[];
}

export interface DebateResult {
  task: string;
  rounds: AgentOpinion[];
  finalPlan: string;
  consensusScore: number;
  approved: boolean;
}

// ── Agent Prompts ──────────────────────────────────────────────────────────────

const AGENT_PROMPTS: Record<AgentRole, (task: string, prev: string) => string> = {
  architect: (task) => `
You are the Architect Agent. Design a clear implementation plan for this task:

Task: ${task}

Provide:
1. Proposed approach (step-by-step)
2. Files to create/modify
3. Key design decisions
4. Potential risks

Be specific. No placeholder code. Score your own confidence 0-10.
`.trim(),

  reviewer: (task, architectPlan) => `
You are the Reviewer Agent. Critically evaluate this implementation plan.

Task: ${task}

Architect's Proposal:
${architectPlan}

Review for:
1. Logical correctness
2. Completeness (are any steps missing?)
3. Maintainability
4. Over-engineering or unnecessary complexity
5. Missing edge cases

List BLOCKERS (must fix) and SUGGESTIONS (nice to have).
Score the proposal 0-10.
`.trim(),

  security: (task, architectPlan) => `
You are the Security Agent. Review this plan for security risks.

Task: ${task}

Architect's Proposal:
${architectPlan}

Check for:
1. Authentication/authorization gaps
2. Injection risks (SQL, command, XSS)
3. Secrets exposure
4. Unsafe file/network access
5. Missing input validation
6. Cryptographic weaknesses

List BLOCKERS (must fix) and SUGGESTIONS.
Score security posture 0-10.
`.trim(),

  performance: (task, architectPlan) => `
You are the Performance Agent. Review this plan for performance and efficiency.

Task: ${task}

Architect's Proposal:
${architectPlan}

Check for:
1. N+1 query patterns
2. Missing caching opportunities
3. Unnecessary re-renders (for UI)
4. Blocking I/O in hot paths
5. Memory leaks
6. Over-fetching data

List BLOCKERS (must fix) and SUGGESTIONS.
Score performance posture 0-10.
`.trim(),
};

const FINAL_PLAN_PROMPT = (task: string, debate: string) => `
You are the Orchestrator. Based on the multi-agent debate, produce the final approved implementation plan.

Task: ${task}

Debate Summary:
${debate}

Produce:
1. Final implementation plan (addressing all blockers)
2. Files to modify
3. Key changes from original proposal
4. Risk mitigations applied

This plan will be used directly for code generation. Be precise and complete.
`.trim();

// ── Debate Engine ──────────────────────────────────────────────────────────────

async function runAgent(
  api: CoaiApiClient,
  role: AgentRole,
  task: string,
  context: string,
  prevText: string,
): Promise<string> {
  const prompt  = AGENT_PROMPTS[role](task, prevText);
  let response  = "";

  for await (const event of api.stream("/v1/chat", {
    message: prompt,
    history: [],
    context: context.slice(0, 15_000),
  })) {
    if (event.kind === "chunk" && typeof event.text === "string") response += event.text;
    if (event.kind === "done"  && typeof event.text === "string") response  = event.text;
  }

  return response.trim();
}

function extractScore(text: string): number {
  const m = text.match(/score[:\s]+(\d+)(?:\/10)?/i) ?? text.match(/(\d+)\/10/);
  if (m) return Math.min(10, Math.max(0, parseInt(m[1]!, 10)));
  return 7; // default
}

function extractBlockers(text: string): string[] {
  const blockers: string[] = [];
  const lines = text.split("\n");
  let inBlockers = false;
  for (const line of lines) {
    if (/blocker/i.test(line)) { inBlockers = true; continue; }
    if (/suggestion/i.test(line)) { inBlockers = false; }
    if (inBlockers && /^[-*•]/.test(line.trim())) {
      blockers.push(line.trim().replace(/^[-*•]\s*/, ""));
    }
  }
  return blockers;
}

export async function runDebate(
  api: CoaiApiClient,
  task: string,
  context: string,
  onProgress?: (role: AgentRole, text: string) => void,
): Promise<DebateResult> {
  const rounds: AgentOpinion[] = [];
  let architectPlan = "";

  // Round 1: Architect proposes
  const archText = await runAgent(api, "architect", task, context, "");
  architectPlan  = archText;
  const archOpinion: AgentOpinion = {
    role: "architect",
    proposal: archText,
    critique: "",
    score: extractScore(archText),
    blockers: [],
    suggestions: [],
  };
  rounds.push(archOpinion);
  onProgress?.("architect", archText);

  // Rounds 2–4: Reviewer, Security, Performance critique
  for (const role of ["reviewer", "security", "performance"] as AgentRole[]) {
    const text = await runAgent(api, role, task, context, architectPlan);
    rounds.push({
      role,
      critique: text,
      score: extractScore(text),
      blockers: extractBlockers(text),
      suggestions: [],
    });
    onProgress?.(role, text);
  }

  // Build debate summary for final plan
  const debateSummary = rounds.map((r) =>
    `[${r.role.toUpperCase()}] Score: ${r.score}/10\n${r.proposal ?? r.critique}\n`,
  ).join("\n---\n");

  // Final plan
  const finalPlan = await (async () => {
    let text = "";
    for await (const event of api.stream("/v1/chat", {
      message: FINAL_PLAN_PROMPT(task, debateSummary),
      history: [],
      context: context.slice(0, 10_000),
    })) {
      if (event.kind === "chunk" && typeof event.text === "string") text += event.text;
      if (event.kind === "done"  && typeof event.text === "string") text  = event.text;
    }
    return text.trim();
  })();

  const consensusScore = Math.round(rounds.reduce((s, r) => s + r.score, 0) / rounds.length);
  const allBlockers    = rounds.flatMap((r) => r.blockers);

  return {
    task,
    rounds,
    finalPlan,
    consensusScore,
    approved: consensusScore >= 6 && allBlockers.length === 0,
  };
}

// ── Print ─────────────────────────────────────────────────────────────────────

const ROLE_COLOR: Record<AgentRole, (s: string) => string> = {
  architect:   chalk.blue,
  reviewer:    chalk.cyan,
  security:    chalk.red,
  performance: chalk.magenta,
};

export function printDebateResult(result: DebateResult): void {
  console.log(chalk.bold("\n  Multi-Agent Debate"));
  console.log(chalk.dim("─".repeat(60)));

  for (const round of result.rounds) {
    const color = ROLE_COLOR[round.role];
    console.log(color(`\n  ▶ ${round.role.toUpperCase()} (${round.score}/10)`));
    console.log(chalk.dim("  " + (round.proposal ?? round.critique).slice(0, 400).replace(/\n/g, "\n  ")));
    if (round.blockers.length > 0) {
      console.log(chalk.red(`  Blockers: ${round.blockers.join(" | ")}`));
    }
  }

  console.log(chalk.bold("\n  Final Plan"));
  console.log(chalk.dim("─".repeat(60)));
  console.log(chalk.dim("  " + result.finalPlan.slice(0, 1000).replace(/\n/g, "\n  ")));

  const scoreColor = result.consensusScore >= 8 ? chalk.green : result.consensusScore >= 6 ? chalk.yellow : chalk.red;
  console.log(`\n  Consensus Score: ${scoreColor(result.consensusScore + "/10")}`);
  console.log(result.approved ? chalk.green("  ✓ Approved for implementation") : chalk.red("  ✗ Not approved — resolve blockers first"));
  console.log();
}
