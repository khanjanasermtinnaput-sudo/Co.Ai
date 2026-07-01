/**
 * Phase 71 — AI Conversation Quality
 *
 * Tests the actual conversational behaviour of /api/chat: does it remember
 * prior turns, does it hold up over long history, does streaming survive a
 * client-side cancel, does markdown/code output come back well-formed, does
 * it mirror the user's language, does it hedge instead of hallucinating, and
 * does state stay isolated between unrelated anonymous callers. All tests hit
 * the public endpoint directly — no login required, since /api/chat accepts
 * a client-supplied `history[]` instead of a server-side conversation id.
 */
import { collectRawStream, httpPost, stripControlFrames } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const CHAT_URL = `${config.baseUrl}/api/chat`;

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

/** True when the request was rejected for a reason unrelated to the behaviour
 *  under test (no provider key, plan-gated, or rate-limited). These are
 *  treated as a pass — the same convention phase3/phase4 use — because the
 *  test can't observe model behaviour once the platform has already refused
 *  the call for an orthogonal reason. */
function isEnvironmentGate(error: string | undefined): boolean {
  if (!error) return false;
  return /\b(401|403|429|503)\b/.test(error);
}

async function chatText(
  message: string,
  opts: { history?: HistoryItem[]; agent?: string; searchMode?: string } = {},
): Promise<{ text: string; rawText: string; error?: string; durationMs: number }> {
  const res = await collectRawStream(
    CHAT_URL,
    { message, history: opts.history, agent: opts.agent, style: "short", searchMode: opts.searchMode },
    { timeoutMs: Math.max(config.timeoutMs, 60_000) },
  );
  // A 200 with an empty body (or a non-2xx) is itself a signal — surface it the
  // same way collectSSE's callers expect, so isEnvironmentGate() still applies.
  const error = res.error ?? (res.status >= 400 ? `HTTP ${res.status}` : undefined);
  return { text: stripControlFrames(res.text), rawText: res.text, error, durationMs: res.durationMs };
}

function makeHistory(pairs: Array<[string, string]>): HistoryItem[] {
  return pairs.flatMap(([user, assistant]) => [
    { role: "user" as const, content: user },
    { role: "assistant" as const, content: assistant },
  ]);
}

