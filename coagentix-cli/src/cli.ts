#!/usr/bin/env node
// Coagentix Code CLI — main entry point

import { Command, Option } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { cwd } from "node:process";
import { hostname } from "node:os";

import { loadConfig, saveConfig, clearConfig, requireLogin, defaultApiBase, isLoggedIn } from "./auth.js";
import { enforceZeroTrust, generateDeviceFingerprint, recordAudit } from "./zero-trust.js";
import { CoaiApiClient } from "./api.js";
import { scanRepository, buildRepoContext } from "./repo.js";
import { parseCodeBlocks, applyChanges, fileExists } from "./files.js";
import { generatePatch, validatePatch, createCheckpoint, rollbackCheckpoint, listCheckpoints } from "./patch.js";
import { runBuildValidation, printValidationReport } from "./build-validator.js";
import { getOrBuildGraph, summarizeGraph } from "./knowledge-graph.js";
import { detectArchitecture, printArchReport } from "./arch-detector.js";
import { recordOwnership, getFileHistory, getRecentChanges, printOwnershipHistory } from "./ownership.js";
import { generateTests, runTests, printTestResults } from "./test-generator.js";
import { securityGateCheck, aiSecurityReview, printSecurityReport } from "./security-agent.js";
import { runDebate, printDebateResult } from "./debate.js";
import { selectTier, printCostPlan } from "./cost-optimizer.js";
import { computeReliability, printReliabilityScore } from "./reliability.js";
import { listTasks, readTaskOutput, cancelTask, deleteTask } from "./background.js";
import { generateDoc, getDocPath, printDocTypes } from "./docs-agent.js";
import {
  saveSession, loadSession, appendSessionHistory, clearSession,
  snapshotWorkspace, restoreWorkspace, listWorkspaceSnapshots,
  getRecoverySummary, printRecoverySummary,
} from "./disaster-recovery.js";
import { getGit, isGitRepo, getCurrentBranch, createBranch, stageAll, commit as gitCommit, push, pull, getLog } from "./git.js";
import { previewAndConfirm, printSuccess, printError, printInfo, printWarning, askYesNo } from "./safety.js";
import { startInteractiveSession } from "./interactive.js";
import { renderStreamEvent, startSpinner, brand, header, printTable } from "./ui.js";
import { execCommand, parseCommand } from "./terminal.js";
import type { FileChange } from "./files.js";

const VERSION = "1.0.0";
const ROOT    = cwd();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeClient(action: string): Promise<CoaiApiClient> {
  const cfg = requireLogin();
  const fingerprint = generateDeviceFingerprint();
  const api = new CoaiApiClient(cfg, fingerprint);
  await enforceZeroTrust(api, cfg, action);
  return api;
}

async function streamToChanges(
  api: CoaiApiClient,
  endpoint: string,
  body: unknown,
  label: string,
): Promise<{ changes: FileChange[]; summary: string }> {
  const spinner = startSpinner(label);
  const changes: FileChange[] = [];
  let summary = "";

  try {
    for await (const event of api.stream(endpoint, body)) {
      renderStreamEvent(event, spinner);

      if (event.kind === "files" && Array.isArray(event.files)) {
        for (const f of event.files as Array<{ path: string; content: string }>) {
          const op = fileExists(ROOT, f.path) ? "edit" : "create";
          changes.push({ op, path: f.path, content: f.content });
        }
      }
      if (event.kind === "code" && typeof event.text === "string") {
        changes.push(...parseCodeBlocks(event.text, ROOT));
      }
      if (event.kind === "summary" && typeof event.text === "string") {
        summary = event.text;
      }
    }
    spinner.stop();
  } catch (err) {
    spinner.fail(String(err));
    throw err;
  }

  return { changes, summary };
}

async function applyWithConfirm(
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

// ── CLI setup ─────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("coai")
  .description("Coagentix Code CLI — AI coding agent (Advanced subscribers only)")
  .version(VERSION, "-v, --version")
  .addOption(new Option("--titan", "Enable Titan multi-agent mode"))
  .addOption(new Option("--model <model>", "Override the model (e.g. deepseek-coder)"))
  .argument("[task]", "Coding task to run (omit for interactive mode)")
  .action(async (task?: string, opts?: { titan?: boolean; model?: string }) => {
    header(VERSION);

    if (!isLoggedIn()) {
      printWarning("Not logged in. Run: coai login");
      process.exit(1);
    }

    const api = await makeClient("run");

    if (!task) {
      // Interactive REPL mode
      await startInteractiveSession(api, ROOT, { titan: opts?.titan, model: opts?.model });
      return;
    }

    // Single prompt mode
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 30_000);

    // Smart cost optimization: select model tier based on task complexity
    const plan = selectTier(task, context.length, { titan: opts?.titan, model: opts?.model });
    printCostPlan(plan);

    const { changes, summary } = await streamToChanges(
      api,
      plan.endpoint,
      {
        task,
        context,
        mode: plan.mode,
        model: plan.model,
        repoInfo: { framework: repoInfo.framework, language: repoInfo.language },
      },
      `[${plan.tier}] ${task.slice(0, 60)}…`,
    );

    await applyWithConfirm(changes, summary, { agentAction: "run", prompt: task });
  });

