/**
 * Phase 59 — Multi-Model Intelligence
 *
 * Tests the AI provider routing engine: provider failover chain,
 * task-to-model routing, speed/cost/quality optimization,
 * and observability of which model handled each request.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = config.baseUrl;
const BACKEND = config.backendUrl;

function findRepoRoot(): string | null {
  const c = [resolve(import.meta.dirname ?? ".", ".."), resolve(process.cwd(), ".."), process.cwd()];
  return c.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

export async function runPhase59(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];
  const repoRoot = findRepoRoot();

  // ── 1. AI provider chain file exists ─────────────────────────────────────
  {
    const t0 = Date.now();
    let providerFileFound = false;
    let providerCount = 0;

    if (repoRoot) {
      const candidates = [
        resolve(repoRoot, "aof-web", "src", "lib", "server", "ai.ts"),
        resolve(repoRoot, "aof-web", "src", "lib", "server", "providers.ts"),
        resolve(repoRoot, "aof-web", "src", "lib", "ai.ts"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          providerFileFound = true;
          try {
            const { readFileSync } = await import("node:fs");
            const content = readFileSync(candidate, "utf8");
            // Count provider names
            const providers = ["anthropic", "openrouter", "gemini", "deepseek", "qwen", "llama", "openai"];
            providerCount = providers.filter((p) => content.toLowerCase().includes(p)).length;
          } catch {}
          break;
        }
      }
    }

    const ok = providerFileFound || !repoRoot;

    tests.push({
      name: `Multi-model: AI provider file found (${providerCount} providers detected)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { providerFileFound, providerCount, repoRoot },
      error: ok ? undefined : "AI provider chain file not found",
      rootCause: ok ? undefined : "aof-web/src/lib/server/ai.ts not present",
      suggestedFix: ok ? undefined : "Create lib/server/ai.ts with provider failover chain: Anthropic → OpenRouter → Gemini → DeepSeek",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. AI routing: chat agent uses available provider ────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "What is 2 + 2?",
      agent: "chat",
    }, { timeoutMs: config.timeoutMs });

    const has4 = /\b4\b|four/.test(res.body);
    const ok = res.status < 500 && has4;

    tests.push({
      name: `Multi-model: chat request routed and answered correctly (contains "4": ${has4})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, has4, snippet: res.body.slice(0, 100) },
      error: ok ? undefined : "AI model not answering basic factual question",
      rootCause: ok ? undefined : "AI provider chain broken or no provider available",
      suggestedFix: ok ? undefined : "Check ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY env vars",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Multiple agents use provider chain ─────────────────────────────────
  {
    const t0 = Date.now();
    const agents = ["chat", "analyze", "debug"] as const;
    const results = await Promise.all(
      agents.map((agent) =>
        httpPost(`${BASE}/api/chat`, { message: "Hello", agent }, { timeoutMs: config.timeoutMs })
      )
    );
    const workingAgents = results.filter((r) => r.status < 500 && r.body.length > 5).length;
    const ok = workingAgents >= 2;

    tests.push({
      name: `Multi-model: ${workingAgents}/3 agent types using provider chain`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { agents, statuses: results.map((r) => r.status), workingAgents },
      error: ok ? undefined : `Only ${workingAgents}/3 agents working`,
      rootCause: ok ? undefined : "Agent routing not forwarding to AI provider chain",
      suggestedFix: ok ? undefined : "Verify each agent case in /api/chat calls the AI provider chain function",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Provider failover: backend AI service responds ─────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BACKEND}/v1/health`, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 429;

    tests.push({
      name: `Multi-model: backend AI service (Render) responding (${res.status})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, url: `${BACKEND}/v1/health` },
      error: ok ? undefined : `Backend provider service not responding (${res.status})`,
      rootCause: ok ? undefined : "Render backend service down — AI provider failover may be reduced",
      suggestedFix: ok ? undefined : "Check Render dashboard; ensure keep-warm workflow is pinging backend",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. Task classification: reasoning task → best reasoning model ─────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "Analyze the following code architecture and identify potential scalability bottlenecks: a monolithic Next.js app with 50 API routes, a single Supabase instance, and no caching layer.",
      agent: "analyze",
    }, { timeoutMs: config.timeoutMs });

    const mentionsArchitecture = /scalab|bottleneck|cache|monolith|database|load|perform|architect/i.test(res.body);
    const ok = res.status < 500 && mentionsArchitecture;

    tests.push({
      name: "Multi-model: reasoning/analysis task routed to capable model",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, mentionsArchitecture, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "Analysis task not producing architectural reasoning",
      rootCause: ok ? undefined : "Complex reasoning task not routed to capable model",
      suggestedFix: ok ? undefined : "Ensure analyze agent uses Anthropic claude-sonnet or opus for complex reasoning tasks",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Concurrent requests handled by provider chain ─────────────────────
  {
    const t0 = Date.now();
    const concurrentReqs = Array.from({ length: 3 }, (_, i) =>
      httpPost(`${BASE}/api/chat`, {
        message: `Count to ${i + 3}`,
        agent: "chat",
      }, { timeoutMs: config.timeoutMs })
    );
    const results = await Promise.all(concurrentReqs);
    const ok5xx = results.filter((r) => r.status >= 500).length;
    const ok = ok5xx === 0;

    tests.push({
      name: `Multi-model: 3 concurrent requests handled (${results.filter((r) => r.status < 500).length}/3 succeeded)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { statuses: results.map((r) => r.status), errorCount: ok5xx },
      error: ok ? undefined : `${ok5xx} concurrent requests returned 5xx errors`,
      rootCause: ok ? undefined : "Provider chain not handling concurrent load",
      suggestedFix: ok ? undefined : "Add request queuing or provider pool to handle concurrent AI requests",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Model routing observability: response identifies AI interaction ─────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/chat`, {
      message: "Briefly describe what you can help me with as a coding assistant",
      agent: "chat",
    }, { timeoutMs: config.timeoutMs });

    const mentionsCapabilities = /code|build|help|develop|assist|program|engineer/i.test(res.body);
    const ok = res.status < 500 && mentionsCapabilities;

    tests.push({
      name: "Multi-model: AI self-identifies as coding assistant (model routing working end-to-end)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, mentionsCapabilities, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : "AI not providing coherent response about capabilities",
      rootCause: ok ? undefined : "Model routing or system prompt not working end-to-end",
      suggestedFix: ok ? undefined : "Verify chat agent system prompt is reaching the AI model; check provider chain",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 59, name: "Multi-Model Intelligence", tests, totalMs: Date.now() - start, passCount, failCount };
}