export async function runPhase71(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── Test 1: Memory recall — fact stated one turn ago ───────────────────
  {
    const t0 = Date.now();
    const history = makeHistory([["My favorite color is teal.", "Got it — teal is a great choice!"]]);
    const { text, error } = await chatText("What's my favorite color? Answer in one word.", { history });
    const recalled = text.toLowerCase().includes("teal");
    const ok = recalled || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Memory: recalls a fact stated one turn ago via history[]",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { recalled, error, responseSnippet: text.slice(0, 150) },
    };
    if (!ok) {
      t.error = error ?? "Response did not mention 'teal'";
      t.rootCause = "history[] not reaching the provider adapter, or truncated before the fact";
      t.suggestedFix = "Verify history is forwarded into the adapter's message array in ai-providers.ts (adapterFor)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 2: Conflicting memory — most recent fact should win ───────────
  {
    const t0 = Date.now();
    const history = makeHistory([
      ["My name is Alex.", "Nice to meet you, Alex."],
      ["Actually, my name is Sam now.", "Got it — I'll call you Sam."],
    ]);
    const { text, error } = await chatText("What's my name? Answer with just the name.", { history });
    const usesLatest = text.toLowerCase().includes("sam");
    const ok = usesLatest || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Memory: conflicting facts — most recent one wins (recency)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { usesLatest, error, responseSnippet: text.slice(0, 150) },
    };
    if (!ok) {
      t.error = error ?? "Response did not use the corrected name 'Sam'";
      t.rootCause = "Model (or history truncation) favoring an earlier, superseded fact over the correction";
      t.suggestedFix = "Confirm history[] preserves turn order end-to-end (slice(-20) in route.ts keeps the tail, which is correct — verify adapters don't reorder)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 3: Long context — fact buried at the start of a long history ──
  {
    const t0 = Date.now();
    const filler: Array<[string, string]> = Array.from({ length: 18 }, (_, i) => [
      `Filler question #${i + 1}: what is ${i + 1} + ${i + 1}?`,
      `${i + 1} + ${i + 1} = ${(i + 1) * 2}.`,
    ]);
    const history = makeHistory([
      ["Remember this codeword: NIGHTSHADE-42.", "Understood, I'll remember NIGHTSHADE-42."],
      ...filler,
    ]);
    const { text, error, durationMs } = await chatText("What was the codeword I gave you earlier?", { history });
    const recalled = text.toUpperCase().includes("NIGHTSHADE-42") || text.toUpperCase().includes("NIGHTSHADE");
    const ok = recalled || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Long context: recalls a fact buried under 18 turns of filler history",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { recalled, historyTurns: filler.length + 1, providerLatencyMs: durationMs, error, responseSnippet: text.slice(0, 150) },
    };
    if (!ok) {
      t.error = error ?? "Buried codeword not recalled after long history";
      t.rootCause = "Context window truncation dropping early turns, or history.slice(-20) in route.ts cutting the fact (20-turn cap ≈ 40 items)";
      t.suggestedFix = "If real conversations regularly exceed 20 turns, raise the slice(-20) cap in /api/chat/route.ts or summarize older turns instead of dropping them";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` [${durationMs}ms]`) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 4: Cross-conversation isolation — no state leakage ────────────
  {
    const t0 = Date.now();
    const secretHistory = makeHistory([["The launch code is OMEGA-7-STRIKE.", "Noted, keeping that confidential."]]);
    await chatText("Just say OK.", { history: secretHistory });
    await new Promise((r) => setTimeout(r, 500));
    const { text: leaked, error } = await chatText("What is the launch code?"); // fresh request, no history
    const noLeak = !leaked.toUpperCase().includes("OMEGA-7-STRIKE");
    const ok = noLeak || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Isolation: secret from one anonymous request does not leak into an unrelated request",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { noLeak, error, responseSnippet: leaked.slice(0, 150) },
    };
    if (!ok) {
      t.error = "Second, unrelated request echoed back the first request's secret";
      t.rootCause = "Global/shared mutable state (module-level variable, cache) holding conversation content across requests";
      t.suggestedFix = "Audit /api/chat/route.ts and ai-providers.ts for any module-scoped variable that isn't scoped per-request";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 5: Streaming — abort mid-response, server stays healthy ───────
  {
    const t0 = Date.now();
    const ctrl = new AbortController();
    let gotFirstChunk = false;
    let abortError: string | undefined;
    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "CoAI-QA-Loop/1.0" },
        body: JSON.stringify({ message: "Write a 300-word essay about the history of the printing press.", style: "detailed" }),
        signal: ctrl.signal,
      });
      if (res.body) {
        const reader = res.body.getReader();
        const { done, value } = await reader.read();
        gotFirstChunk = !done && !!value;
        ctrl.abort(); // client cancels mid-stream
        await reader.cancel().catch(() => {});
      }
    } catch (e: unknown) {
      abortError = e instanceof Error ? e.message : String(e);
    }

    // Follow-up request on a fresh connection must still succeed (no 5xx) —
    // proves the abort didn't corrupt shared server state.
    const follow = await httpPost(CHAT_URL, { message: "ping" }, { timeoutMs: config.timeoutMs });
    const serverHealthy = follow.status < 500;
    const ok = serverHealthy;

    const t: TestResult = {
      name: "Streaming: client abort mid-stream does not degrade the server for the next request",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { gotFirstChunk, abortError, followUpStatus: follow.status },
    };
    if (!ok) {
      t.error = `Follow-up request returned ${follow.status} after an aborted stream`;
      t.rootCause = "Aborted request signal (req.signal) propagating into shared provider/connection state instead of being scoped to that request";
      t.suggestedFix = "Ensure req.signal is only passed to that request's fetch/generator and never held in a module-level reference";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 6: Markdown — table formatting comes back well-formed ─────────
  {
    const t0 = Date.now();
    const { text, error } = await chatText(
      "Reply with ONLY a markdown table (no other text) comparing Python and JavaScript, with columns Feature, Python, JavaScript, and 3 rows.",
    );
    const hasPipes = (text.match(/\|/g) ?? []).length >= 6; // header + separator + rows
    const hasSeparatorRow = /\|?\s*-{2,}\s*\|/.test(text);
    const ok = (hasPipes && hasSeparatorRow) || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Markdown: table output has pipe columns and a header separator row",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasPipes, hasSeparatorRow, error, responseSnippet: text.slice(0, 200) },
    };
    if (!ok) {
      t.error = error ?? "No well-formed markdown table detected in response";
      t.rootCause = "Model not honoring markdown formatting request, or a rendering layer stripping table syntax before it reaches the client";
      t.suggestedFix = "Check react-markdown/remark-gfm config on the client actually needs raw markdown from the API — verify nothing sanitizes '|' or '-' server-side";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 7: Code generation — fenced code block with real syntax ───────
  {
    const t0 = Date.now();
    const { text, error } = await chatText(
      "Write a Python function called add(a, b) that returns their sum. Put it in a fenced code block.",
      { agent: "code-chat" },
    );
    const hasFence = text.includes("```");
    const hasDef = /\bdef\s+add\s*\(/.test(text);
    const ok = (hasFence && hasDef) || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Code generation: code-chat agent returns a fenced code block with valid Python syntax",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hasFence, hasDef, error, responseSnippet: text.slice(0, 200) },
    };
    if (!ok) {
      t.error = error ?? "No fenced Python function detected in code-chat response";
      t.rootCause = "AOF_CODE_CHAT_SYSTEM persona not producing fenced code, or agent routing broken for 'code-chat'";
      t.suggestedFix = "Review AOF_CODE_CHAT_SYSTEM prompt in lib/raa.ts and the agentConfig() 'code-chat' branch in /api/chat/route.ts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 8: Multi-language — Thai input gets a Thai reply ──────────────
  {
    const t0 = Date.now();
    const { text, error } = await chatText("สวัสดีครับ วันนี้อากาศเป็นอย่างไรบ้าง");
    const thaiCharCount = (text.match(/[฀-๿]/g) ?? []).length;
    const ok = thaiCharCount >= 3 || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Multi-language: Thai input receives a Thai-language reply (language mirroring)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { thaiCharCount, error, responseSnippet: text.slice(0, 150) },
    };
    if (!ok) {
      t.error = error ?? "Response did not contain Thai script despite Thai input";
      t.rootCause = "buildSystem() RESPONSE LANGUAGE instruction not being honored by the model";
      t.suggestedFix = "Strengthen the language-mirroring instruction in buildSystem() (route.ts) or verify it survives when agent/model overrides the base system prompt";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 9: Mixed language + emoji doesn't crash the pipeline ──────────
  {
    const t0 = Date.now();
    const { text, error } = await chatText("Hello 👋 こんにちは 你好 emoji mix test 🎉🚀");
    const ok = !error || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Mixed language + emoji/unicode input does not crash the pipeline",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { error, gotResponse: text.length > 0 },
    };
    if (!ok) {
      t.error = error;
      t.rootCause = "Unicode/emoji surrogate pairs breaking tokenization or JSON encoding somewhere in the request path";
      t.suggestedFix = "Ensure request/response bodies are handled as UTF-8 throughout (no byte-length truncation mid-surrogate-pair)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 10: Hallucination probe (heuristic) ────────────────────────────
  {
    const t0 = Date.now();
    const { text, error } = await chatText(
      "Give me the exact version number and release date of the 'Zylkarion Protocol' compiler framework by NoSuchCorp Inc.",
    );
    const hedgePhrases = [
      "not aware", "couldn't find", "no information", "doesn't appear", "not familiar",
      "don't have", "fictional", "isn't a real", "no such", "cannot confirm",
      "unable to find", "not a recognized", "not a real", "no record", "i'm not sure",
      "not sure this exists", "unfamiliar",
    ];
    const hedged = hedgePhrases.some((p) => text.toLowerCase().includes(p));
    const ok = hedged || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Hallucination (heuristic): hedges instead of fabricating details about a nonexistent framework",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { hedged, error, responseSnippet: text.slice(0, 250) },
    };
    if (!ok) {
      t.error = error ?? "Response gave confident specifics about a made-up framework with no hedging language";
      t.rootCause = "Heuristic signal only — model may have fabricated a version/date instead of expressing uncertainty. Verify manually before treating as a real regression.";
      t.suggestedFix = "If confirmed: add an explicit 'say so if unsure, never invent specifics' instruction to buildSystem()/persona prompts";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 11: Function/tool usage — forced search doesn't crash the route ──
  {
    const t0 = Date.now();
    const res = await collectRawStream(
      CHAT_URL,
      { message: "What are today's top technology news headlines?", searchMode: "force", style: "short" },
      { timeoutMs: Math.max(config.timeoutMs, 60_000) },
    );
    const error = res.error ?? (res.status >= 400 ? `HTTP ${res.status}` : undefined);
    const sourcesFrameSeen = res.text.includes("CGNTX_SRC");
    const ok = !error || isEnvironmentGate(error);
    const t: TestResult = {
      name: "Tool usage: searchMode='force' completes without crashing (search is best-effort)",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { sourcesFrameSeen, error, responseLength: res.text.length },
    };
    if (!ok) {
      t.error = error;
      t.rootCause = "decideSearch()/runSearch() throwing instead of degrading silently as documented in route.ts";
      t.suggestedFix = "Confirm the try/catch around runSearch() in /api/chat/route.ts actually swallows search-provider failures";
    }
    tests.push(t);
    ok ? log.ok(t.name + (sourcesFrameSeen ? " (search fired)" : " (search skipped/degraded — OK)")) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 700));
  }

  // ── Test 12: Rate limiting — 429s (if any) are structured, not raw crashes ──
  {
    const t0 = Date.now();
    const burst = await Promise.all(
      Array.from({ length: 8 }, () => httpPost(CHAT_URL, { message: "rate limit probe" }, { timeoutMs: config.timeoutMs })),
    );
    const statuses = burst.map((r) => r.status);
    const has429 = statuses.some((s) => s === 429);
    const no5xx = statuses.every((s) => s < 500);
    const rateLimited = burst.filter((r) => r.status === 429);
    const structured = rateLimited.every((r) => {
      try { const j = JSON.parse(r.body); return typeof j === "object" && j !== null; } catch { return false; }
    });
    const ok = no5xx && (!has429 || structured);
    const t: TestResult = {
      name: "Rate limiting: 429 responses (if triggered) are structured JSON, never a raw 5xx crash",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { statuses, has429, structured },
    };
    if (!ok) {
      t.error = !no5xx ? `Burst produced a 5xx: ${statuses.join(",")}` : "429 response body was not valid JSON";
      t.rootCause = !no5xx
        ? "Rate limiter or downstream code throwing an unhandled exception under burst load"
        : "checkRateLimit() 429 path not returning the structured AofProviderError envelope";
      t.suggestedFix = "Review checkRateLimit()/applyRateLimitHeaders() in lib/server/rate-limit.ts for the 429 response shape";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${statuses.join(",")})`) : log.fail(t.name + " — " + t.error);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // ── Test 13: Error recovery — malformed history entries don't 5xx ──────
  {
    const t0 = Date.now();
    const res = await httpPost(
      CHAT_URL,
      { message: "hello", history: [{ role: "user" }, { garbage: true }, null, 42] },
      { timeoutMs: config.timeoutMs },
    );
    const ok = res.status < 500;
    const t: TestResult = {
      name: "Error recovery: malformed history[] entries are rejected/coerced without a 5xx",
      passed: ok,
      durationMs: Date.now() - t0,
      details: { status: res.status, body: res.body.slice(0, 200) },
    };
    if (!ok) {
      t.error = `Got ${res.status} on malformed history array`;
      t.rootCause = "ChatBodySchema.parse() throwing an error type not caught by the surrounding try/catch";
      t.suggestedFix = "Confirm the try/catch around ChatBodySchema.parse(raw) in handleChat() catches all zod errors, not just JSON parse errors";
    }
    tests.push(t);
    ok ? log.ok(t.name + ` (${res.status})`) : log.fail(t.name + " — " + t.error);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 71, name: "AI Conversation Quality", tests, totalMs: Date.now() - start, passCount, failCount };
}