// ── coai login ────────────────────────────────────────────────────────────────

program
  .command("login")
  .description("Authenticate with your Coagentix CLI token")
  .option("--api-base <url>", "Override API base URL")
  .action(async (opts: { apiBase?: string }) => {
    header(VERSION);
    const apiBase = opts.apiBase ?? defaultApiBase();
    console.log(chalk.dim(`API: ${apiBase}\n`));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const token = await new Promise<string>((resolve) => {
      rl.question(chalk.cyan("Paste your CLI token (from Settings → Advanced): "), (a) => {
        rl.close();
        resolve(a.trim());
      });
    });

    if (!token.startsWith("coai_") || token.length < 40) {
      printError("Invalid token format. Token must start with coai_");
      process.exit(1);
    }

    const spinner = startSpinner("Authenticating…");
    try {
      const tmpClient = new CoaiApiClient({
        jwt: "", userId: "", email: "", tier: "", apiBase, savedAt: "",
      });
      const result = await tmpClient.cliAuth(token, `${hostname()} (${process.platform})`);
      const fingerprint = generateDeviceFingerprint();
      saveConfig({
        jwt: result.jwt,
        userId: result.userId,
        email: result.email,
        tier: result.tier,
        apiBase,
        savedAt: new Date().toISOString(),
        deviceFingerprint: fingerprint,
        lastVerified: new Date().toISOString(),
      });
      recordAudit({ ts: new Date().toISOString(), userId: result.userId, action: "login", result: "ok", device: fingerprint });
      saveSession({ id: result.userId, cwd: ROOT, history: [] });
      spinner.succeed(chalk.green("Authenticated!"));
      console.log(chalk.dim(`  Account: ${result.email} · ${result.tier}`));
      console.log(chalk.dim(`  Run ${brand("coai")} to start.\n`));
    } catch (err) {
      spinner.fail(chalk.red(`Authentication failed: ${err}`));
      process.exit(1);
    }
  });

// ── coai logout ───────────────────────────────────────────────────────────────

program
  .command("logout")
  .description("Log out and clear stored credentials")
  .action(() => {
    clearConfig();
    printSuccess("Logged out. Credentials cleared.");
  });

// ── coai status ───────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show authentication status and repo info")
  .action(async () => {
    const cfg = loadConfig();
    if (!cfg?.jwt) {
      printWarning("Not logged in. Run: coai login");
      return;
    }

    const api = new CoaiApiClient(cfg);
    const spinner = startSpinner("Checking status…");

    const [serverStatus, repoInfo] = await Promise.all([
      api.getStatus().catch(() => null),
      scanRepository(ROOT).catch(() => null),
    ]);

    spinner.stop();

    console.log(chalk.bold("\n  Auth"));
    console.log("  " + chalk.dim("Email:    ") + chalk.bold(cfg.email));
    console.log("  " + chalk.dim("Tier:     ") + brand(cfg.tier));
    console.log("  " + chalk.dim("API:      ") + chalk.dim(cfg.apiBase));
    if (serverStatus) {
      console.log("  " + chalk.dim("Server:   ") + chalk.green("connected"));
      console.log("  " + chalk.dim("Providers:") + chalk.dim(" " + (serverStatus.providers.join(", ") || "none")));
    } else {
      console.log("  " + chalk.dim("Server:   ") + chalk.red("unreachable"));
    }

    if (repoInfo) {
      console.log(chalk.bold("\n  Repository"));
      console.log("  " + chalk.dim("Framework: ") + chalk.bold(repoInfo.framework));
      console.log("  " + chalk.dim("Language:  ") + chalk.bold(repoInfo.language));
      console.log("  " + chalk.dim("Package:   ") + chalk.dim(repoInfo.packageManager));
      console.log("  " + chalk.dim("Files:     ") + chalk.dim(String(repoInfo.fileCount)));
    }
    console.log();
  });

// ── coai review ───────────────────────────────────────────────────────────────

