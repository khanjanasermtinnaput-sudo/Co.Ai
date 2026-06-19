// Documentation Intelligence: auto-maintain README, arch docs, API docs, changelog

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { CoaiApiClient } from "./api.js";
import type { KnowledgeGraph } from "./knowledge-graph.js";
import type { ArchReport } from "./arch-detector.js";
import type { FileChange } from "./files.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type DocType = "readme" | "architecture" | "api" | "changelog" | "migration";

export interface DocUpdateRequest {
  type: DocType;
  changes?: FileChange[];     // what triggered this update
  prompt?: string;            // the user's original task description
  graph?: KnowledgeGraph;
  arch?: ArchReport;
}

// ── Doc Prompts ────────────────────────────────────────────────────────────────

function buildDocPrompt(type: DocType, req: DocUpdateRequest, context: string): string {
  const today = new Date().toISOString().slice(0, 10);

  switch (type) {
    case "readme":
      return [
        "Generate/update a professional README.md for this project.",
        "",
        "Include:",
        "- Project name and description",
        "- Features",
        "- Prerequisites and installation",
        "- Usage / quick start",
        "- Environment variables",
        "- Deployment",
        "- Contributing guide",
        "- License",
        "",
        req.arch ? `Architecture: ${req.arch.type} (${req.arch.framework})` : "",
        "",
        "Context:",
        context.slice(0, 15_000),
      ].join("\n");

    case "architecture":
      return [
        "Write a detailed ARCHITECTURE.md for this project.",
        "",
        "Include:",
        "- System overview diagram (text-based)",
        "- Technology stack and why each was chosen",
        "- Key modules and their responsibilities",
        "- Data flow",
        "- API surface",
        "- Database schema overview",
        "- Deployment topology",
        "- Security model",
        "- Known trade-offs and decisions",
        "",
        req.graph ? `API Routes: ${req.graph.apiRoutes.slice(0, 10).join(", ")}` : "",
        "",
        "Context:",
        context.slice(0, 15_000),
      ].join("\n");

    case "api":
      return [
        "Generate API.md documenting all API endpoints in this codebase.",
        "",
        "For each endpoint include:",
        "- Method and path",
        "- Description",
        "- Request body/params",
        "- Response format",
        "- Authentication requirements",
        "- Error codes",
        "",
        req.graph ? `Detected routes:\n${req.graph.apiRoutes.join("\n")}` : "",
        "",
        "Context:",
        context.slice(0, 15_000),
      ].join("\n");

    case "changelog":
      return [
        `Add a CHANGELOG.md entry for today (${today}).`,
        "",
        "Based on these changes:",
        (req.changes ?? []).map((c) => `- ${c.op}: ${c.path}`).join("\n"),
        "",
        req.prompt ? `Triggered by: ${req.prompt}` : "",
        "",
        "Use Keep a Changelog format. Group by: Added / Changed / Fixed / Removed.",
        "If CHANGELOG.md already exists, prepend the new entry.",
        "",
        "Existing CHANGELOG.md:",
        readExistingDoc("CHANGELOG.md") ?? "(none)",
      ].join("\n");

    case "migration":
      return [
        `Write a migration guide for the changes made on ${today}.`,
        "",
        "Changes:",
        (req.changes ?? []).map((c) => `- ${c.op}: ${c.path}`).join("\n"),
        "",
        req.prompt ? `Task: ${req.prompt}` : "",
        "",
        "Include:",
        "- What changed and why",
        "- Steps to migrate",
        "- Breaking changes",
        "- Rollback procedure",
      ].join("\n");
  }
}

function readExistingDoc(filename: string): string | null {
  try {
    return existsSync(filename) ? readFileSync(filename, "utf8").slice(0, 5000) : null;
  } catch { return null; }
}

// ── Generate Docs ──────────────────────────────────────────────────────────────

export async function generateDoc(
  api: CoaiApiClient,
  root: string,
  req: DocUpdateRequest,
  context: string,
): Promise<string> {
  const prompt = buildDocPrompt(req.type, req, context);
  let content = "";

  for await (const event of api.stream("/v1/chat", { message: prompt, history: [], context: "" })) {
    if (event.kind === "chunk" && typeof event.text === "string") content += event.text;
    if (event.kind === "done"  && typeof event.text === "string") content  = event.text;
  }

  return content.trim();
}

// ── Doc File Name Map ──────────────────────────────────────────────────────────

const DOC_FILES: Record<DocType, string> = {
  readme:       "README.md",
  architecture: "ARCHITECTURE.md",
  api:          "API.md",
  changelog:    "CHANGELOG.md",
  migration:    "MIGRATION.md",
};

export function getDocPath(root: string, type: DocType): string {
  return join(root, DOC_FILES[type]);
}

// ── Auto-update Docs After Code Changes ───────────────────────────────────────

export async function autoUpdateDocs(
  api: CoaiApiClient,
  root: string,
  changes: FileChange[],
  context: string,
  prompt: string,
): Promise<FileChange[]> {
  const docChanges: FileChange[] = [];

  // Always update changelog when code changes
  const changelogContent = await generateDoc(api, root, { type: "changelog", changes, prompt }, context);
  if (changelogContent) {
    const path = "CHANGELOG.md";
    docChanges.push({
      op: existsSync(join(root, path)) ? "edit" : "create",
      path,
      content: changelogContent,
    });
  }

  return docChanges;
}

// ── Print ─────────────────────────────────────────────────────────────────────

export function printDocTypes(): void {
  console.log(chalk.bold("\n  Documentation Types"));
  console.log(chalk.dim("─".repeat(40)));
  for (const [type, file] of Object.entries(DOC_FILES)) {
    console.log(`  ${chalk.cyan(type.padEnd(14))} → ${chalk.dim(file)}`);
  }
  console.log();
}
