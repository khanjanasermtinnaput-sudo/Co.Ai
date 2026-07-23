// Shared safety pipeline for applying AI-proposed file changes: security gate
// → reliability score → patch generate/validate → user confirmation →
// checkpoint → apply → build validation (auto-rollback on failure) →
// session history → ownership record.
//
// Every entry point that writes AI-generated changes to disk — every
// single-shot command in cli.ts AND the interactive REPL in interactive.ts —
// must go through this one function so both share exactly one safety story.
// This used to be a private function inside cli.ts that only the single-shot
// commands could reach; the REPL had its own, much thinner apply path
// (preview → snapshot → apply, no security gate, no reliability score, no
// build-validation auto-rollback, no ownership record). Extracted here so
// neither entry point can drift from the other again.

import chalk from "chalk";
import { cwd } from "node:process";
import { applyChanges, type FileChange } from "./files.js";
import { generatePatch, validatePatch, createCheckpoint, rollbackCheckpoint } from "./patch.js";
import { runBuildValidation, printValidationReport } from "./build-validator.js";
import { securityGateCheck, printSecurityReport } from "./security-agent.js";
import { computeReliability, printReliabilityScore } from "./reliability.js";
import { previewAndConfirm, printSuccess, printError, printInfo, printWarning } from "./safety.js";
import { appendSessionHistory } from "./disaster-recovery.js";
import { recordOwnership } from "./ownership.js";
import { startSpinner } from "./ui.js";

const ROOT = cwd();

export async function applyWithConfirm(
  changes: FileChange[],
  summary: string,
  opts: { prompt?: string; agentAction?: string; userId?: string } = {},
): Promise<void> {
  if (changes.length === 0) {
    console.log(chalk.dim("\nNo file changes proposed."));
    if (summary) {
      console.log(chalk.bold("\nResponse:"));
      console.log(chalk.dim(summary));
    }
    return;
  }

  // Security gate: static analysis before showing diff
  const secReport = securityGateCheck(ROOT, changes);
  printSecurityReport(secReport);
  if (!secReport.passed) {
    printError("Security gate blocked: resolve critical/high findings before applying.");
    return;
  }

  // Reliability score: show before asking user to approve
  const reliability = computeReliability(changes, summary, { root: ROOT, securityPassed: secReport.passed });
  printReliabilityScore(reliability);
  if (reliability.recommendation === "reject") {
    printError("Reliability score too low — changes blocked. Review and retry.");
    return;
  }

  // Generate patch
  const patch = generatePatch(changes, opts);

  // Validate patch (path safety, protected files, content checks)
  const validation = validatePatch(ROOT, patch);
  if (!validation.valid) {
    printError("Patch validation failed:");
    for (const e of validation.errors) console.error(chalk.red(`  ✗ ${e}`));
    return;
  }
  for (const w of validation.warnings) printWarning(w);

  // Show diff and require user approval
  const confirmed = await previewAndConfirm(changes);
  if (!confirmed) { printInfo("Discarded."); return; }

  // Create checkpoint BEFORE applying
  const cp = createCheckpoint(ROOT, patch);

  // Apply
  applyChanges(ROOT, changes);

  // Run build validation; auto-rollback on failure
  const buildSpinner = startSpinner("Running build validation…");
  const report = await runBuildValidation(ROOT);
  buildSpinner.stop();

  if (!report.passed) {
    printValidationReport(report);
    printWarning("Build validation failed — rolling back…");
    rollbackCheckpoint(cp.id);
    printError(`Rolled back to checkpoint ${cp.id}. No changes were applied.`);
    return;
  }

  printValidationReport(report);

  // Record session history for recovery
  appendSessionHistory(opts.agentAction ?? "apply", "ok");

  // Record ownership for every changed file
  recordOwnership(changes, {
    agentAction: opts.agentAction ?? "unknown",
    userId: opts.userId ?? "local",
    prompt: opts.prompt ?? "",
    checkpointId: cp.id,
  });

  printSuccess(`${changes.length} file(s) applied. Checkpoint: ${cp.id}`);

  if (summary) {
    console.log(chalk.bold("\nSummary:"));
    console.log(chalk.dim(summary));
  }
}
