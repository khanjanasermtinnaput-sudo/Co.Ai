import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RunReport, CriticalBug, PhaseResult } from "../utils/types.ts";
import { log } from "../utils/logger.ts";

export function buildRunReport(
  runId: string,
  startedAt: string,
  phases: PhaseResult[],
): RunReport {
  const finishedAt = new Date().toISOString();
  const totalMs = Date.now() - new Date(startedAt).getTime();

  const allTests = phases.flatMap((p) => p.tests.map((t) => ({ ...t, phase: p.phase, phaseName: p.name })));
  const total = allTests.length;
  const passed = allTests.filter((t) => t.passed).length;
  const failed = allTests.filter((t) => !t.passed).length;

  const criticalBugs: CriticalBug[] = allTests
    .filter((t) => !t.passed)
    .map((t) => ({
      phase: t.phase,
      phaseName: t.phaseName,
      test: t.name,
      error: t.error ?? "Unknown error",
      rootCause: t.rootCause,
      suggestedFix: t.suggestedFix,
      screenshot: t.screenshot,
    }));

  const warnings: string[] = [];
  for (const phase of phases) {
    for (const t of phase.tests) {
      if (t.passed && t.details) {
        const ms = (t.details["loadMs"] as number | undefined) ?? (t.details["p95"] as string | undefined);
        if (typeof ms === "number" && ms > 3000) warnings.push(`Slow: ${t.name} — ${ms}ms`);
        if (typeof t.details["successRate"] === "string") {
          const rate = parseFloat(t.details["successRate"]);
          if (rate < 99) warnings.push(`Low success rate: ${t.name} — ${t.details["successRate"]}`);
        }
      }
    }
  }

  const performanceMs: Record<string, number> = {};
  for (const phase of phases) {
    performanceMs[`phase${phase.phase}_${phase.name}`] = phase.totalMs;
  }

  const recommendations: string[] = [];
  const hasHealthRateLimitFinding = phases.some(
    (p) => p.tests.some((t) => t.details?.["rateLimitedCompletely"] === true),
  );
  if (hasHealthRateLimitFinding) {
    recommendations.push(
      "ACTION REQUIRED: /v1/health is 100% rate-limited — exempt health endpoints from rate limiting in tmap-v2/src/server/index.ts. This also fixes keep-warm pings being throttled.",
    );
  }
  if (criticalBugs.some((b) => b.phase === 7 && !b.error?.includes("rate"))) {
    recommendations.push("Upgrade Render instance size or enable Redis caching to handle load");
  }
  if (criticalBugs.some((b) => b.phase === 8)) {
    recommendations.push("URGENT: Security vulnerabilities detected — review Phase 8 failures immediately");
  }
  if (criticalBugs.some((b) => (b.phase === 1 || b.phase === 2) && phases.some((p) => p.phase === b.phase))) {
    recommendations.push("Core platform unreachable or auth broken — check Vercel deployment status");
  }
  if (phases.some((p) => p.totalMs > 120_000)) {
    recommendations.push("Some phases exceeding 2 min — consider parallelizing browser and API tests");
  }
  if (criticalBugs.length === 0 && warnings.length === 0) {
    recommendations.push("All systems healthy. Continue monitoring.");
  }

  return {
    runId,
    startedAt,
    finishedAt,
    totalMs,
    phases,
    summary: {
      total,
      passed,
      failed,
      criticalBugs,
      warnings,
      performanceMs,
      memoryUsageMb: process.memoryUsage().heapUsed / 1024 / 1024,
      recommendations,
    },
  };
}

