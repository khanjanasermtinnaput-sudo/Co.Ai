// Safety layer: preview changes and require user confirmation before applying

import chalk from "chalk";
import { createInterface } from "node:readline";
import type { FileChange } from "./files.js";

function label(op: FileChange["op"]): string {
  switch (op) {
    case "create": return chalk.green("CREATE");
    case "edit":   return chalk.yellow("EDIT");
    case "delete": return chalk.red("DELETE");
    case "rename": return chalk.blue("RENAME");
    case "move":   return chalk.blue("MOVE");
  }
}

function renderDiff(change: FileChange): void {
  if (change.op === "create" && change.content) {
    const lines = change.content.split("\n").slice(0, 20);
    console.log(chalk.dim("  preview (first 20 lines):"));
    for (const line of lines) {
      console.log(chalk.green("  + ") + chalk.dim(line));
    }
    if (change.content.split("\n").length > 20) {
      console.log(chalk.dim("  … (truncated)"));
    }
  } else if (change.op === "edit" && change.oldContent && change.content) {
    const oldLines = change.oldContent.split("\n");
    const newLines = change.content.split("\n");
    let shown = 0;
    for (let i = 0; i < Math.max(oldLines.length, newLines.length) && shown < 30; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o !== n) {
        if (o !== undefined) console.log(chalk.red("  - ") + chalk.dim(o));
        if (n !== undefined) console.log(chalk.green("  + ") + chalk.dim(n));
        shown++;
      }
    }
    if (shown === 0) console.log(chalk.dim("  (binary or identical content)"));
  }
}

export async function previewAndConfirm(
  changes: FileChange[],
  options: { silent?: boolean } = {},
): Promise<boolean> {
  if (changes.length === 0) {
    console.log(chalk.dim("No changes to apply."));
    return false;
  }

  console.log("\n" + chalk.bold("Proposed changes:"));
  console.log(chalk.dim("─".repeat(60)));

  for (const change of changes) {
    const suffix = change.newPath ? ` → ${chalk.bold(change.newPath)}` : "";
    console.log(`  ${label(change.op)}  ${chalk.bold(change.path)}${suffix}`);
    if (!options.silent) renderDiff(change);
  }

  console.log(chalk.dim("─".repeat(60)));
  console.log(
    `\n${chalk.bold(changes.length)} file(s) will be modified. ` +
    chalk.dim("A backup snapshot will be created before applying.\n"),
  );

  return askYesNo("Apply these changes? (Y/n)");
}

export function askYesNo(prompt: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.cyan(prompt) + " ", (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "") resolve(defaultYes);
      else resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

export function printSuccess(msg: string): void {
  console.log("\n" + chalk.green("✓ ") + msg);
}

export function printError(msg: string): void {
  console.error("\n" + chalk.red("✗ ") + msg);
}

export function printInfo(msg: string): void {
  console.log(chalk.cyan("→ ") + msg);
}

export function printWarning(msg: string): void {
  console.log(chalk.yellow("⚠ ") + msg);
}