program
  .command("review")
  .description("AI code review of the current repository")
  .option("--file <path>", "Review a specific file only")
  .action(async (opts: { file?: string }) => {
    const api = await makeClient("review");
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 30_000);

    const task = opts.file
      ? `Review this file for security issues, bugs, and improvements: ${opts.file}`
      : "Perform a comprehensive code review: security, performance, maintainability, architecture, naming, testing coverage, and dependency risks. Generate a risk score and prioritised recommendations.";

    const spinner = startSpinner("Reviewing codebase…");
    let reviewText = "";

    try {
      for await (const event of api.stream("/v1/analyze", { brief: task, context, mode: "pro" })) {
        renderStreamEvent(event, spinner);
        if (event.kind === "summary" && typeof event.text === "string") reviewText = event.text;
        if (event.kind === "chunk" && typeof event.text === "string") reviewText += event.text;
      }
      spinner.succeed("Review complete");
    } catch (err) {
      spinner.fail(String(err));
      return;
    }

    if (reviewText) {
      console.log(chalk.bold("\nCode Review Report:"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(reviewText);
    }
  });

// ── coai fix ──────────────────────────────────────────────────────────────────

program
  .command("fix [description]")
  .description("Fix a bug or error in the repository")
  .action(async (description?: string) => {
    const api = await makeClient("fix");
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 30_000);

    const task = description
      ? `Fix this bug/error: ${description}`
      : "Analyse the codebase for bugs and fix the most critical ones. Show what was broken and how it was fixed.";

    const { changes, summary } = await streamToChanges(
      api, "/v1/debug",
      { error: task, context, mode: "pro" },
      "Analysing and fixing…",
    );

    await applyWithConfirm(changes, summary);
  });

// ── coai generate ─────────────────────────────────────────────────────────────

program
  .command("generate [description]")
  .description("Generate a complete project or feature")
  .option("--stack <stack>", "Tech stack (e.g. next,tailwind,supabase)")
  .action(async (description?: string, opts?: { stack?: string }) => {
    const api = await makeClient("generate");

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const task = description ?? await new Promise<string>((resolve) => {
      rl.question(chalk.cyan("Describe what to generate: "), (a) => { rl.close(); resolve(a.trim()); });
    });
    if (description) rl.close();

    const stackNote = opts?.stack ? ` Use this stack: ${opts.stack}.` : "";
    const fullTask  = `Generate a complete, production-ready project: ${task}.${stackNote} Create all necessary files, configurations, and structure. No placeholder code.`;

    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 10_000);

    const { changes, summary } = await streamToChanges(
      api, "/v1/run",
      { task: fullTask, context, mode: "pro" },
      "Generating project…",
    );

    await applyWithConfirm(changes, summary);
  });

// ── coai explain ──────────────────────────────────────────────────────────────

program
  .command("explain [file]")
  .description("Explain the project architecture or a specific file")
  .action(async (file?: string) => {
    const api = await makeClient("explain");
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 30_000);

    const task = file
      ? `Explain this file in detail, its purpose, how it works, and how it fits the project: ${file}`
      : "Explain the project architecture: what it does, the technology stack, the key modules and how they interact, the data flow, and how to get started.";

    const spinner = startSpinner("Analysing…");
    let explanation = "";

    try {
      for await (const event of api.stream("/v1/chat", { message: task, history: [], context })) {
        renderStreamEvent(event, spinner);
        if (event.kind === "chunk" && typeof event.text === "string") explanation += event.text;
        if (event.kind === "done" && typeof event.text === "string") explanation = event.text;
      }
      spinner.succeed("Done");
    } catch (err) {
      spinner.fail(String(err));
      return;
    }

    console.log(chalk.bold("\nExplanation:"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(explanation);
  });

// ── coai refactor ─────────────────────────────────────────────────────────────

program
  .command("refactor [description]")
  .description("Refactor code for clarity, performance, or architecture")
  .action(async (description?: string) => {
    const api = await makeClient("refactor");
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 30_000);

    const task = description
      ? `Refactor: ${description}`
      : "Identify and apply the most impactful refactoring opportunities: naming, DRY, structure, complexity, and performance.";

    const { changes, summary } = await streamToChanges(
      api, "/v1/run",
      { task, context, mode: "pro" },
      "Refactoring…",
    );

    await applyWithConfirm(changes, summary);
  });

// ── coai commit ───────────────────────────────────────────────────────────────

