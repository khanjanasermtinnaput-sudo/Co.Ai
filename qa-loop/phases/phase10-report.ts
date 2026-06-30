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
  if (criticalBugs.some((b) => b.phase === 8 || b.phase === 31)) {
    recommendations.push("URGENT: Security vulnerabilities detected — review Phase 8/31 failures immediately");
  }
  if (criticalBugs.some((b) => (b.phase === 1 || b.phase === 2) && phases.some((p) => p.phase === b.phase))) {
    recommendations.push("Core platform unreachable or auth broken — check Vercel deployment status");
  }
  if (phases.some((p) => p.totalMs > 120_000)) {
    recommendations.push("Some phases exceeding 2 min — consider parallelizing browser and API tests");
  }
  if (criticalBugs.some((b) => b.phase === 32)) {
    recommendations.push("Performance regressions detected — review Phase 32 for bundle/latency issues");
  }
  if (criticalBugs.some((b) => b.phase === 33)) {
    recommendations.push("Accessibility violations found — review Phase 33 WCAG failures before release");
  }
  if (criticalBugs.some((b) => b.phase === 34)) {
    recommendations.push("Database health issues — check RLS, indexes, and schema (Phase 34)");
  }
  if (criticalBugs.some((b) => b.phase === 35)) {
    recommendations.push("API architecture issues — broken endpoints or missing auth detected (Phase 35)");
  }
  if (criticalBugs.some((b) => b.phase === 36)) {
    recommendations.push("DEPLOYMENT BLOCKED — pre-deployment gate failures (Phase 36)");
  }
  if (criticalBugs.some((b) => b.phase === 37)) {
    recommendations.push("Rollback capability compromised — fix rollback engine failures (Phase 37)");
  }
  if (criticalBugs.some((b) => b.phase === 39)) {
    recommendations.push("Collaboration/isolation issues — data leakage or session pollution detected (Phase 39)");
  }
  if (criticalBugs.some((b) => b.phase === 40)) {
    recommendations.push("PRODUCTION MERGE BLOCKED — production readiness validator failed (Phase 40)");
  }
  if (criticalBugs.some((b) => b.phase === 41)) {
    recommendations.push("Requirements engine degraded — AI requirements agent not responding or not clarifying needs (Phase 41)");
  }
  if (criticalBugs.some((b) => b.phase === 42)) {
    recommendations.push("Planning canvas failure — AI plan agent not producing structured plans (Phase 42)");
  }
  if (criticalBugs.some((b) => b.phase === 43)) {
    recommendations.push("Background agents not running — check keep-warm workflow and CI automation (Phase 43)");
  }
  if (criticalBugs.some((b) => b.phase === 44)) {
    recommendations.push("High technical debt detected — schedule cleanup sprint; address large files and TODOs (Phase 44)");
  }
  if (criticalBugs.some((b) => b.phase === 45)) {
    recommendations.push("Architecture health below threshold — review security, performance, and code structure scores (Phase 45)");
  }
  if (criticalBugs.some((b) => b.phase === 46)) {
    recommendations.push("Learning engine failure — /api/ai/learning endpoint not functional (Phase 46)");
  }
  if (criticalBugs.some((b) => b.phase === 47)) {
    recommendations.push("Search engine not operational — /api/search returning errors or missing auth (Phase 47)");
  }
  if (criticalBugs.some((b) => b.phase === 48)) {
    recommendations.push("Root cause engine degraded — debug agent not providing actionable analysis (Phase 48)");
  }
  if (criticalBugs.some((b) => b.phase === 49)) {
    recommendations.push("Workflow automation incomplete — CI pipeline missing gates or workflow API failing (Phase 49)");
  }
  if (criticalBugs.some((b) => b.phase === 50)) {
    recommendations.push("AI-SEOS NOT READY — overall readiness score below threshold; check Phase 50 report for failed criteria");
  }
  if (criticalBugs.some((b) => b.phase === 51)) {
    recommendations.push("Voice coding engine degraded — /api/voice not deployed or destructive gate not enforcing (Phase 51)");
  }
  if (criticalBugs.some((b) => b.phase === 52)) {
    recommendations.push("Screenshot→Code engine failure — /api/vision/screenshot-to-code missing or auth not enforced (Phase 52)");
  }
  if (criticalBugs.some((b) => b.phase === 53)) {
    recommendations.push("Design→Code engine failure — /api/vision/design-to-code missing or design source validation broken (Phase 53)");
  }
  if (criticalBugs.some((b) => b.phase === 54)) {
    recommendations.push("Prompt understanding degraded — intent classification not routing to correct workflows (Phase 54)");
  }
  if (criticalBugs.some((b) => b.phase === 55)) {
    recommendations.push("AI Mentor mode failure — /api/ai/mentor not deployed or level adaptation not working (Phase 55)");
  }
  if (criticalBugs.some((b) => b.phase === 56)) {
    recommendations.push("Project timeline failure — /api/timeline not deployed or event validation broken (Phase 56)");
  }
  if (criticalBugs.some((b) => b.phase === 57)) {
    recommendations.push("Decision engine failure — /api/ai/decisions not deployed or multi-approach analysis broken (Phase 57)");
  }
  if (criticalBugs.some((b) => b.phase === 58)) {
    recommendations.push("Plugin platform failure — /api/plugins not deployed or sandbox enforcement missing (Phase 58)");
  }
  if (criticalBugs.some((b) => b.phase === 59)) {
    recommendations.push("Multi-model intelligence degraded — AI provider chain broken or routing not working (Phase 59)");
  }
  if (criticalBugs.some((b) => b.phase === 60)) {
    recommendations.push("Self-improvement engine failure — learning patterns not persisting or TypeScript consistency broken (Phase 60)");
  }
  if (criticalBugs.length === 0 && warnings.length === 0) {
    recommendations.push("All systems healthy — all 39 phases passed. Adaptive Engineering Platform fully operational. Safe to deploy.");
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
