// report.ts — emits scorecard.json / scorecard.md / scorecard.html for one run,
// plus a console summary. HTML palette matches qa-loop/phases/phase10-report.ts
// (same dark theme) so the two tools read as one system.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ComponentResult, RunResult } from "./types.ts";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtPct(n: number | null): string {
  return n === null ? "n/a" : `${n.toFixed(1)}%`;
}

function fmtScore(n: number): string {
  return n.toFixed(2);
}

function statusOf(c: ComponentResult): "ok" | "warn" | "bad" {
  if (c.notImplemented) return "bad";
  if (c.fail > 0 || c.crashedFiles.length > 0) return "bad";
  if (c.missingCategories.length > 0 || (c.coveragePct ?? 0) < 70) return "warn";
  return "ok";
}

export function printConsole(run: RunResult): void {
  const bar = "=".repeat(70);
  console.log(`\n${bar}`);
  console.log(`  CO.AI VALIDATION SCORECARD`);
  console.log(bar);
  console.log(
    `  Overall score: ${fmtScore(run.overallScore)}/10  |  Overall coverage: ${fmtPct(run.overallCoveragePct)}  |  ` +
      `Critical failures: ${run.criticalFailures}`,
  );
  console.log(`  Target: score >= ${run.targetScore}, coverage >= ${run.targetCoverage}%  →  ${run.thresholdsMet ? "MET" : "NOT MET"}`);
  console.log(`  Duration: ${(run.durationMs / 1000).toFixed(1)}s`);
  console.log(bar);
  for (const c of run.components) {
    const icon = c.meta ? "•" : statusOf(c) === "ok" ? "✓" : statusOf(c) === "warn" ? "~" : "✗";
    const label = c.meta ? `${c.name} (overall)` : c.name;
    const detail = c.notImplemented
      ? "NOT IMPLEMENTED"
      : `${fmtScore(c.score)}/10  cov=${fmtPct(c.coveragePct)}  pass=${c.pass} fail=${c.fail}` +
        (c.crashedFiles.length ? ` crashed=${c.crashedFiles.length}` : "") +
        (c.missingCategories.length ? `  missing:[${c.missingCategories.join(",")}]` : "");
    console.log(`  ${icon} ${label.padEnd(38)} ${detail}`);
  }
  console.log(bar + "\n");
}