program
  .command("commit [message]")
  .description("Stage all changes and generate an AI commit message")
  .option("--no-stage", "Skip auto-staging (stage manually first)")
  .action(async (message?: string, opts?: { stage?: boolean }) => {
    const git = getGit(ROOT);
    if (!(await isGitRepo(ROOT))) { printError("Not a git repository"); return; }

    if (opts?.stage !== false) await stageAll(git);

    let msg = message;
    if (!msg) {
      const api = await makeClient("commit");
      const spinner = startSpinner("Generating commit message…");
      const repoInfo = await scanRepository(ROOT);
      const context  = await buildRepoContext(ROOT, repoInfo, 10_000);
      let generated = "";

      try {
        for await (const event of api.stream("/v1/chat", {
          message: "Generate a concise conventional commit message (feat/fix/chore/refactor/docs/style/test) for the staged changes. Return only the commit message, nothing else.",
          context,
          history: [],
        })) {
          if (event.kind === "chunk" && typeof event.text === "string") generated += event.text;
          if (event.kind === "done" && typeof event.text === "string") generated = event.text;
        }
        spinner.succeed("Message ready");
      } catch {
        spinner.fail("Could not generate message — using default");
      }

      msg = generated.trim() || "chore: update codebase";
      console.log(chalk.dim(`\n  "${msg}"`));
      const ok = await askYesNo("Use this message? (Y/n)");
      if (!ok) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        msg = await new Promise<string>((resolve) => {
          rl.question(chalk.cyan("Enter commit message: "), (a) => { rl.close(); resolve(a.trim()); });
        });
      }
    }

    const hash = await gitCommit(git, msg);
    printSuccess(`Committed ${hash.slice(0, 7)}: ${msg}`);
  });

// ── coai branch ───────────────────────────────────────────────────────────────

program
  .command("branch [name]")
  .description("Create and switch to a new branch")
  .action(async (name?: string) => {
    const git = getGit(ROOT);
    if (!(await isGitRepo(ROOT))) { printError("Not a git repository"); return; }

    let branchName = name;
    if (!branchName) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      branchName = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan("Branch name: "), (a) => { rl.close(); resolve(a.trim()); });
      });
    }
    if (!branchName) { printError("Branch name required"); return; }

    await createBranch(git, branchName);
    printSuccess(`Switched to new branch: ${branchName}`);
  });

// ── coai pull ─────────────────────────────────────────────────────────────────

program
  .command("pull")
  .description("Pull latest changes from origin")
  .action(async () => {
    const git = getGit(ROOT);
    if (!(await isGitRepo(ROOT))) { printError("Not a git repository"); return; }
    const spinner = startSpinner("Pulling…");
    try {
      await pull(git);
      spinner.succeed("Pulled latest changes");
    } catch (err) {
      spinner.fail(String(err));
    }
  });

// ── coai push ─────────────────────────────────────────────────────────────────

program
  .command("push")
  .description("Push current branch to origin")
  .action(async () => {
    const git = getGit(ROOT);
    if (!(await isGitRepo(ROOT))) { printError("Not a git repository"); return; }
    const branch = await getCurrentBranch(git);
    const ok = await askYesNo(`Push branch '${branch}' to origin? (Y/n)`);
    if (!ok) { printInfo("Push cancelled."); return; }
    const spinner = startSpinner(`Pushing ${branch}…`);
    try {
      await push(git);
      spinner.succeed(`Pushed ${branch} to origin`);
    } catch (err) {
      spinner.fail(String(err));
    }
  });

// ── coai docs ─────────────────────────────────────────────────────────────────

program
  .command("docs [type]")
  .description("Generate or update documentation (readme|architecture|api|changelog|migration)")
  .action(async (type?: string) => {
    if (!type) {
      printDocTypes();
      return;
    }

    const validTypes = ["readme", "architecture", "api", "changelog", "migration"] as const;
    type DocTypeInput = typeof validTypes[number];
    if (!validTypes.includes(type as DocTypeInput)) {
      printError(`Unknown doc type: ${type}. Valid: ${validTypes.join(", ")}`);
      return;
    }

    const api      = await makeClient("docs");
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 20_000);
    const arch     = detectArchitecture(ROOT);
    const graph    = await getOrBuildGraph(ROOT);

    const spinner = startSpinner(`Generating ${type}…`);
    let content = "";
    try {
      content = await generateDoc(api, ROOT, { type: type as DocTypeInput, arch, graph }, context);
      spinner.succeed(`${type} generated`);
    } catch (err) {
      spinner.fail(String(err));
      return;
    }

    const docPath = getDocPath(ROOT, type as DocTypeInput);
    const { existsSync } = await import("node:fs");
    const { relative } = await import("node:path");
    const changes: FileChange[] = [{
      op: existsSync(docPath) ? "edit" : "create",
      path: relative(ROOT, docPath),
      content,
    }];

    await applyWithConfirm(changes, "", { agentAction: "docs", prompt: `Generate ${type}` });
  });

// ── coai tasks ────────────────────────────────────────────────────────────────

