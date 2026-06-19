#!/usr/bin/env node
// Coagentix Code CLI entry point
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve dist/cli.js (built) or fall back to src/cli.ts (dev via tsx)
const distPath = join(__dirname, "..", "dist", "cli.js");
const srcPath  = join(__dirname, "..", "src", "cli.ts");

if (existsSync(distPath)) {
  await import(pathToFileURL(distPath).href);
} else if (existsSync(srcPath)) {
  // Development: use tsx if available
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [
    "--import", "tsx",
    srcPath,
    ...process.argv.slice(2),
  ], { stdio: "inherit" });
} else {
  console.error("coai: cannot find dist/cli.js — run `npm run build` first");
  process.exit(1);
}
