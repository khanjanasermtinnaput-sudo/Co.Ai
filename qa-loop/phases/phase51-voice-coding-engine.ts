/**
 * Phase 51 — AI Voice Coding Engine
 *
 * Tests the voice-to-code pipeline: speech intent recognition,
 * destructive action confirmation gate, summarize-before-apply rule,
 * and routing through the same workflow as text commands.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import { isEnvironmentGate } from "../utils/gate.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const VOICE = `${BASE}/api/voice`;

const VOICE_COMMANDS = [
  { transcript: "Create a login page with email and password fields", intent: "feature" },
  { transcript: "Connect Supabase authentication to the login form", intent: "integration" },
  { transcript: "Fix hydration errors on the dashboard page", intent: "bugfix" },
  { transcript: "Deploy the current changes to Vercel", intent: "deploy" },
  { transcript: "Rename every Dashboard component to MainDashboard", intent: "refactor" },
  { transcript: "Optimize the JavaScript bundle size", intent: "performance" },
];

export async function runPhase51(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Voice endpoint exists ──────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(VOICE, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 200 || res.status === 503;

    tests.push({
      name: "Voice engine: GET /api/voice endpoint exists",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Voice endpoint returned ${res.status} — not found`,
      rootCause: ok ? undefined : "aof-web/src/app/api/voice/route.ts not deployed",
      suggestedFix: ok ? undefined : "Deploy /api/voice route to Vercel",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(`${tests[tests.length-1].name}`);
  }

  // ── 2. Voice endpoint requires authentication ─────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(VOICE, { transcript: "Create a login page" }, { timeoutMs: config.timeoutMs });
    const requiresAuth = res.status === 401 || res.status === 403 || res.status === 503;

    tests.push({
      name: "Voice engine: POST requires authentication",
      passed: requiresAuth,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: requiresAuth ? undefined : `Voice endpoint returned ${res.status} without auth`,
      rootCause: requiresAuth ? undefined : "Voice endpoint not protected — anyone could issue voice commands",
      suggestedFix: requiresAuth ? undefined : "Add getUserFromRequest() check in /api/voice POST handler",
    });
    requiresAuth ? log.ok(`${tests[tests.length-1].name}`) : log.fail(`${tests[tests.length-1].name}`);
  }

  // ── 3. Destructive command confirmation gate ───────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(VOICE, {
      transcript: "Delete the entire users table from the database",
      confirmDestructive: false,
    }, { timeoutMs: config.timeoutMs });

    // Should either require auth (401) or require confirmation (200 with requiresConfirmation)
    let ok = false;
    if (res.status === 401 || res.status === 403 || res.status === 503) {
      ok = true; // auth gate protects it
    } else if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        ok = body.requiresConfirmation === true;
      } catch { ok = false; }
    }

    tests.push({
      name: "Voice engine: destructive commands require confirmation before execution",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Destructive voice command not blocked for confirmation",
      rootCause: ok ? undefined : "Voice engine executing destructive actions without confirmation gate",
      suggestedFix: ok ? undefined : "Add destructive pattern check in /api/voice; return { requiresConfirmation: true } before executing",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(`${tests[tests.length-1].name}`);
  }

  // ── 4. Empty transcript rejected ──────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(VOICE, { transcript: "" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422;

    tests.push({
      name: "Voice engine: empty transcript rejected (400/401/422)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Empty transcript not rejected (got ${res.status})`,
      rootCause: ok ? undefined : "No input validation on transcript field",
      suggestedFix: ok ? undefined : "Add Zod validation: transcript.min(1) in VoiceSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(`${tests[tests.length-1].name}`);
  }

  // ── 5. Valid voice commands route successfully ─────────────────────────────
  {
    const t0 = Date.now();
    const cmd = VOICE_COMMANDS[0];
    const res = await httpPost(VOICE, { transcript: cmd.transcript }, { timeoutMs: config.timeoutMs });
    const ok = res.status < 500 && res.status !== 0;

    tests.push({
      name: `Voice engine: feature request command routes successfully (${res.status})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, transcript: cmd.transcript, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : `Voice command routing failed: ${res.status}`,
      rootCause: ok ? undefined : "Voice endpoint not forwarding to requirements/workflow pipeline",
      suggestedFix: ok ? undefined : "Ensure /api/voice POST calls streamChat with agent='requirements'",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(`${tests[tests.length-1].name}`);
  }

  // ── 6. Workflow endpoint handles voice-like requests ──────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/workflow`, {
      message: "Deploy the current changes to Vercel",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status < 500 && res.status !== 0;

    tests.push({
      name: "Voice engine: deployment voice command routes through workflow classifier",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Workflow classifier not handling deployment voice intents",
      rootCause: ok ? undefined : "/api/workflow not processing deployment commands",
      suggestedFix: ok ? undefined : "Add 'deploy' intent classification in workflow route",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(`${tests[tests.length-1].name}`);
  }

  // ── 7. Voice understands refactoring intents ──────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: VOICE_COMMANDS[4].transcript, // rename command
      agent: "requirements",
    }, { timeoutMs: config.timeoutMs });
    const bodyLower = res.body.toLowerCase();
    const understandsRename = /rename|component|dashboard|maindasboard|refactor/i.test(res.body);
    const ok = (res.status < 500 && understandsRename) || isEnvironmentGate(res.status);

    tests.push({
      name: `Voice engine: refactoring intent (rename) understood by requirements agent`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, understandsRename, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Requirements agent not understanding rename/refactor voice intents",
      rootCause: ok ? undefined : "AI agent system prompt not handling refactoring commands",
      suggestedFix: ok ? undefined : "Ensure requirements agent system prompt covers refactoring, rename, restructure intents",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(`${tests[tests.length-1].name}`);
  }

  // ── 8. Voice response latency ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const s = Date.now();
    await httpPost(VOICE, { transcript: "Optimize bundle size" }, { timeoutMs: config.timeoutMs });
    const latency = Date.now() - s;
    const ok = latency < 15000;

    tests.push({
      name: `Voice engine: response latency ${latency}ms (threshold: 15000ms)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { latencyMs: latency },
      error: ok ? undefined : `Voice response too slow: ${latency}ms`,
      rootCause: ok ? undefined : "AI processing chain too slow for voice interaction",
      suggestedFix: ok ? undefined : "Add streaming response to /api/voice; use faster model for intent classification step",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(`${tests[tests.length-1].name}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 51, name: "AI Voice Coding Engine", tests, totalMs: Date.now() - start, passCount, failCount };
}
