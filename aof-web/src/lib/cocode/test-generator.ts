// ── AI Test Generator (Phase 41) ─────────────────────────────────────────────
// Analyzes source files and builds prompts for generating test suites.
// Supports Jest, Vitest, and Playwright frameworks.

export type TestFramework = "jest" | "vitest" | "playwright";
export type TestType = "unit" | "integration" | "e2e";

export interface TestGenOptions {
  framework: TestFramework;
  type: TestType;
  filePath: string;
  fileContent: string;
}

export interface ExtractedExport {
  name: string;
  kind: "function" | "class" | "component" | "hook" | "const";
  isDefault: boolean;
  params: string[];
}

// ── Static export analysis ────────────────────────────────────────────────────

export function extractExports(content: string, filePath: string): ExtractedExport[] {
  const exports: ExtractedExport[] = [];
  const isReact = filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ||
    content.includes("import React") || content.includes("from 'react'") || content.includes('from "react"');

  // Named function exports
  const fnExport = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  fnExport.lastIndex = 0;
  while ((m = fnExport.exec(content)) !== null) {
    const name = m[1];
    const rawParams = m[2].split(",").map((p) => p.trim().split(/[=:]/)[0].trim()).filter(Boolean);
    const isComponent = isReact && /^[A-Z]/.test(name);
    const isHook = name.startsWith("use");
    exports.push({
      name,
      kind: isComponent ? "component" : isHook ? "hook" : "function",
      isDefault: false,
      params: rawParams,
    });
  }

  // Arrow function exports
  const arrowExport = /export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;
  arrowExport.lastIndex = 0;
  while ((m = arrowExport.exec(content)) !== null) {
    const name = m[1];
    const rawParams = m[2].split(",").map((p) => p.trim().split(/[=:]/)[0].trim()).filter(Boolean);
    const isHook = name.startsWith("use");
    exports.push({
      name,
      kind: isHook ? "hook" : "function",
      isDefault: false,
      params: rawParams,
    });
  }

  // Class exports
  const classExport = /export\s+class\s+(\w+)/g;
  classExport.lastIndex = 0;
  while ((m = classExport.exec(content)) !== null) {
    exports.push({ name: m[1], kind: "class", isDefault: false, params: [] });
  }

  // Default export
  const defaultFn = /export\s+default\s+(?:async\s+)?function\s+(\w+)?/;
  const defaultMatch = defaultFn.exec(content);
  if (defaultMatch?.[1]) {
    exports.push({ name: defaultMatch[1], kind: "function", isDefault: true, params: [] });
  }

  return exports;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildTestPrompt(opts: TestGenOptions, exports: ExtractedExport[]): string {
  const { framework, type, filePath, fileContent } = opts;

  const frameworkImport: Record<TestFramework, string> = {
    jest: 'import { jest } from "@jest/globals";',
    vitest: 'import { describe, it, expect, vi, beforeEach } from "vitest";',
    playwright: 'import { test, expect } from "@playwright/test";',
  };

  const exportSummary = exports.length > 0
    ? exports.map((e) => `- ${e.kind} \`${e.name}\`${e.params.length ? ` (${e.params.join(", ")})` : ""}`).join("\n")
    : "- No named exports detected (check file structure)";

  const typeInstructions: Record<TestType, string> = {
    unit: "Write unit tests for each exported function/class/component. Mock all external dependencies. Test happy paths and edge cases.",
    integration: "Write integration tests that test multiple units working together. Use real implementations where possible, mock only external services.",
    e2e: "Write Playwright end-to-end tests that simulate real user interactions in a browser.",
  };

  return `You are an expert test engineer. Generate a complete ${type} test file for the following source file.

Framework: ${framework}
Framework import: ${frameworkImport[framework]}
File: ${filePath}

Exported symbols found:
${exportSummary}

Instructions:
${typeInstructions[type]}
- Use descriptive test names that explain what is being tested.
- Include at least 2 test cases per export.
- Output ONLY the test file content, no explanations.
- Start with the import statements.

Source file (first 2000 chars):
\`\`\`
${fileContent.slice(0, 2000)}
\`\`\``;
}

export function testFilePath(sourcePath: string, framework: TestFramework, type: TestType): string {
  const ext = sourcePath.match(/\.(tsx?|jsx?)$/)?.[1] ?? "ts";
  const base = sourcePath.replace(/\.[^.]+$/, "");
  if (type === "e2e") return `e2e/${base.split("/").pop()}.spec.${ext}`;
  return `${base}.${type === "unit" ? "test" : "integration"}.${ext}`;
}
