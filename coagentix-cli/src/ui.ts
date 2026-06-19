// Terminal UI helpers: chalk, ora, streaming output renderer

import chalk from "chalk";
import ora, { type Ora } from "ora";
import type { StreamEvent } from "./api.js";

export { chalk, ora };

export const brand = chalk.hex("#F59E0B"); // Coagentix orange-gold

export function header(version: string): void {
  console.log(brand.bold("\n  Coagentix Code CLI") + chalk.dim(` v${version}`));
  console.log(chalk.dim("  AI-powered coding agent — Advanced subscribers only\n"));
}

export function startSpinner(text: string): Ora {
  return ora({ text: chalk.dim(text), color: "yellow" }).start();
}

export function renderStreamEvent(event: StreamEvent, spinner: Ora | null): void {
  switch (event.kind) {
    case "plan":
      spinner?.succeed(chalk.dim("Plan ready"));
      console.log("\n" + chalk.bold("Plan:"));
      if (typeof event.text === "string") {
        for (const line of event.text.split("\n")) {
          console.log("  " + chalk.dim(line));
        }
      }
      break;

    case "agent":
      if (spinner && typeof event.text === "string") {
        spinner.text = chalk.dim(`[${event.role ?? "agent"}] ${event.text.slice(0, 80)}`);
      }
      break;

    case "code":
      console.log("\n" + brand("◆ ") + chalk.bold("Generated code"));
      if (typeof event.text === "string") {
        const preview = event.text.split("\n").slice(0, 10).join("\n");
        console.log(chalk.dim(preview));
        if (event.text.split("\n").length > 10) console.log(chalk.dim("  …"));
      }
      break;

    case "file":
      if (typeof event.path === "string") {
        console.log(chalk.green("  + ") + chalk.bold(event.path));
      }
      break;

    case "review":
      console.log("\n" + chalk.bold("Review:"));
      if (typeof event.text === "string") {
        for (const line of event.text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("HIGH")) console.log("  " + chalk.red(trimmed));
          else if (trimmed.startsWith("MED")) console.log("  " + chalk.yellow(trimmed));
          else console.log("  " + chalk.dim(trimmed));
        }
      }
      break;

    case "summary":
      spinner?.succeed("Done");
      console.log("\n" + chalk.bold("Summary:"));
      if (typeof event.text === "string") {
        for (const line of event.text.split("\n")) {
          console.log("  " + chalk.dim(line));
        }
      }
      break;

    case "error":
      spinner?.fail(chalk.red("Error"));
      if (typeof event.text === "string") {
        console.error(chalk.red("  " + event.text));
      }
      break;

    case "token":
      // Token usage / cost telemetry — show quietly.
      if (event.totalTokens) {
        console.log(chalk.dim(`\n  Tokens: ${event.totalTokens} · Cost: $${Number(event.costUsd ?? 0).toFixed(4)}`));
      }
      break;

    default:
      if (typeof event.text === "string" && event.text.trim()) {
        if (spinner) spinner.text = chalk.dim(event.text.slice(0, 80));
      }
  }
}

export function printFiles(files: Array<{ path: string }>): void {
  console.log("\n" + chalk.bold("Files:"));
  for (const f of files) {
    console.log("  " + chalk.green("✓") + " " + chalk.bold(f.path));
  }
}

export function printTable(rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c]).length)),
  );
  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const header = cols.map((c, i) => ` ${c.padEnd(widths[i])} `).join("│");
  console.log(chalk.dim("┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐"));
  console.log(chalk.dim("│") + chalk.bold(header) + chalk.dim("│"));
  console.log(chalk.dim("├" + sep + "┤"));
  for (const row of rows) {
    const line = cols.map((c, i) => ` ${String(row[c]).padEnd(widths[i])} `).join(chalk.dim("│"));
    console.log(chalk.dim("│") + line + chalk.dim("│"));
  }
  console.log(chalk.dim("└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘"));
}