function renderMarkdown(run: RunResult): string {
  const lines: string[] = [];
  lines.push(`# Co.AI Validation Scorecard`);
  lines.push("");
  lines.push(`Run started: ${run.startedAt} — duration ${(run.durationMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push(
    `**Overall score: ${fmtScore(run.overallScore)}/10** | **Overall coverage: ${fmtPct(run.overallCoveragePct)}** | ` +
      `**Critical failures: ${run.criticalFailures}** | Thresholds (score>=${run.targetScore}, coverage>=${run.targetCoverage}%): ` +
      `**${run.thresholdsMet ? "MET" : "NOT MET"}**`,
  );
  lines.push("");
  lines.push(`| Component | Score | Coverage | Pass | Fail | Crashed | Missing categories | Note |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const c of run.components) {
    const name = c.meta ? `**${c.name}**` : c.name;
    lines.push(
      `| ${name} | ${c.notImplemented ? "0 (n/a)" : fmtScore(c.score)} | ${fmtPct(c.coveragePct)} | ${c.pass} | ${c.fail} | ` +
        `${c.crashedFiles.length} | ${c.missingCategories.join(", ") || "—"} | ${c.notImplemented ? "**NOT IMPLEMENTED**" : c.note ?? ""} |`,
    );
  }
  lines.push("");
  const withFailures = run.components.filter((c) => !c.meta && (c.fail > 0 || c.crashedFiles.length > 0));
  if (withFailures.length) {
    lines.push(`## Failures`);
    lines.push("");
    for (const c of withFailures) {
      lines.push(`### ${c.name}`);
      for (const f of c.failedTests) lines.push(`- FAIL: ${f}`);
      for (const cr of c.crashedFiles) lines.push(`- CRASHED: ${cr}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function renderHtml(run: RunResult): string {
  const statusColor = run.thresholdsMet ? "#22c55e" : "#f59e0b";
  const statusText = run.thresholdsMet ? "THRESHOLDS MET" : "IN PROGRESS";

  const rows = run.components
    .map((c) => {
      const st = c.meta ? "meta" : statusOf(c);
      const rowClass = st === "ok" ? "pass" : st === "warn" ? "warn" : "fail";
      const icon = c.meta ? "•" : st === "ok" ? "✓" : st === "warn" ? "~" : "✗";
      return `
      <tr class="${rowClass}">
        <td>${icon}</td>
        <td>${escHtml(c.name)}${c.meta ? " <em>(overall)</em>" : ""}</td>
        <td>${c.notImplemented ? "—" : fmtScore(c.score)}</td>
        <td>${fmtPct(c.coveragePct)}</td>
        <td>${c.pass}</td>
        <td>${c.fail}</td>
        <td>${c.crashedFiles.length}</td>
        <td>${escHtml(c.missingCategories.join(", ") || "—")}</td>
        <td>${escHtml(c.notImplemented ? "NOT IMPLEMENTED — " + (c.note ?? "") : c.note ?? "")}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Co.AI Validation Scorecard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .status { font-size: 32px; font-weight: 800; color: ${statusColor}; }
    .meta { font-size: 13px; color: #94a3b8; margin-bottom: 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .card { background: #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
    .card-num { font-size: 28px; font-weight: 700; }
    .card-label { font-size: 12px; color: #64748b; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th { text-align: left; padding: 8px 10px; color: #64748b; border-bottom: 1px solid #334155; }
    td { padding: 8px 10px; border-bottom: 1px solid #0f172a; }
    tr.pass td:first-child { color: #22c55e; }
    tr.warn td:first-child { color: #f59e0b; }
    tr.fail td:first-child { color: #ef4444; }
    tr.fail { background: rgba(239,68,68,0.06); }
    tr.warn { background: rgba(245,158,11,0.05); }
    .section { margin: 24px 0 12px; font-size: 18px; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Co.AI Validation Scorecard</h1>
  <div class="status">${statusText}</div>
  <p class="meta">Started: ${run.startedAt} | Duration: ${(run.durationMs / 1000).toFixed(1)}s | Hermetic: yes (no live provider calls)</p>

  <div class="summary">
    <div class="card"><div class="card-num">${fmtScore(run.overallScore)}/10</div><div class="card-label">Overall Score</div></div>
    <div class="card"><div class="card-num">${fmtPct(run.overallCoveragePct)}</div><div class="card-label">Overall Coverage</div></div>
    <div class="card"><div class="card-num" style="color:${run.criticalFailures ? "#ef4444" : "#22c55e"}">${run.criticalFailures}</div><div class="card-label">Critical Failures</div></div>
    <div class="card"><div class="card-num">${run.targetScore} / ${run.targetCoverage}%</div><div class="card-label">Target (score/coverage)</div></div>
  </div>

  <div class="section">Components</div>
  <table>
    <thead><tr><th></th><th>Component</th><th>Score</th><th>Coverage</th><th>Pass</th><th>Fail</th><th>Crashed</th><th>Missing categories</th><th>Note</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <p class="meta" style="margin-top:24px">Generated by Co.AI validation-engine. Real-traffic load/security scans live separately in qa-loop.</p>
</body>
</html>`;
}

export function writeReport(run: RunResult, reportsDir: string): string {
  const dir = path.join(reportsDir, `run-${run.startedAt.replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "scorecard.json"), JSON.stringify(run, null, 2), "utf8");
  writeFileSync(path.join(dir, "scorecard.md"), renderMarkdown(run), "utf8");
  writeFileSync(path.join(dir, "scorecard.html"), renderHtml(run), "utf8");
  return dir;
}