program
  .command("tasks [id]")
  .description("List background tasks or inspect/cancel a specific task")
  .option("--cancel", "Cancel the specified task")
  .option("--delete", "Delete the task record")
  .option("--output", "Show task output")
  .action(async (id?: string, opts?: { cancel?: boolean; delete?: boolean; output?: boolean }) => {
    if (id) {
      if (opts?.cancel) {
        const ok = cancelTask(id);
        ok ? printSuccess(`Task ${id} cancelled`) : printError(`Could not cancel task ${id}`);
        return;
      }
      if (opts?.delete) {
        deleteTask(id);
        printSuccess(`Task ${id} deleted`);
        return;
      }
      if (opts?.output) {
        console.log(chalk.bold(`\n  Output: ${id}`));
        console.log(chalk.dim("─".repeat(60)));
        console.log(readTaskOutput(id));
        return;
      }
    }

    const tasks = listTasks();
    if (tasks.length === 0) { printInfo("No background tasks."); return; }

    console.log(chalk.bold(`\n  Background Tasks (${tasks.length})`));
    console.log(chalk.dim("─".repeat(70)));

    for (const t of tasks.slice(0, 30)) {
      const statusColor =
        t.status === "completed" ? chalk.green :
        t.status === "running"   ? chalk.cyan :
        t.status === "failed"    ? chalk.red :
        t.status === "cancelled" ? chalk.dim : chalk.yellow;

      const ts  = chalk.dim(t.createdAt.replace("T", " ").slice(0, 19));
      const st  = statusColor(t.status.padEnd(10));
      const lbl = chalk.bold(t.label.slice(0, 40));
      const pid = t.pid ? chalk.dim(`pid:${t.pid}`) : "";
      console.log(`  ${ts}  ${st} ${lbl}  ${chalk.dim(t.id)} ${pid}`);
    }

    console.log(chalk.dim("\n  coai tasks <id> --output   Show output"));
    console.log(chalk.dim("  coai tasks <id> --cancel   Cancel running task\n"));
  });

// ── coai debate ───────────────────────────────────────────────────────────────

program
  .command("debate <task>")
  .description("Run multi-agent debate (Architect → Reviewer → Security → Performance) before implementing")
  .action(async (task: string) => {
    const api      = await makeClient("debate");
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 20_000);

    console.log(chalk.bold("\n  Initiating Multi-Agent Debate…"));
    console.log(chalk.dim(`  Task: ${task}\n`));

    const spinner = startSpinner("Architect proposing…");

    try {
      const result = await runDebate(api, task, context, (role) => {
        spinner.text = `${role} agent running…`;
      });
      spinner.succeed("Debate complete");
      printDebateResult(result);

      if (result.approved) {
        const ok = await askYesNo("Proceed with implementation using final plan? (Y/n)");
        if (ok) {
          const { changes, summary } = await streamToChanges(
            api, program.opts()?.titan ? "/v1/titan" : "/v1/run",
            { task: result.finalPlan, context, mode: "pro" },
            "Implementing approved plan…",
          );
          await applyWithConfirm(changes, summary, { agentAction: "debate-implement", prompt: task });
        }
      }
    } catch (err) {
      spinner.fail(String(err));
    }
  });

// ── coai security ─────────────────────────────────────────────────────────────

