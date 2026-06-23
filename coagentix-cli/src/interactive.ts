// Interactive REPL: the `coai` default mode — a live coding session in the terminal

import { createInterface } from "node:readline";
import chalk from "chalk";
import { CoaiApiClient } from "./api.js";
import { scanRepository, buildRepoContext, type RepoInfo } from "./repo.js";
import { parseCodeBlocks, createSnapshot, applyChanges, readFileContent, fileExists } from "./files.js";
import { previewAndConfirm, printSuccess, printError, printInfo, printWarning, askYesNo } from "./safety.js";
import { getGit, isGitRepo, stageAll, commit, getCurrentBranch } from "./git.js";
import { startSpinner, renderStreamEvent, brand } from "./ui.js";
import { execCommand, parseCommand } from "./terminal.js";
import type { FileChange } from "./files.js";

export async function startInteractiveSession(
  api: CoaiApiClient,
  root: string,
  options: { titan?: boolean; model?: string } = {},
): Promise<void> {
  console.log(brand.bold("\n  CoCode CLI — Interactive Mode"));
  console.log(chalk.dim('  Type your task, or /help for commands. Ctrl+C to exit.\n'));

  const spinner = startSpinner("Scanning repository…");
  let repoInfo: RepoInfo;
  try {
    repoInfo = await scanRepository(root);
    spinner.succeed(
      chalk.dim(`Repo: ${repoInfo.framework} · ${repoInfo.language} · ${repoInfo.fileCount} files`),
    );
  } catch {
    spinner.fail("Failed to scan repository");
    repoInfo = { root, framework: "Unknown", language: "Unknown", packageManager: "unknown", buildSystem: "unknown", languages: [], files: [], fileCount: 0, totalLines: 0 };
  }

  const git = (await isGitRepo(root)) ? getGit(root) : null;
  const branch = git ? await getCurrentBranch(git) : null;
  if (branch) printInfo(`Branch: ${branch}`);

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const prompt = () => {
    process.stdout.write(brand("coai") + chalk.dim(" › "));
  };

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { prompt(); return; }

    // Built-in slash commands
    if (input.startsWith("/")) {
      await handleSlashCommand(input, root, repoInfo, git, api, history);
      prompt();
      return;
    }

    // Run the task through the TMAP pipeline
    rl.pause();
    try {
      await runTask(input, root, repoInfo, api, history, options);
    } catch (err) {
      printError(String(err));
    }
    rl.resume();
    prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\n  Session ended. Goodbye!\n"));
    process.exit(0);
  });

  prompt();
}

async function handleSlashCommand(
  input: string,
  root: string,
  repoInfo: RepoInfo,
  git: ReturnType<typeof getGit> | null,
  api: CoaiApiClient,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  const [cmd, ...rest] = input.slice(1).split(" ");
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "help":
      printHelp();
      break;

    case "status": {
      const s = await api.getStatus().catch(() => null);
      if (s) {
        console.log(chalk.bold("\n  Account:") + chalk.dim(` ${s.username}`));
        console.log(chalk.bold("  Providers:") + chalk.dim(` ${s.providers.join(", ") || "none"}`));
      }
      console.log(chalk.bold("  Repo:") + chalk.dim(` ${repoInfo.framework} · ${repoInfo.fileCount} files`));
      break;
    }

    case "commit": {
      if (!git) { printWarning("Not a git repository"); break; }
      const contextStr = await buildRepoContext(root, repoInfo, 20_000);
      const spinner = startSpinner("Generating commit message…");
      let msg = "";
      try {
        for await (const e of api.stream("/v1/chat", {
          message: `Generate a concise, conventional commit message for the following staged diff:\n\n${contextStr.slice(0, 4000)}`,
          history: [],
        })) {
          if (e.kind === "chunk" && typeof e.text === "string") msg += e.text;
          if (e.kind === "done" && typeof e.text === "string") msg = e.text;
        }
        spinner.succeed("Commit message ready");
      } catch {
        spinner.fail("Could not generate commit message");
        break;
      }
      msg = msg.trim() || (arg || "chore: update codebase");
      console.log(chalk.dim(`\n  "${msg}"`));
      const ok = await askYesNo("Use this commit message? (Y/n)");
      if (ok) {
        await stageAll(git);
        const hash = await commit(git, msg);
        printSuccess(`Committed ${hash.slice(0, 7)}: ${msg}`);
      }
      break;
    }

    case "run": {
      if (!arg) { printWarning("Usage: /run <command>"); break; }
      const [cmd2, args2] = parseCommand(arg);
      const result = execCommand(cmd2, args2, root);
      if (result.success) {
        console.log(chalk.green("\n" + result.stdout));
      } else {
        console.error(chalk.red("\n" + result.stderr));
      }
      break;
    }

    case "clear":
      history.length = 0;
      console.log(chalk.dim("  Conversation history cleared."));
      break;

    case "files": {
      const showing = repoInfo.files.slice(0, 30);
      for (const f of showing) console.log(chalk.dim("  " + f));
      if (repoInfo.files.length > 30) console.log(chalk.dim(`  … and ${repoInfo.files.length - 30} more`));
      break;
    }

    case "read": {
      if (!arg) { printWarning("Usage: /read <file>"); break; }
      try {
        const content = readFileContent(root, arg);
        console.log(chalk.dim(`\n--- ${arg} ---\n`) + content);
      } catch {
        printError(`Cannot read: ${arg}`);
      }
      break;
    }

    default:
      printWarning(`Unknown command: /${cmd}. Type /help for available commands.`);
  }
}

