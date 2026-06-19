// AI Reliability Scoring: Confidence, Risk, Complexity, Validation scores per output

import chalk from "chalk";
import type { FileChange } from "./files.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReliabilityScore {
  confidence: number;   // 0–100: how sure the AI is about correctness
  risk: number;         // 0–100: how risky this change is (higher = riskier)
  complexity: number;   // 0–100: how complex the change is
  validation: number;   // 0–100: how well-validated the output is
  overall: number;      // weighted composite
  grade: "A" | "B" | "C" | "D" | "F";
  warnings: string[];
  recommendation: "apply" | "review" | "reject";
}

// ── Scoring Logic ──────────────────────────────────────────────────────────────

function scoreConfidence(changes: FileChange[], summary: string): number {
  let score = 80;

  // Penalise if summary suggests uncertainty
  const uncertainWords = /might|maybe|possibly|not sure|unclear|could be|uncertain|todo|fixme|placeholder/i;
  if (uncertainWords.test(summary)) score -= 20;

  // Penalise empty or very short files
  for (const c of changes) {
    if (c.op === "create" && (c.content?.length ?? 0) < 50) score -= 10;
  }

  // Bonus: summary is detailed
  if (summary.length > 200) score += 10;

  return Math.max(0, Math.min(100, score));
}

function scoreRisk(changes: FileChange[], root: string): number {
  let risk = 10;

  // More files = more risk
  risk += changes.length * 5;

  // Deletions are risky
  risk += changes.filter((c) => c.op === "delete").length * 20;

  // Config files are risky
  const configFiles = changes.filter((c) =>
    /\.(env|json|yaml|yml|toml|config\.)/.test(c.path) || c.path.includes("tsconfig"),
  );
  risk += configFiles.length * 15;

  // Touching auth/security files
  const authFiles = changes.filter((c) => /auth|security|middleware|session|jwt|token/i.test(c.path));
  risk += authFiles.length * 25;

  // Large changes
  for (const c of changes) {
    if (c.op === "edit" && c.oldContent && c.content) {
      const oldLines = c.oldContent.split("\n").length;
      const newLines = c.content.split("\n").length;
      const changePct = Math.abs(newLines - oldLines) / Math.max(oldLines, 1);
      if (changePct > 0.5) risk += 10; // >50% lines changed
    }
  }

  return Math.max(0, Math.min(100, risk));
}

function scoreComplexity(changes: FileChange[]): number {
  let complexity = 20;

  // More files = higher complexity
  complexity += changes.length * 8;

  // Different types of changes = higher complexity
  const ops = new Set(changes.map((c) => c.op));
  complexity += (ops.size - 1) * 10;

  // Large files = higher complexity
  for (const c of changes) {
    const lines = (c.content ?? "").split("\n").length;
    if (lines > 100) complexity += 10;
    if (lines > 300) complexity += 20;
  }

  return Math.max(0, Math.min(100, complexity));
}

function scoreValidation(
  changes: FileChange[],
  buildPassed?: boolean,
  securityPassed?: boolean,
): number {
  let score = 50;

  // Build validation bonus
  if (buildPassed === true)  score += 30;
  if (buildPassed === false) score -= 30;

  // Security gate bonus
  if (securityPassed === true)  score += 20;
  if (securityPassed === false) score -= 40;

  // Tests present
  const hasTests = changes.some((c) => /\.test\.|\.spec\./.test(c.path));
  if (hasTests) score += 10;

  return Math.max(0, Math.min(100, score));
}

function gradeFromScore(score: number): ReliabilityScore["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function computeReliability(
  changes: FileChange[],
  summary: string,
  opts: {
    root?: string;
    buildPassed?: boolean;
    securityPassed?: boolean;
  } = {},
): ReliabilityScore {
  const confidence  = scoreConfidence(changes, summary);
  const risk        = scoreRisk(changes, opts.root ?? ".");
  const complexity  = scoreComplexity(changes);
  const validation  = scoreValidation(changes, opts.buildPassed, opts.securityPassed);

  // Weighted composite: confidence and validation matter most
  const overall = Math.round(
    confidence  * 0.35 +
    (100 - risk) * 0.25 +
    (100 - complexity) * 0.15 +
    validation  * 0.25,
  );

  const grade = gradeFromScore(overall);
  const warnings: string[] = [];

  if (risk > 70)       warnings.push("High-risk changes detected — review carefully");
  if (confidence < 50) warnings.push("Low AI confidence — manual review recommended");
  if (complexity > 70) warnings.push("High complexity — consider breaking into smaller changes");
  if (validation < 40) warnings.push("Low validation score — run tests before deploying");

  const recommendation: ReliabilityScore["recommendation"] =
    overall >= 70 && risk < 60 ? "apply"
    : overall >= 50            ? "review"
    : "reject";

  return { confidence, risk, complexity, validation, overall, grade, warnings, recommendation };
}

// ── Print ─────────────────────────────────────────────────────────────────────

function bar(value: number, invert = false): string {
  const pct   = invert ? 100 - value : value;
  const filled = Math.round(pct / 10);
  const empty  = 10 - filled;
  const color  = pct >= 70 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
  return color("█".repeat(filled)) + chalk.dim("░".repeat(empty)) + chalk.dim(` ${value}`);
}

export function printReliabilityScore(score: ReliabilityScore): void {
  const gradeColor = { A: chalk.green, B: chalk.cyan, C: chalk.yellow, D: chalk.red, F: chalk.bgRed.white };
  const recColor   = score.recommendation === "apply" ? chalk.green : score.recommendation === "review" ? chalk.yellow : chalk.red;

  console.log(chalk.bold("\n  Reliability Score"));
  console.log(chalk.dim("─".repeat(50)));
  console.log(`  Confidence   ${bar(score.confidence)}`);
  console.log(`  Risk         ${bar(score.risk, true)}  ${chalk.dim("(lower = safer)")}`);
  console.log(`  Complexity   ${bar(score.complexity, true)}`);
  console.log(`  Validation   ${bar(score.validation)}`);
  console.log(chalk.dim("─".repeat(50)));
  console.log(`  Overall: ${gradeColor[score.grade](score.grade)}  (${score.overall}/100)  →  ${recColor(score.recommendation.toUpperCase())}`);

  for (const w of score.warnings) {
    console.log(chalk.yellow(`  ⚠ ${w}`));
  }
  console.log();
}