program
  .command("security")
  .description("Full AI security review of the repository")
  .action(async () => {
    const api      = await makeClient("security");
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 30_000);

    const spinner = startSpinner("Running AI security review…");
    let report = "";
    try {
      report = await aiSecurityReview(api, context);
      spinner.succeed("Security review complete");
    } catch (err) {
      spinner.fail(String(err));
      return;
    }

    console.log(chalk.bold("\nSecurity Review Report:"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(report);
  });

// ── coai test ─────────────────────────────────────────────────────────────────

program
  .command("test [file]")
  .description("Generate and run tests for a file (or run existing tests)")
  .option("--generate", "Generate tests using AI before running")
  .option("--type <types>", "Test types: unit,integration,api,component", "unit")
  .action(async (file?: string, opts?: { generate?: boolean; type?: string }) => {
    const api     = await makeClient("test");
    const cfg     = requireLogin();
    const repoInfo = await scanRepository(ROOT);
    const arch     = detectArchitecture(ROOT);

    if (file && opts?.generate) {
      const context = await buildRepoContext(ROOT, repoInfo, 20_000);
      const types   = (opts.type ?? "unit").split(",") as Array<"unit" | "integration" | "api" | "component">;

      const spinner = startSpinner(`Generating ${types.join("+")} tests for ${file}…`);
      let testContent = "";
      try {
        testContent = await generateTests(api, ROOT, {
          targetFile: file,
          testTypes: types,
          framework: arch.framework,
        }, context);
        spinner.succeed("Tests generated");
      } catch (err) {
        spinner.fail(String(err));
        return;
      }

      const ext      = file.match(/\.(tsx?|jsx?)$/) ? file.replace(/\.(tsx?|jsx?)$/, ".test.$1") : file + ".test.ts";
      const testFile = ext.replace(/\.test\.(tsx?)$/, ".test.$1");
      const testPath = file.replace(/\.(tsx?|jsx?)$/, ".test.$&".replace(".$&", "." + file.split(".").pop()));

      const changes: FileChange[] = [{ op: "create", path: testPath, content: testContent }];
      await applyWithConfirm(changes, "", {
        agentAction: "test-generate",
        userId: cfg.userId,
        prompt: `Generate tests for ${file}`,
      });
    }

    // Run existing tests
    const spinner2 = startSpinner("Running tests…");
    const result = runTests(ROOT);
    spinner2.stop();
    printTestResults(result);
  });

// ── coai history ──────────────────────────────────────────────────────────────

program
  .command("history [file]")
  .description("Show change history (all files or a specific file)")
  .option("--lines <n>", "Number of recent entries to show", "20")
  .action(async (file?: string, opts?: { lines?: string }) => {
    const n = parseInt(opts?.lines ?? "20", 10);
    const entries = file ? getFileHistory(file) : getRecentChanges(n);
    printOwnershipHistory(entries.slice(0, n));
  });

// ── coai analyze ──────────────────────────────────────────────────────────────

program
  .command("analyze")
  .description("Analyze project architecture and build knowledge graph")
  .action(async () => {
    const spinner = startSpinner("Analyzing project architecture…");
    const graph = await getOrBuildGraph(ROOT);
    const arch  = detectArchitecture(ROOT, graph);
    spinner.succeed("Analysis complete");

    printArchReport(arch);

    console.log(chalk.bold("  Knowledge Graph"));
    console.log(chalk.dim("─".repeat(55)));
    console.log("  " + summarizeGraph(graph).replace(/\n/g, "\n  "));
    console.log();
  });

// ── coai checkpoint ───────────────────────────────────────────────────────────

program
  .command("checkpoint [id]")
  .description("List checkpoints or rollback to a specific checkpoint")
  .option("--rollback", "Rollback to the specified checkpoint")
  .action(async (id?: string, opts?: { rollback?: boolean }) => {
    if (opts?.rollback && id) {
      const ok = await askYesNo(chalk.yellow(`Rollback to checkpoint ${id}? This will overwrite current files. (y/N)`), false);
      if (!ok) { printInfo("Rollback cancelled."); return; }
      try {
        rollbackCheckpoint(id);
        printSuccess(`Rolled back to checkpoint ${id}`);
      } catch (err) {
        printError(String(err));
      }
      return;
    }

    const checkpoints = listCheckpoints();
    if (checkpoints.length === 0) {
      printInfo("No checkpoints found.");
      return;
    }

    console.log(chalk.bold(`\n  Checkpoints (${checkpoints.length})`));
    console.log(chalk.dim("─".repeat(70)));
    for (const cp of checkpoints.slice(0, 20)) {
      const ts      = chalk.dim(cp.createdAt.replace("T", " ").slice(0, 19));
      const fileCount = chalk.bold(String(cp.patch.changes.length).padStart(3)) + " file(s)";
      const action  = chalk.cyan(cp.patch.agentAction ?? "manual");
      console.log(`  ${ts}  ${fileCount}  ${action}  ${chalk.dim(cp.id)}`);
    }
    console.log(chalk.dim("\n  To rollback: coai checkpoint <id> --rollback\n"));
  });

// ── coai audit ────────────────────────────────────────────────────────────────

program
  .command("audit")
  .description("View enterprise audit dashboard: sessions, commands, agent actions, security events")
  .option("--lines <n>",      "Number of recent entries to show", "50")
  .option("--filter <text>",  "Filter by action name or result")
  .option("--json",           "Output as JSON")
  .action(async (opts: { lines?: string; filter?: string; json?: boolean }) => {
    const { join }      = await import("node:path");
    const { homedir }   = await import("node:os");
    const { readFileSync, existsSync } = await import("node:fs");

    const auditFile = join(homedir(), ".coai", "audit.log");
    if (!existsSync(auditFile)) { printInfo("No audit log found yet."); return; }

    const n   = parseInt(opts.lines ?? "50", 10);
    const raw = readFileSync(auditFile, "utf8").trim().split("\n");

    type AuditRow = { ts: string; userId: string; action: string; result: string; device?: string; details?: Record<string, unknown> };
    let entries = raw
      .map((line): AuditRow | null => { try { return JSON.parse(line) as AuditRow; } catch { return null; } })
      .filter((e): e is AuditRow => e !== null);

    if (opts.filter) {
      const f = opts.filter.toLowerCase();
      entries = entries.filter((e) => e.action.toLowerCase().includes(f) || e.result.toLowerCase().includes(f));
    }

    entries = entries.slice(-n);

    if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }

    // Summary statistics
    const total    = entries.length;
    const okCount  = entries.filter((e) => e.result === "ok").length;
    const denied   = entries.filter((e) => e.result === "denied").length;
    const errors   = entries.filter((e) => e.result === "error").length;
    const actions  = [...new Set(entries.map((e) => e.action))];

    console.log(chalk.bold("\n  Enterprise Audit Dashboard"));
    console.log(chalk.dim("─".repeat(72)));
    console.log(`  Total: ${chalk.bold(String(total))}  OK: ${chalk.green(String(okCount))}  Denied: ${chalk.red(String(denied))}  Errors: ${chalk.yellow(String(errors))}`);
    console.log(`  Actions: ${chalk.dim(actions.join(", "))}`);
    console.log(chalk.dim("─".repeat(72)));

    for (const e of entries) {
      const ts     = chalk.dim(e.ts.replace("T", " ").slice(0, 19));
      const res    = e.result === "ok" ? chalk.green("ok    ") : e.result === "denied" ? chalk.red("DENIED") : chalk.yellow("ERROR ");
      const action = chalk.bold(e.action.padEnd(14));
      const device = e.device ? chalk.dim(e.device.slice(0, 8) + "…") : "        ";
      const detail = e.details ? chalk.dim(JSON.stringify(e.details).slice(0, 40)) : "";
      console.log(`  ${ts}  ${res}  ${device}  ${action}  ${detail}`);
    }

    // Security events summary
    const securityEvents = entries.filter((e) => e.result === "denied" || (e.details && JSON.stringify(e.details).includes("security")));
    if (securityEvents.length > 0) {
      console.log(chalk.red.bold(`\n  ⚠ ${securityEvents.length} security event(s) detected`));
    }
    console.log();
  });