export function saveReport(report: RunReport, runDir: string): { jsonPath: string; htmlPath: string } {
  mkdirSync(runDir, { recursive: true });

  const jsonPath = resolve(runDir, "report.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const htmlPath = resolve(runDir, "report.html");
  writeFileSync(htmlPath, renderHtml(report));

  return { jsonPath, htmlPath };
}

export function printReport(report: RunReport): void {
  const { summary } = report;
  console.log("\n" + "═".repeat(70));
  console.log("  CO.AI QA LOOP REPORT");
  console.log("  Run: " + report.runId);
  console.log("  Duration: " + (report.totalMs / 1000).toFixed(1) + "s");
  console.log("═".repeat(70));
  console.log(`\n  Total Tests : ${summary.total}`);
  console.log(`  ✓ Passed    : ${summary.passed}`);
  console.log(`  ✗ Failed    : ${summary.failed}`);
  console.log(`  ⚠ Warnings  : ${summary.warnings.length}`);
  console.log(`  Heap        : ${summary.memoryUsageMb.toFixed(1)} MB`);

  if (summary.criticalBugs.length > 0) {
    console.log(`\n  CRITICAL BUGS (${summary.criticalBugs.length}):`);
    for (const bug of summary.criticalBugs) {
      console.log(`  ✗ [Phase ${bug.phase} ${bug.phaseName}] ${bug.test}`);
      console.log(`      Error: ${bug.error}`);
      if (bug.rootCause) console.log(`      Root cause: ${bug.rootCause}`);
      if (bug.suggestedFix) console.log(`      Fix: ${bug.suggestedFix}`);
    }
  }

  if (summary.warnings.length > 0) {
    console.log(`\n  WARNINGS:`);
    for (const w of summary.warnings) console.log(`  ⚠ ${w}`);
  }

  console.log(`\n  RECOMMENDATIONS:`);
  for (const r of summary.recommendations) console.log(`  → ${r}`);

  console.log("\n  PHASE BREAKDOWN:");
  for (const phase of report.phases) {
    const icon = phase.failCount === 0 ? "✓" : "✗";
    const status = phase.skipped ? "SKIPPED" : `${phase.passCount}/${phase.passCount + phase.failCount} pass`;
    console.log(`  ${icon} Phase ${phase.phase} ${phase.name.padEnd(20)} ${status.padEnd(14)} ${phase.totalMs}ms`);
  }
  console.log("\n" + "═".repeat(70) + "\n");
}

function renderHtml(report: RunReport): string {
  const { summary } = report;
  const statusColor = summary.failed === 0 ? "#22c55e" : "#ef4444";
  const statusText = summary.failed === 0 ? "ALL PASS" : `${summary.failed} FAILED`;

  const phasesHtml = report.phases.map((p) => {
    const icon = p.failCount === 0 ? "✅" : "❌";
    const testsHtml = p.tests.map((t) => `
      <tr class="${t.passed ? "pass" : "fail"}">
        <td>${t.passed ? "✓" : "✗"}</td>
        <td>${escHtml(t.name)}</td>
        <td>${t.durationMs}ms</td>
        <td>${t.error ? escHtml(t.error) : ""}</td>
        <td>${t.screenshot ? `<a href="${t.screenshot}" target="_blank">📷</a>` : ""}</td>
      </tr>`).join("");

    return `
    <div class="phase">
      <h2>${icon} Phase ${p.phase}: ${escHtml(p.name)}</h2>
      <p class="meta">${p.passCount} passed, ${p.failCount} failed — ${p.totalMs}ms${p.skipped ? ` — SKIPPED: ${p.skipReason}` : ""}</p>
      <table>
        <thead><tr><th></th><th>Test</th><th>Duration</th><th>Error</th><th>Screenshot</th></tr></thead>
        <tbody>${testsHtml}</tbody>
      </table>
    </div>`;
  }).join("\n");

  const bugsHtml = summary.criticalBugs.map((bug) => `
    <div class="bug">
      <strong>Phase ${bug.phase} — ${escHtml(bug.test)}</strong><br>
      <span class="error">${escHtml(bug.error)}</span><br>
      ${bug.rootCause ? `<em>Root cause:</em> ${escHtml(bug.rootCause)}<br>` : ""}
      ${bug.suggestedFix ? `<em>Fix:</em> ${escHtml(bug.suggestedFix)}` : ""}
    </div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Co.AI QA Report — ${report.runId}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    h2 { font-size: 16px; font-weight: 600; margin-bottom: 8px; padding: 8px 12px; background: #1e293b; border-radius: 6px; }
    .status { font-size: 32px; font-weight: 800; color: ${statusColor}; }
    .meta { font-size: 13px; color: #94a3b8; margin-bottom: 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .card { background: #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
    .card-num { font-size: 28px; font-weight: 700; }
    .card-label { font-size: 12px; color: #64748b; margin-top: 4px; }
    .phase { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th { text-align: left; padding: 6px 8px; color: #64748b; border-bottom: 1px solid #334155; }
    td { padding: 6px 8px; border-bottom: 1px solid #1e293b; }
    tr.pass td:first-child { color: #22c55e; }
    tr.fail td:first-child { color: #ef4444; }
    tr.fail { background: rgba(239,68,68,0.05); }
    .bug { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 12px; margin-bottom: 8px; font-size: 13px; }
    .error { color: #f87171; }
    .section { margin: 24px 0 12px; font-size: 18px; font-weight: 600; }
    .recs { background: #1e293b; border-radius: 8px; padding: 16px; }
    .recs li { margin: 6px 0; list-style: none; padding-left: 16px; position: relative; }
    .recs li::before { content: "→"; position: absolute; left: 0; color: #6366f1; }
  </style>
</head>
<body>
  <h1>Co.AI QA Loop Report</h1>
  <div class="status">${statusText}</div>
  <p class="meta">Run ID: ${report.runId} | Started: ${report.startedAt} | Duration: ${(report.totalMs / 1000).toFixed(1)}s</p>

  <div class="summary">
    <div class="card"><div class="card-num">${summary.total}</div><div class="card-label">Total Tests</div></div>
    <div class="card"><div class="card-num" style="color:#22c55e">${summary.passed}</div><div class="card-label">Passed</div></div>
    <div class="card"><div class="card-num" style="color:#ef4444">${summary.failed}</div><div class="card-label">Failed</div></div>
    <div class="card"><div class="card-num" style="color:#f59e0b">${summary.warnings.length}</div><div class="card-label">Warnings</div></div>
  </div>

  ${summary.criticalBugs.length > 0 ? `
  <div class="section">Critical Bugs (${summary.criticalBugs.length})</div>
  ${bugsHtml}` : ""}

  <div class="section">Recommendations</div>
  <div class="recs"><ul>${summary.recommendations.map((r) => `<li>${escHtml(r)}</li>`).join("")}</ul></div>

  <div class="section">Phase Results</div>
  ${phasesHtml}

  <p class="meta" style="margin-top:24px">Generated by Co.AI QA Loop | Heap: ${summary.memoryUsageMb.toFixed(1)} MB</p>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
