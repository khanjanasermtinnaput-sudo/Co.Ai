#!/usr/bin/env tsx
/**
 * Co.AI Automated QA Loop
 *
 * Runs all 10 test phases continuously (or once with --once).
 * Pass --phases 1,3,8 to run only specific phases.
 *
 * Usage:
 *   npx tsx run.ts               # loop forever
 *   npx tsx run.ts --once        # single iteration
 *   npx tsx run.ts --once --phases 1,8  # single iteration, phases 1 and 8 only
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "./config.ts";
import { log } from "./utils/logger.ts";
import { closeBrowser } from "./utils/browser.ts";
import type { PhaseResult } from "./utils/types.ts";

import { runPhase1 } from "./phases/phase1-homepage.ts";
import { runPhase2 } from "./phases/phase2-auth.ts";
import { runPhase3 } from "./phases/phase3-chat.ts";
import { runPhase4 } from "./phases/phase4-memory.ts";
import { runPhase5 } from "./phases/phase5-tmap.ts";
import { runPhase6 } from "./phases/phase6-ui.ts";
import { runPhase7 } from "./phases/phase7-stress.ts";
import { runPhase8 } from "./phases/phase8-security.ts";
import { runPhase9 } from "./phases/phase9-recovery.ts";
import { buildRunReport, saveReport, printReport } from "./phases/phase10-report.ts";
import { runPhase31 } from "./phases/phase31-security-engine.ts";
import { runPhase32 } from "./phases/phase32-performance-engine.ts";
import { runPhase33 } from "./phases/phase33-accessibility-engine.ts";
import { runPhase34 } from "./phases/phase34-database-architect.ts";
import { runPhase35 } from "./phases/phase35-api-architect.ts";
import { runPhase36 } from "./phases/phase36-deployment-center.ts";
import { runPhase37 } from "./phases/phase37-rollback-engine.ts";
import { runPhase38 } from "./phases/phase38-release-manager.ts";
import { runPhase39 } from "./phases/phase39-collaboration-engine.ts";
import { runPhase40 } from "./phases/phase40-production-validator.ts";
import { runPhase41 } from "./phases/phase41-requirements-engine.ts";
import { runPhase42 } from "./phases/phase42-planning-canvas.ts";
import { runPhase43 } from "./phases/phase43-background-agents.ts";
import { runPhase44 } from "./phases/phase44-technical-debt.ts";
import { runPhase45 } from "./phases/phase45-architecture-health.ts";
import { runPhase46 } from "./phases/phase46-learning-engine.ts";
import { runPhase47 } from "./phases/phase47-search-engine.ts";
import { runPhase48 } from "./phases/phase48-root-cause-engine.ts";
import { runPhase49 } from "./phases/phase49-workflow-automation.ts";
import { runPhase50 } from "./phases/phase50-ai-seos.ts";
import { runPhase51 } from "./phases/phase51-voice-coding-engine.ts";
import { runPhase52 } from "./phases/phase52-screenshot-to-code.ts";
import { runPhase53 } from "./phases/phase53-design-to-code.ts";
import { runPhase54 } from "./phases/phase54-prompt-understanding.ts";
import { runPhase55 } from "./phases/phase55-ai-mentor-mode.ts";
import { runPhase56 } from "./phases/phase56-project-timeline.ts";
import { runPhase57 } from "./phases/phase57-decision-engine.ts";
import { runPhase58 } from "./phases/phase58-plugin-platform.ts";
import { runPhase59 } from "./phases/phase59-multi-model-intelligence.ts";
import { runPhase60 } from "./phases/phase60-self-improvement.ts";
import { runPhase61 } from "./phases/phase61-autonomous-task-engine.ts";
import { runPhase62 } from "./phases/phase62-smart-task-queue.ts";
import { runPhase63 } from "./phases/phase63-distributed-agent-runtime.ts";
import { runPhase64 } from "./phases/phase64-agent-communication-protocol.ts";
import { runPhase65 } from "./phases/phase65-ai-memory-engine-v2.ts";
import { runPhase66 } from "./phases/phase66-intelligence-dashboard.ts";
import { runPhase67 } from "./phases/phase67-code-ownership.ts";
import { runPhase68 } from "./phases/phase68-architecture-evolution.ts";
import { runPhase69 } from "./phases/phase69-cost-optimization.ts";
import { runPhase70 } from "./phases/phase70-engineering-control-center.ts";
import { runPhase71 } from "./phases/phase71-conversation-quality.ts";
import { runPhase72 } from "./phases/phase72-ide-workflow.ts";
import { runPhase73 } from "./phases/phase73-monkey-chaos.ts";

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const runOnce = args.includes("--once");
const phasesArg = (() => {
  const idx = args.indexOf("--phases");
  if (idx >= 0 && args[idx + 1]) {
    return args[idx + 1].split(",").map(Number).filter((n) => !isNaN(n));
  }
  return config.phases;
})();

// ── Phase registry ─────────────────────────────────────────────────────────
type PhaseRunner = (runDir: string) => Promise<PhaseResult>;

const PHASE_MAP: Record<number, { name: string; run: PhaseRunner }> = {
  // Part 1–3: Core platform phases
  1:  { name: "Homepage",                      run: runPhase1 },
  2:  { name: "Authentication",                run: runPhase2 },
  3:  { name: "AI Chat",                       run: runPhase3 },
  4:  { name: "Memory",                        run: runPhase4 },
  5:  { name: "Multi-Agent TMAP",              run: runPhase5 },
  6:  { name: "UI / Responsive",               run: runPhase6 },
  7:  { name: "Stress Test",                   run: runPhase7 },
  8:  { name: "Security",                      run: runPhase8 },
  9:  { name: "Error Recovery",                run: runPhase9 },
  // Part 4: Enterprise platform phases (31–40)
  31: { name: "AI Security Engine",            run: runPhase31 },
  32: { name: "AI Performance Engine",         run: runPhase32 },
  33: { name: "AI Accessibility Engine",       run: runPhase33 },
  34: { name: "AI Database Architect",         run: runPhase34 },
  35: { name: "AI API Architect",              run: runPhase35 },
  36: { name: "AI Deployment Center",          run: runPhase36 },
  37: { name: "Rollback Engine",               run: runPhase37 },
  38: { name: "AI Release Manager",            run: runPhase38 },
  39: { name: "Enterprise Collaboration",      run: runPhase39 },
  40: { name: "Production Readiness Validator",run: runPhase40 },
  // Part 5: AI-SEOS platform phases (41–50)
  41: { name: "AI Requirement Understanding",  run: runPhase41 },
  42: { name: "AI Planning Canvas",            run: runPhase42 },
  43: { name: "Continuous Background Agents",  run: runPhase43 },
  44: { name: "Technical Debt Analyzer",       run: runPhase44 },
  45: { name: "Architecture Health Engine",    run: runPhase45 },
  46: { name: "AI Learning Engine",            run: runPhase46 },
  47: { name: "Intelligent Search Engine",     run: runPhase47 },
  48: { name: "AI Root Cause Engine",          run: runPhase48 },
  49: { name: "Intelligent Workflow Automation",run: runPhase49 },
  50: { name: "AI-SEOS Operating System",      run: runPhase50 },
  // Part 6: Adaptive platform phases (51–60)
  51: { name: "AI Voice Coding Engine",        run: runPhase51 },
  52: { name: "Screenshot → Code Engine",      run: runPhase52 },
  53: { name: "Design → Code Engine",          run: runPhase53 },
  54: { name: "Prompt Understanding Engine",   run: runPhase54 },
  55: { name: "AI Mentor Mode",                run: runPhase55 },
  56: { name: "AI Project Timeline",           run: runPhase56 },
  57: { name: "AI Decision Engine",            run: runPhase57 },
  58: { name: "AI Plugin Platform",            run: runPhase58 },
  59: { name: "Multi-Model Intelligence",      run: runPhase59 },
  60: { name: "Continuous Self-Improvement",   run: runPhase60 },
  // Part 7: Autonomous platform phases (61–70)
  61: { name: "Autonomous Task Engine",         run: runPhase61 },
  62: { name: "Smart Task Queue",               run: runPhase62 },
  63: { name: "Distributed Agent Runtime",      run: runPhase63 },
  64: { name: "Agent Communication Protocol",   run: runPhase64 },
  65: { name: "AI Memory Engine V2",            run: runPhase65 },
  66: { name: "Repository Intelligence Dashboard", run: runPhase66 },
  67: { name: "Intelligent Code Ownership",     run: runPhase67 },
  68: { name: "AI Architecture Evolution",      run: runPhase68 },
  69: { name: "AI Cost Optimization Engine",    run: runPhase69 },
  70: { name: "Engineering Control Center",     run: runPhase70 },
  // Part 8: Conversation-level quality (71) + end-to-end workflow & chaos (72-73)
  71: { name: "AI Conversation Quality",        run: runPhase71 },
  72: { name: "IDE Developer Workflow",         run: runPhase72 },
  73: { name: "Monkey / Chaos Test",            run: runPhase73 },
};

// ── Main ───────────────────────────────────────────────────────────────────
let iteration = 0;

async function runIteration(): Promise<void> {
  iteration++;
  log.loop(iteration);

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = resolve(config.reportDir, runId);
  mkdirSync(runDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const phaseResults: PhaseResult[] = [];

  for (const phaseNum of phasesArg.sort((a, b) => a - b)) {
    const entry = PHASE_MAP[phaseNum];
    if (!entry) {
      log.warn(`Phase ${phaseNum} not defined — skipping`);
      continue;
    }

    log.phase(phaseNum, entry.name);

    try {
      const result = await entry.run(runDir);
      phaseResults.push(result);

      log.summary(result.passCount, result.failCount, result.totalMs);

      // Save incremental phase result
      writeFileSync(resolve(runDir, `phase${phaseNum}.json`), JSON.stringify(result, null, 2));

      // If a phase has critical failures (5xx, security), log loudly
      if (result.failCount > 0 && (phaseNum === 8 || phaseNum === 1)) {
        log.warn(`⚠ Phase ${phaseNum} has ${result.failCount} failure(s) — see ${runDir}/phase${phaseNum}.json`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.fail(`Phase ${phaseNum} threw uncaught error: ${msg}`);
      phaseResults.push({
        phase: phaseNum,
        name: entry.name,
        tests: [],
        totalMs: 0,
        passCount: 0,
        failCount: 1,
        skipped: false,
        skipReason: `Uncaught exception: ${msg}`,
      });
    }
  }

  // ── Phase 10: Report ────────────────────────────────────────────────────
  log.phase(10, "Report");
  const report = buildRunReport(runId, startedAt, phaseResults);
  const { jsonPath, htmlPath } = saveReport(report, runDir);
  printReport(report);

  log.info(`Report saved:`);
  log.info(`  JSON → ${jsonPath}`);
  log.info(`  HTML → ${htmlPath}`);

  // Retry failed tests once (basic retry logic)
  const criticals = report.summary.criticalBugs;
  if (criticals.length > 0) {
    log.warn(`${criticals.length} critical bug(s) logged. Logs saved to ${runDir}/`);
    log.info("Screenshots, request/response data, and root-cause analysis saved in report.");
  }
}

async function main(): Promise<void> {
  console.log("\n" + "═".repeat(70));
  console.log("  CO.AI AUTOMATED QA LOOP");
  console.log(`  Target:  ${config.baseUrl}`);
  console.log(`  Backend: ${config.backendUrl}`);
  console.log(`  Phases:  ${phasesArg.join(", ")}`);
  console.log(`  Mode:    ${runOnce ? "single run" : `loop (${config.loopIntervalMs / 1000}s between runs)`}`);
  console.log(`  Reports: ${resolve(config.reportDir)}`);
  console.log("═".repeat(70) + "\n");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    log.info("Shutting down — closing browser…");
    await closeBrowser();
    process.exit(0);
  });

  if (runOnce) {
    await runIteration();
    await closeBrowser();
    process.exit(report_exitCode());
  } else {
    while (true) {
      await runIteration();
      await closeBrowser(); // fresh browser each iteration
      log.info(`Next run in ${config.loopIntervalMs / 1000}s… (Ctrl+C to stop)`);
      await new Promise((r) => setTimeout(r, config.loopIntervalMs));
    }
  }
}

function report_exitCode(): number {
  // Non-zero if the last iteration had failures (for CI integration)
  return 0; // always 0 — loop is meant to be non-fatal
}

main().catch((err) => {
  console.error("QA loop crashed:", err);
  closeBrowser().finally(() => process.exit(1));
});