// ── coai recover ──────────────────────────────────────────────────────────────

program
  .command("recover")
  .description("Disaster recovery: session, workspace, checkpoint recovery")
  .option("--status",            "Show recovery status")
  .option("--snapshot [label]",  "Create a workspace snapshot")
  .option("--restore <id>",      "Restore a workspace snapshot by ID")
  .option("--list-snapshots",    "List all workspace snapshots")
  .option("--clear-session",     "Clear the saved session")
  .action(async (opts: {
    status?: boolean;
    snapshot?: string | boolean;
    restore?: string;
    listSnapshots?: boolean;
    clearSession?: boolean;
  }) => {
    if (opts.clearSession) {
      clearSession();
      printSuccess("Session cleared.");
      return;
    }

    if (opts.listSnapshots) {
      const snapshots = listWorkspaceSnapshots();
      if (snapshots.length === 0) { printInfo("No workspace snapshots."); return; }
      console.log(chalk.bold(`\n  Workspace Snapshots (${snapshots.length})`));
      console.log(chalk.dim("─".repeat(60)));
      for (const ws of snapshots) {
        const ts = chalk.dim(ws.createdAt.replace("T", " ").slice(0, 19));
        console.log(`  ${ts}  ${chalk.cyan(ws.label.padEnd(25))}  ${chalk.dim(ws.id)}`);
      }
      console.log();
      return;
    }

    if (opts.restore) {
      const ok = await askYesNo(chalk.yellow(`Restore workspace snapshot ${opts.restore}? This will overwrite current files. (y/N)`), false);
      if (!ok) { printInfo("Restore cancelled."); return; }
      try {
        restoreWorkspace(opts.restore, ROOT);
        printSuccess(`Workspace restored from snapshot ${opts.restore}`);
      } catch (err) {
        printError(String(err));
      }
      return;
    }

    if (opts.snapshot !== undefined) {
      const label = typeof opts.snapshot === "string" ? opts.snapshot : `snapshot-${new Date().toISOString().slice(0, 10)}`;
      const spinner = startSpinner(`Creating workspace snapshot: ${label}…`);
      const ws = snapshotWorkspace(ROOT, label);
      spinner.succeed(`Snapshot created: ${ws.id}  (${ws.files.length} files)`);
      return;
    }

    // Default: show recovery status
    const summary = getRecoverySummary();
    printRecoverySummary(summary);
  });

// ── SANDBOX ───────────────────────────────────────────────────────────────────

