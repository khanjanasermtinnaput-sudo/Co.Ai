#!/usr/bin/env node
// Coagentix Code CLI — main entry point

import { Command, Option } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { cwd } from "node:process";
import { hostname } from "node:os";

import { loadConfig, saveConfig, clearConfig, requireLogin, defaultApiBase, isLoggedIn } from "./auth.js";
import { CoaiApiClient } from "./api.js";
import { scanRepository, buildRepoContext } from "./repo.js";
import { parseCodeBlocks, createSnapshot, applyChanges, fileExists } from "./files.js";
import { getGit, isGitRepo, getCurrentBranch, createBranch, stageAll, commit as gitCommit, push, pull, getLog } from "./git.js";
import { previewAndConfirm, printSuccess, printError, printInfo, printWarning, askYesNo } from "./safety.js";
import { startInteractiveSession } from "./interactive.js";
import { renderStreamEvent, startSpinner, brand, header, printTable } from "./ui.js";
import { execCommand, parseCommand } from "./terminal.js";
import type { FileChange } from "./files.js";

const VERSION = "1.0.0";
const ROOT    = cwd();

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient(): CoaiApiClient {
  const cfg = requireLogin();
  return new CoaiApiClient(cfg);
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

async function applyWithConfirm(changes: FileChange[], summary: string): Promise<void> {
  if (changes.length === 0) {
    console.log(chalk.dim("\nNo file changes proposed."));
    if (summary) {
      console.log(chalk.bold("\nResponse:"));
      console.log(chalk.dim(summary));
    }
    return;
  }

  const confirmed = await previewAndConfirm(changes);
  if (!confirmed) { printInfo("Discarded."); return; }

  const sid = createSnapshot(ROOT, changes);
  applyChanges(ROOT, changes);
  printSuccess(`${changes.length} file(s) applied. Snapshot: ${sid}`);

  if (summary) {
    console.log(chalk.bold("\nGit summary:"));
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

    const api = makeClient();

    if (!task) {
      // Interactive REPL mode
      await startInteractiveSession(api, ROOT, { titan: opts?.titan, model: opts?.model });
      return;
    }

    // Single prompt mode
    const repoInfo = await scanRepository(ROOT);
    const context  = await buildRepoContext(ROOT, repoInfo, 30_000);

    const { changes, summary } = await streamToChanges(
      api,
      opts?.titan ? "/v1/titan" : "/v1/run",
      {
        task,
        context,
        mode: opts?.titan ? "titan" : "pro",
        model: opts?.model,
        repoInfo: { framework: repoInfo.framework, language: repoInfo.language },
      },
      `[${opts?.titan ? "titan" : "tmap"}] ${task.slice(0, 60)}…`,
    );

    await applyWithConfirm(changes, summary);
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
      saveConfig({ jwt: result.jwt, userId: result.userId, email: result.email, tier: result.tier, apiBase, savedAt: new Date().toISOString() });
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
    const api = makeClient();
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
    const api = makeClient();
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
    const api = makeClient();

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
    const api = makeClient();
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
    const api = makeClient();
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
      const api = makeClient();
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

// ── main ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  printError(String(err));
  process.exit(1);
});
