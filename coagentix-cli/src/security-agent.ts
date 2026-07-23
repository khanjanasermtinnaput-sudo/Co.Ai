// Security Review Agent: secrets, auth/authz, injection, unsafe file/command access, deps

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { CoaiApiClient } from "./api.js";
import type { FileChange } from "./files.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface SecurityFinding {
  severity: Severity;
  category: string;
  file?: string;
  line?: number;
  description: string;
  recommendation: string;
}

export interface SecurityReport {
  passed: boolean;  // no critical/high findings
  score: number;    // 0–100 (higher = safer)
  findings: SecurityFinding[];
  checkedAt: string;
}

// ── Static Checks (local, no AI needed) ───────────────────────────────────────

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:password|passwd|pwd)\s*=\s*["'][^"']{4,}/gi,     label: "Hardcoded password" },
  { pattern: /(?:api[_-]?key|apikey)\s*=\s*["'][^"']{8,}/gi,      label: "Hardcoded API key" },
  { pattern: /(?:secret|token)\s*=\s*["'][^"']{8,}/gi,            label: "Hardcoded secret/token" },
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,          label: "Private key in source" },
  { pattern: /AKIA[0-9A-Z]{16}/g,                                   label: "AWS Access Key ID" },
  { pattern: /sk-[a-zA-Z0-9]{32,}/g,                               label: "Possible OpenAI key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g,                               label: "GitHub Personal Access Token" },
];

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string; severity: Severity }> = [
  { pattern: /exec\s*\(\s*(?:req|request|body|params|query|user)/g, label: "Command injection via user input", severity: "critical" },
  { pattern: /eval\s*\(/g,                                           label: "eval() usage",                   severity: "high" },
  { pattern: /\.innerHTML\s*=/g,                                     label: "innerHTML XSS risk",             severity: "high" },
  { pattern: /dangerouslySetInnerHTML/g,                             label: "React dangerouslySetInnerHTML",  severity: "medium" },
  { pattern: /document\.write\s*\(/g,                                label: "document.write XSS risk",       severity: "high" },
  { pattern: /\.query\s*\(\s*`[^`]*\$\{/g,                          label: "SQL injection via template literal", severity: "critical" },
  { pattern: /child_process.*exec.*\$\{/g,                           label: "Shell injection via template",  severity: "critical" },
];

const UNSAFE_ACCESS: Array<{ pattern: RegExp; label: string; severity: Severity }> = [
  { pattern: /readFileSync\s*\(\s*(?:req|request|body|params|query)/g, label: "Unsafe file read from user input", severity: "high" },
  { pattern: /path\.join.*(?:req|request|body|params|query)/g,          label: "Path traversal risk",           severity: "high" },
  { pattern: /process\.env\.[A-Z_]+\b(?!\s*\?\?)/g,                    label: "Unguarded env var access",      severity: "low" },
];

function scanFileStatic(filePath: string, content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split("\n");

  // Skip test files and lock files for most checks
  const isTest = /\.test\.|\.spec\.|__tests__/.test(filePath);

  for (const { pattern, label } of SECRET_PATTERNS) {
    const matches = content.matchAll(new RegExp(pattern.source, pattern.flags));
    for (const m of matches) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      const lineContent = lines[lineNum - 1] ?? "";
      // Skip if it looks like an env var reference (not a literal value)
      if (lineContent.includes("process.env") || lineContent.includes("${")) continue;
      findings.push({
        severity: "critical",
        category: "Secrets Exposure",
        file: filePath,
        line: lineNum,
        description: `${label} detected`,
        recommendation: "Move to environment variable. Never commit secrets.",
      });
    }
  }

  if (!isTest) {
    for (const { pattern, label, severity } of INJECTION_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(content)) {
        findings.push({
          severity,
          category: "Injection",
          file: filePath,
          description: label,
          recommendation: "Sanitize and validate all user-controlled input before use.",
        });
      }
    }

    for (const { pattern, label, severity } of UNSAFE_ACCESS) {
      if (new RegExp(pattern.source, pattern.flags).test(content)) {
        findings.push({
          severity,
          category: "Unsafe Access",
          file: filePath,
          description: label,
          recommendation: "Validate and sanitize input before using in file/system operations.",
        });
      }
    }
  }

  return findings;
}

// ── Dependency Check ──────────────────────────────────────────────────────────

function checkDependencies(root: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return findings;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.entries(pkg.dependencies ?? {});

    // Flag wildcard versions
    for (const [name, version] of deps) {
      if (version === "*" || version === "latest") {
        findings.push({
          severity: "medium",
          category: "Dependency",
          description: `${name}: version pinned to "${version}" — unpredictable`,
          recommendation: `Pin to a specific version range like "^x.y.z".`,
        });
      }
    }
  } catch { /* ignore */ }

  return findings;
}

// ── Pre-apply Security Gate ────────────────────────────────────────────────────

export function securityGateCheck(root: string, changes: FileChange[]): SecurityReport {
  const findings: SecurityFinding[] = [];

  for (const change of changes) {
    if (!change.content) continue;
    findings.push(...scanFileStatic(change.path, change.content));
  }

  findings.push(...checkDependencies(root));

  const critical = findings.filter((f) => f.severity === "critical").length;
  const high     = findings.filter((f) => f.severity === "high").length;
  const score    = Math.max(0, 100 - critical * 30 - high * 15 - findings.length * 2);

  return {
    passed: critical === 0 && high === 0,
    score,
    findings,
    checkedAt: new Date().toISOString(),
  };
}

// ── Full Repository AI Security Review ────────────────────────────────────────

export async function aiSecurityReview(
  api: CoaiApiClient,
  context: string,
): Promise<string> {
  const prompt = [
    "Perform a comprehensive security review of this codebase.",
    "",
    "Check for:",
    "1. Secrets or credentials exposed in code",
    "2. Authentication flaws (missing checks, bypasses)",
    "3. Authorization flaws (privilege escalation, missing RBAC)",
    "4. Injection risks (SQL, command, XSS, path traversal)",
    "5. Insecure dependencies",
    "6. Unsafe file system access",
    "7. Unsafe command execution",
    "8. Insecure direct object references",
    "9. Missing rate limiting",
    "10. Cryptographic weaknesses",
    "",
    "For each finding: severity (Critical/High/Medium/Low), location, description, fix.",
    "End with an overall security score (0-100) and top 3 priority fixes.",
  ].join("\n");

  let report = "";
  for await (const event of api.stream("/v1/analyze", { brief: prompt, context, mode: "pro" })) {
    if (event.kind === "chunk"   && typeof event.text === "string") report += event.text;
    if (event.kind === "summary" && typeof event.text === "string") report  = event.text;
    if (event.kind === "done"    && typeof event.text === "string") report  = event.text;
  }
  return report;
}

// ── Print ─────────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  critical: chalk.bgRed.white,
  high:     chalk.red,
  medium:   chalk.yellow,
  low:      chalk.cyan,
  info:     chalk.dim,
};

export function printSecurityReport(report: SecurityReport): void {
  const scoreColor = report.score >= 80 ? chalk.green : report.score >= 50 ? chalk.yellow : chalk.red;

  console.log(chalk.bold("\n  Security Report"));
  console.log(chalk.dim("─".repeat(60)));
  console.log(`  Score: ${scoreColor(String(report.score) + "/100")}  |  Findings: ${report.findings.length}`);

  if (report.findings.length === 0) {
    console.log(chalk.green("\n  No static security issues found."));
  } else {
    console.log();
    for (const f of report.findings) {
      const sev  = SEVERITY_COLOR[f.severity](`[${f.severity.toUpperCase()}]`.padEnd(12));
      const loc  = f.file ? chalk.dim(` ${f.file}${f.line ? `:${f.line}` : ""}`) : "";
      console.log(`  ${sev} ${f.category}${loc}`);
      console.log(`  ${chalk.dim("→")} ${f.description}`);
      console.log(`  ${chalk.dim("✓")} ${chalk.dim(f.recommendation)}`);
      console.log();
    }
  }

  if (!report.passed) {
    console.log(chalk.red.bold("  ✗ Security gate FAILED — critical/high findings must be resolved before applying.\n"));
  } else {
    console.log(chalk.green("  ✓ Security gate passed.\n"));
  }
}