async function runTask(
  task: string,
  root: string,
  repoInfo: RepoInfo,
  api: CoaiApiClient,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  options: { titan?: boolean; model?: string },
): Promise<void> {
  const contextStr = await buildRepoContext(root, repoInfo, 30_000);
  const spinner = startSpinner(`[${options.titan ? "titan" : "tmap"}] Processing…`);

  const allChanges: FileChange[] = [];
  let summary = "";

  const endpoint = options.titan ? "/v1/titan" : "/v1/run";
  const body = {
    task,
    context: contextStr,
    mode: options.titan ? "titan" : "pro",
    model: options.model,
    history: history.slice(-10),
    repoInfo: {
      framework: repoInfo.framework,
      language:  repoInfo.language,
      packageManager: repoInfo.packageManager,
    },
  };

  try {
    for await (const event of api.stream(endpoint, body)) {
      renderStreamEvent(event, spinner);

      if (event.kind === "code" && typeof event.text === "string") {
        const parsed = parseCodeBlocks(event.text, root);
        allChanges.push(...parsed);
      }

      if (event.kind === "files" && Array.isArray(event.files)) {
        for (const f of event.files as Array<{ path: string; content: string }>) {
          const op = fileExists(root, f.path) ? "edit" : "create";
          allChanges.push({ op, path: f.path, content: f.content });
        }
      }

      if (event.kind === "summary" && typeof event.text === "string") {
        summary = event.text;
      }
    }
    spinner.stop();
  } catch (err) {
    spinner.fail("Pipeline error");
    throw err;
  }

  history.push({ role: "user", content: task });
  if (summary) history.push({ role: "assistant", content: summary });

  if (allChanges.length === 0) {
    console.log(chalk.dim("\n  No file changes proposed."));
    if (summary) {
      console.log(chalk.bold("\n  Response:"));
      for (const line of summary.split("\n")) console.log("  " + chalk.dim(line));
    }
    return;
  }

  const confirmed = await previewAndConfirm(allChanges);
  if (!confirmed) {
    printInfo("Changes discarded.");
    return;
  }

  const snapshotId = createSnapshot(root, allChanges);
  applyChanges(root, allChanges);
  printSuccess(`Applied ${allChanges.length} change(s). Snapshot: ${snapshotId}`);

  if (summary) {
    console.log(chalk.bold("\n  Git summary:"));
    for (const line of summary.split("\n")) console.log("  " + chalk.dim(line));
  }
}

function printHelp(): void {
  const cmds = [
    ["<task>",       "Run a coding task (edit, create, refactor)"],
    ["/status",      "Show account and repo info"],
    ["/commit [msg]","Generate commit message and commit"],
    ["/run <cmd>",   "Execute a safe terminal command"],
    ["/read <file>", "Print a file's contents"],
    ["/files",       "List repo files"],
    ["/clear",       "Clear conversation history"],
    ["/help",        "Show this help"],
  ];
  console.log("\n" + chalk.bold("  Commands:"));
  for (const [cmd, desc] of cmds) {
    console.log("  " + brand(cmd.padEnd(20)) + chalk.dim(desc));
  }
  console.log();
}