program
  .command("sandbox <file>")
  .description("Run a code file in the secure Coagentix sandbox (js/ts/py)")
  .option("--language <lang>", "Override language detection (javascript|typescript|python)")
  .option("--timeout <ms>",    "Execution timeout in milliseconds (default: 10000)", "10000")
  .option("--docker",          "Use Docker container isolation (requires Docker on server)")
  .option("--input <file>",    "Attach an input file (format: remote-path:local-path)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .action(async (filePath: string, opts: {
    language?: string;
    timeout?: string;
    docker?: boolean;
    input?: string[];
  }) => {
    const api = await makeClient("sandbox");

    // Read the code file
    const { readFileSync, existsSync } = await import("node:fs");
    const { extname, basename, resolve } = await import("node:path");
    const absPath = resolve(ROOT, filePath);
    if (!existsSync(absPath)) {
      printError(`File not found: ${filePath}`);
      process.exit(1);
    }
    const code = readFileSync(absPath, "utf8");

    // Detect language from extension when not overridden
    const ext = extname(filePath).toLowerCase();
    const detectedLang = opts.language ??
      (ext === ".ts" ? "typescript" : ext === ".py" ? "python" : "javascript");

    // Attach input files
    const files: Array<{ path: string; content: string }> = [];
    for (const inputSpec of opts.input ?? []) {
      const [remotePath, localPath] = inputSpec.split(":");
      if (!remotePath || !localPath) {
        printWarning(`Invalid --input format: "${inputSpec}" (expected remote-path:local-path)`);
        continue;
      }
      const abs = resolve(ROOT, localPath);
      if (!existsSync(abs)) { printWarning(`Input file not found: ${localPath}`); continue; }
      files.push({ path: remotePath, content: readFileSync(abs, "utf8") });
    }

    const spinner = startSpinner(`Running ${basename(filePath)} in ${detectedLang} sandbox…`);

    try {
      const resp = await api.post("/v1/sandbox/run", {
        language:    detectedLang,
        code,
        timeoutMs:   Number(opts.timeout) || 10_000,
        docker:      opts.docker ?? false,
        files:       files.length > 0 ? files : undefined,
      });

      spinner.stop();

      const r = resp as {
        success: boolean;
        stdout: string;
        stderr: string;
        durationMs: number;
        timedOut: boolean;
        language: string;
        error?: string;
        docker?: boolean;
      };

      const mode = r.docker ? chalk.cyan("[Docker]") : chalk.dim("[vm]");
      const dur  = chalk.dim(`${r.durationMs} ms`);

      if (r.success) {
        printSuccess(`Sandbox completed ${mode} ${dur}`);
      } else if (r.timedOut) {
        printError(`Timed out after ${opts.timeout} ms`);
      } else {
        printError(`Execution failed: ${r.error ?? "unknown error"}`);
      }

      if (r.stdout) {
        console.log(chalk.bold("\n  stdout:"));
        console.log(r.stdout.split("\n").map((l: string) => chalk.dim("  " + l)).join("\n"));
      }
      if (r.stderr) {
        console.log(chalk.bold("\n  stderr:"));
        console.log(r.stderr.split("\n").map((l: string) => chalk.red("  " + l)).join("\n"));
      }
    } catch (err) {
      spinner.fail("Sandbox run failed");
      printError(String(err));
      process.exit(1);
    }
  });

// ── DEVELOPER KEYS ────────────────────────────────────────────────────────────

program
  .command("keys")
  .description("Manage developer API keys")
  .option("--list",               "List all developer API keys")
  .option("--create <name>",      "Create a new developer API key with the given name")
  .option("--scopes <scopes>",    "Comma-separated scopes for the new key (default: sandbox:run,usage:read)")
  .option("--revoke <id>",        "Revoke a developer API key by ID")
  .action(async (opts: {
    list?: boolean;
    create?: string;
    scopes?: string;
    revoke?: string;
  }) => {
    const api = await makeClient("keys");

    if (opts.revoke) {
      const ok = await askYesNo(chalk.yellow(`Revoke developer key ${opts.revoke}? (y/N)`), false);
      if (!ok) { printInfo("Cancelled."); return; }
      await api.delete(`/v1/developer/keys/${opts.revoke}`);
      printSuccess(`Key ${opts.revoke} revoked.`);
      return;
    }

    if (opts.create) {
      const scopes = (opts.scopes ?? "sandbox:run,usage:read").split(",").map((s: string) => s.trim());
      const result = await api.post("/v1/developer/keys", { name: opts.create, scopes }) as {
        key: { id: string; name: string; prefix: string; scopes: string[]; createdAt: string };
        rawKey: string;
      };
      printSuccess(`Developer key created: ${result.key.name}`);
      console.log();
      console.log(chalk.bold("  Key ID:  ") + chalk.dim(result.key.id));
      console.log(chalk.bold("  Scopes:  ") + result.key.scopes.join(", "));
      console.log(chalk.bold("  API Key: ") + chalk.yellow(result.rawKey));
      console.log();
      printWarning("Save this key now — it won't be shown again.");
      return;
    }

    // Default: list keys
    const data = await api.get("/v1/developer/keys") as { keys: Array<{ id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsed: string | null }> };
    if (data.keys.length === 0) {
      printInfo("No developer keys. Create one with: coai keys --create <name>");
      return;
    }
    console.log(chalk.bold(`\n  Developer API Keys (${data.keys.length})`));
    console.log(chalk.dim("─".repeat(72)));
    printTable(
      data.keys.map((k) => ({
        Name: k.name,
        ID: k.id.slice(0, 8) + "…",
        Scopes: k.scopes.join(", "),
        "Last Used": k.lastUsed ? k.lastUsed.slice(0, 10) : "never",
      })),
    );
    console.log();
  });

// ── main ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  printError(String(err));
  process.exit(1);
});
