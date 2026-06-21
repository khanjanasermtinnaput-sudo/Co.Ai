# Provider Health Audit — Co.Ai / Coagentix

**Generated:** 2026-06-21  
**Scope:** Full codebase — `aof-web` (Next.js frontend + API), `tmap-v2` (Express backend / TMAP pipeline), `coagentix-cli`  
**Audited providers:** Anthropic, OpenRouter, Gemini, DeepSeek, Groq (Llama), Qwen — plus absent providers (OpenAI direct, Cohere, Mistral)

---

## Executive Summary

The codebase has a **well-architected, layered provider abstraction** across both the web app and the backend pipeline. The core error-handling model is mature: every error is classified into a typed code (AOF_ERROR_001–013), never swallowed silently, and drives both user-visible messages and failover decisions. Most of the gaps identified below are **missing hardening** on specific error sub-cases, not structural flaws.

**Providers fully wired:** Anthropic, OpenRouter, Gemini, DeepSeek, Qwen, Llama (Groq)  
**Providers NOT integrated:** OpenAI (direct), Cohere, Mistral  

---

## 1. Provider Integration Map

### aof-web (chat streaming layer)

**File:** `aof-web/src/lib/server/ai-providers.ts`

Six providers are registered in `PROVIDER_REGISTRY`:

| Provider ID | Label            | Env Var            | Default Model              | Priority |
|-------------|------------------|--------------------|----------------------------|----------|
| anthropic   | Claude (Anthropic) | ANTHROPIC_API_KEY | claude-haiku-4-5-20251001 | 1 |
| gemini      | Google Gemini    | GEMINI_API_KEY     | gemini-2.5-flash           | 2 |
| deepseek    | DeepSeek         | DEEPSEEK_API_KEY   | deepseek-chat              | 3 |
| qwen        | Qwen (DashScope) | QWEN_API_KEY       | qwen-plus                  | 4 |
| llama       | Llama (Groq)     | LLAMA_API_KEY      | llama-3.3-70b              | 5 |
| openrouter  | OpenRouter       | OPENROUTER_API_KEY | google/gemma-4-31b-it:free | 6 |

**API Connectivity:**
- Anthropic: uses `@anthropic-ai/sdk` via `anthropic.messages.stream()`
- OpenRouter: raw `fetch()` to `https://openrouter.ai/api/v1/chat/completions` with SSE parsing
- Gemini, DeepSeek, Qwen, Llama (Groq): raw `fetch()` via a shared OpenAI-compatible adapter `openAiCompatTextStream()` hitting `{baseUrl}/chat/completions`

### tmap-v2 (TMAP pipeline layer)

**File:** `tmap-v2/src/providers/client.ts`, `tmap-v2/src/config.ts`

Same four non-Anthropic providers (Gemini, DeepSeek, Qwen, Llama) are wired in non-streaming mode via `fetch()`. Wrapped in a DARS (Dynamic Agent Routing System) at `tmap-v2/src/dars/run.ts`.

---

## 2. Per-Provider Analysis

### 2.1 Anthropic (Claude)

**Files:** `aof-web/src/lib/server/ai-providers.ts` lines 233–259, 730–732

#### API Connectivity
Uses the official `@anthropic-ai/sdk` package:
```ts
const anthropic = new Anthropic({ apiKey: apiKeyFor(meta, input.overrides)! });
const stream = anthropic.messages.stream({ model, max_tokens, temperature, system, messages }, { signal });
```

#### Invalid Key Handling (401)
Handled via the unified `toAofError()` -> `classifyProviderError()`. The SDK throws with `status: 401`. The classifier maps:
- `"invalid"` in message -> `AOF_ERROR_002` (Invalid API Key)
- `"expire"` in message -> `AOF_ERROR_003` (Expired API Key)
- Generic 401 -> `AOF_ERROR_010` (Authentication Failure)

**NOTE:** The Anthropic SDK error (`AuthenticationError`) carries `type: "authentication_error"`, which `classifyProviderError` correctly maps from the `errorType` field. The code reads `e.error?.error ?? e.error` to extract this type — a double-nested path that works correctly with the current SDK version.

#### Missing Key Handling
`apiKeyFor()` returns `undefined` when env var is missing/empty. The non-null assertion operator (`!`) is used: `apiKeyFor(meta, input.overrides)!`. This will throw a runtime exception if called with no key. `configuredProvidersForOrder()` filters out unconfigured providers before calling the adapter, preventing this in normal operation.

**ISSUE:** The `anthropicTextStream` function does not check whether the key is present before creating the `Anthropic` client. It relies entirely on the caller having filtered correctly via `configuredProvidersForOrder()`. A bug in the filter logic would cause an SDK initialization with an empty key that fails at call time rather than returning a clean `AOF_ERROR_001`.

#### Expired Key Handling
Anthropic returns 401 with `"token has expired"` in the message body. The classifier matches `/expire/` -> `AOF_ERROR_003`. This is correctly distinguished from an invalid key.

#### Quota Exceeded Handling
Anthropic returns 429 with quota-related language OR 402. The classifier checks for `/quota|billing|credit|insufficient|monthly|spending|out of/` in the message to distinguish `AOF_ERROR_004` (quota) from `AOF_ERROR_005` (rate limit). 402 unconditionally maps to `AOF_ERROR_004`. Correct.

#### Model Not Found Handling
404 -> `AOF_ERROR_009` (Invalid Model). Also 400/422 with "model" in the body -> `AOF_ERROR_009`. Correctly handled.

#### Timeout Handling
**ISSUE (HIGH):** No explicit timeout is set on the Anthropic SDK `messages.stream()` call. The only timeout mechanism is the `req.signal` from Next.js, which uses `maxDuration = 60` (line 80 of route.ts). The SDK will hang until the platform kills the request if Anthropic is very slow. Compare: OpenRouter has an explicit `firstTokenDeadlineMs()` (default 6000ms) per model; the health ping uses 8000ms via `AbortController`. The chat path for Anthropic has no equivalent.

**Recommended fix:** Add an `AbortController` with a configurable `ANTHROPIC_TIMEOUT_MS`:
```ts
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 55_000));
try {
  const stream = anthropic.messages.stream({ ... }, { signal: ctrl.signal });
  // ...
} finally { clearTimeout(timer); }
```

#### Retry Logic
**ISSUE (MEDIUM):** None. No automatic retry exists for the Anthropic adapter. A single transient 503 from Anthropic causes immediate failover to the next provider. The OpenRouter adapter has up to 3 retries with 300ms/800ms backoff for transient statuses (`TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])`), but this is not replicated for Anthropic.

**Recommended fix:** Apply the same retry pattern from `openrouterConnect` to the Anthropic adapter before cascading to failover.

#### Fallback Logic
The `handleChat` route (`aof-web/src/app/api/chat/route.ts`, lines 311–363) iterates `configuredProvidersForOrder(routeOrder(task))` and tries each provider in sequence. If Anthropic fails with a `failoverWorthy` error code (all codes except `AOF_ERROR_013`), the route emits a `FailoverNotice` frame and continues to the next provider.

---

### 2.2 OpenRouter

**Files:** `aof-web/src/lib/server/ai-providers.ts` lines 261–467

#### API Connectivity
Raw `fetch()` to `https://openrouter.ai/api/v1/chat/completions` with SSE streaming.

#### Invalid Key Handling (401)
`FATAL_STATUSES = new Set([401, 403])`. A 401 from any model in the chain immediately throws without trying the next model (line 455: `if (FATAL_STATUSES.has(thrown.status)) throw thrown`). This is correct — retrying with the same bad key across free models is wasteful. Error propagates to `toAofError()` -> `AOF_ERROR_002/010`.

#### Missing Key Handling
Same `apiKeyFor()! ` pattern with upstream filtering. The OpenRouter health ping hits `/api/v1/key` to verify validity before the first chat request.

#### Expired Key Handling
**ISSUE (LOW):** OpenRouter does not return a distinct "expired key" error; it returns 401 with various messages. Since `/expire/` is not typically in OpenRouter's 401 body, these fall through to `AOF_ERROR_010` (Authentication Failure) rather than `AOF_ERROR_003` (Expired Key). Not a practical problem since OpenRouter keys don't expire.

#### Quota Exceeded Handling
429 is in `TRANSIENT_STATUSES` and is retried (up to 3 times per model in single-model mode, or once per model in multi-model chain mode). After exhausting retries, it is classified as `AOF_ERROR_004` or `AOF_ERROR_005` depending on the message body. Correct.

#### Model Not Found Handling
Within the adapter, an unknown model triggers `lastError` and falls through to the next model in the chain — correct behavior for free model chains. After all models are exhausted, the error surfaces as `AOF_ERROR_009`.

#### Timeout Handling
**First-token timeout:** `firstTokenDeadlineMs()` defaults to 6000ms (overridable via `OPENROUTER_FIRST_TOKEN_MS`). When a model takes too long to emit its first token, the per-model `AbortController` fires, marks `timedOut = true`, and the next model is tried.

**ISSUE (LOW):** There is no maximum total duration across the entire model chain. With 4 fallback models x 6 second first-token deadline, a worst-case scenario could take 24+ seconds in timeouts before throwing.

#### Retry Logic
Strong: up to `OPENROUTER_MAX_ATTEMPTS = 3` retries per model with `OPENROUTER_BACKOFF_MS = [300, 800]` ms backoff. When multiple models are in the chain, each model gets 1 attempt (the chain is the resilience). Mid-stream errors on already-started streams propagate immediately without retry (correct — no token duplication risk).

#### Fallback Logic
Two levels:
1. **Intra-adapter:** Free model chain (primary model -> `OPENROUTER_FREE_FALLBACKS`)
2. **Inter-provider:** If all models fail, the `handleChat` provider loop moves to the next configured provider.

OpenRouter is always last in `routeOrder()`, acting as the final catch-all gateway.

---

### 2.3 Gemini (Google)

**Files:** `aof-web/src/lib/server/ai-providers.ts` lines 545–585, `tmap-v2/src/config.ts` lines 16–23

#### API Connectivity
aof-web: OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, Bearer token, SSE streaming.  
tmap-v2: Same endpoint, non-streaming.

#### Invalid Key Handling
**ISSUE (MEDIUM):** Google returns **400** (not 401) for invalid API keys with a message like `"API key not valid"`. The classifier checks for `"model"` in a 400 body for `AOF_ERROR_009`, but `"API key not valid"` does not contain "model". This falls through to `AOF_ERROR_012` (Unknown Provider Error).

**Affected file:** `aof-web/src/lib/errors.ts`, `classifyProviderError()`, lines 293–296:
```ts
if (status === 400 || status === 422) {
  if (/model/.test(both))
    return build("AOF_ERROR_009", ...);
  return build("AOF_ERROR_012", ...);  // <-- Gemini invalid key lands here
}
```

**Recommended fix:**
```ts
if (status === 400 || status === 422) {
  if (/api key|credentials|not valid|invalid key|api_key/i.test(both))
    return build("AOF_ERROR_002", input, `${input.provider} rejected the API key.`);
  if (/model/.test(both))
    return build("AOF_ERROR_009", ...);
  return build("AOF_ERROR_012", ...);
}
```

#### Missing Key Handling
Standard `configuredProvidersForOrder` filter. tmap-v2 falls back to mock mode.

#### Quota Exceeded Handling
**ISSUE (MEDIUM):** Gemini returns 429 with `"RESOURCE_EXHAUSTED"` for quota exceeded. The 429 quota classifier checks `/quota|billing|credit|insufficient|monthly|spending|out of/` — none of which match `"RESOURCE_EXHAUSTED"`. Gemini quota-exceeded errors are classified as `AOF_ERROR_005` (Rate Limit) instead of `AOF_ERROR_004` (Quota Exceeded).

**Affected file:** `aof-web/src/lib/errors.ts`, line 289:
```ts
if (/quota|billing|credit|insufficient|monthly|spending|out of/.test(both))
  return build("AOF_ERROR_004", ...);
```

**Recommended fix:** Add `resource_exhausted|exceeded your` to the pattern.

#### Model Not Found Handling
Gemini returns 404 for unknown models -> `AOF_ERROR_009`. Correctly handled.

#### Timeout Handling (aof-web)
**ISSUE (HIGH):** `openAiCompatConnect` does NOT set a per-call timeout. It only passes `input.signal` (user stop / Next.js request signal). There is no first-token deadline comparable to the OpenRouter adapter's 6000ms.

If Gemini's API hangs (no response for 60s), the streaming generator hangs until Next.js kills the function at `maxDuration = 60`. No structured error is produced; the user gets an opaque connection reset.

**Affected file:** `aof-web/src/lib/server/ai-providers.ts`, `openAiCompatTextStream()`, lines 545–585.

**Recommended fix:** Add a first-token deadline wrapper:
```ts
const COMPAT_FIRST_TOKEN_MS = Number(process.env.COMPAT_FIRST_TOKEN_MS ?? 15_000);
// AbortController that fires if no first token arrives within deadline
```

#### Timeout Handling (tmap-v2)
`client.ts` line 43: `const timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS ?? 60_000)`. Hard `AbortController` timeout is set. Default 60s. Configurable. Correct.

#### Retry Logic (aof-web)
`openAiCompatConnect` uses up to `COMPAT_MAX_ATTEMPTS = 3` retries with `COMPAT_BACKOFF_MS = [300, 800]` ms for `TRANSIENT_STATUSES`. Mirrors OpenRouter. Correct.

#### Fallback Logic
Priority 2 in aof-web for chat/research/reasoning; priority 4 for coding. tmap-v2 DARS scores Gemini highest for the planner role (0.90 capability score).

---

### 2.4 DeepSeek

**Files:** `aof-web/src/lib/server/ai-providers.ts` (shared OpenAI-compat adapter), `tmap-v2/src/config.ts` lines 24–31

#### API Connectivity
Both layers: `https://api.deepseek.com/v1/chat/completions`, Bearer token.

#### Invalid Key Handling
DeepSeek returns 401 with `"Invalid API key"`. Classifier matches `"invalid"` at status 401 -> `AOF_ERROR_002`. Correctly handled.

#### Missing Key Handling
Standard pattern. tmap-v2 falls back to mock mode.

#### Quota Exceeded Handling
DeepSeek returns **402** for insufficient balance. Classifier correctly maps 402 -> `AOF_ERROR_004`. Correct.

#### Model Not Found Handling
404 -> `AOF_ERROR_009`. 400 with "model" -> `AOF_ERROR_009`. DeepSeek returns 400 for unknown model IDs. Correctly handled.

#### Timeout Handling (aof-web)
**ISSUE (HIGH):** Same as Gemini — no first-token deadline in `openAiCompatConnect`. DeepSeek's `deepseek-reasoner` model has long thinking times (30–120s for complex prompts). The 60-second `maxDuration` on the API route may be insufficient and will produce an opaque platform timeout rather than a structured `AOF_ERROR_008`.

**Affected file:** `aof-web/src/lib/server/ai-providers.ts`, `openAiCompatTextStream()`, lines 545–585.

#### Retry Logic
`COMPAT_MAX_ATTEMPTS = 3`, `COMPAT_BACKOFF_MS = [300, 800]`. Transient errors (429, 500-504) are retried. Correct.

#### Fallback Logic
Priority 3 for chat/research, priority 2 for coding in aof-web. tmap-v2 DARS scores DeepSeek highest for coder role (0.92). 

---

### 2.5 Qwen (DashScope/Alibaba)

**Files:** `aof-web/src/lib/server/ai-providers.ts`, `tmap-v2/src/config.ts` lines 32–44

#### API Connectivity
Endpoint: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions`

#### Env Var Inconsistency
**ISSUE (LOW):** Two env var names — `QWEN_API_KEY` (primary) and `DASHSCOPE_API_KEY` (legacy, tmap-v2 only). aof-web only checks `QWEN_API_KEY`. A user who set `DASHSCOPE_API_KEY` for their tmap-v2 deployment will find Qwen works in the pipeline but not in the aof-web chat API.

**Affected file:** `aof-web/src/lib/server/ai-providers.ts`, `apiKeyFor()` (lines 102–107) — no legacy key fallback.

#### Invalid Key Handling
DashScope returns 401 with `"InvalidApiKey"` -> `"invalid"` matched -> `AOF_ERROR_002`. Correct.

#### Quota Exceeded Handling
DashScope returns 429 with error code `QuotaExceeded` for quota and `Throttling` for rate limits.

**ISSUE (LOW):** `"Throttling"` does not match the rate-limit keyword pattern `/rate_?limit|overloaded|too_many/`. It would fall through to `AOF_ERROR_012` (Unknown Provider Error) if the HTTP status alone isn't 429 with quota keywords.

**Affected file:** `aof-web/src/lib/errors.ts`, line 306:
```ts
if (/rate_?limit|overloaded|too_many/.test(type)) return build("AOF_ERROR_005", ...);
```

**Recommended fix:** Add `throttl` to the pattern: `/rate_?limit|overloaded|too_many|throttl/`.

#### Timeout Handling
Same issue as Gemini/DeepSeek in aof-web (no first-token deadline). tmap-v2 has the 60s `PROVIDER_TIMEOUT_MS`.

#### Retry Logic
3 attempts with backoff. Correct.

#### Fallback Logic
Priority 4 in aof-web. tmap-v2 DARS scores Qwen highest for reviewer role (0.86).

---

### 2.6 Llama (Groq)

**Files:** `aof-web/src/lib/server/ai-providers.ts`, `tmap-v2/src/config.ts` lines 45–54

#### API Connectivity
Endpoint: `https://api.groq.com/openai/v1/chat/completions`

#### Model ID Mismatch
**ISSUE (HIGH):** aof-web's `PROVIDER_REGISTRY.llama.defaultModel` is `"llama-3.3-70b"` (line 93 of `ai-providers.ts`). Groq's actual model ID is **`"llama-3.3-70b-versatile"`**. Sending `"llama-3.3-70b"` to Groq returns a 404 Model Not Found error, classified as `AOF_ERROR_009`. Every direct Llama request with default settings fails immediately and falls over.

**Affected file:** `aof-web/src/lib/server/ai-providers.ts`, line 93:
```ts
defaultModel: "llama-3.3-70b",  // WRONG — Groq requires "llama-3.3-70b-versatile"
```

**Recommended fix:**
```ts
defaultModel: "llama-3.3-70b-versatile",
```

#### Env Var Inconsistency
**ISSUE (LOW):** Same as Qwen — `GROQ_API_KEY` works in tmap-v2 (via `legacyEnvKey`) but not in aof-web, which only checks `LLAMA_API_KEY`.

#### Invalid Key Handling
Groq returns 401 with `"Invalid API Key"` -> `AOF_ERROR_002`. Correct.

#### Quota Exceeded Handling
Groq's free tier is rate-based, not quota-based. 429 with "rate limit" or "tokens per minute" -> `AOF_ERROR_005`. Correct. No `AOF_ERROR_004` concern.

#### Model Not Found Handling
Groq returns 404 for models not on the user's plan -> `AOF_ERROR_009`. Correct (once the model ID mismatch above is fixed).

#### Timeout Handling
Same first-token deadline issue as all OpenAI-compat providers in aof-web. tmap-v2 has 60s timeout.

#### Retry Logic
3 attempts with backoff. Correct.

#### Fallback Logic
Priority 5 in aof-web. tmap-v2 DARS scores Llama highest for validator role (0.82).

---

## 3. Missing Providers

### 3.1 OpenAI (Direct)

**Status: NOT INTEGRATED**

No direct OpenAI (`api.openai.com`) integration exists anywhere in the codebase. The `openai` npm package is not in any `package.json`. `error-codes.ts` line 80 references `AI_001` as "OpenAI Error," but this code is never produced by any actual OpenAI API call.

OpenAI models are accessible only via OpenRouter (e.g., `OPENROUTER_MODEL=openai/gpt-4o`), but there is no dedicated OpenAI adapter with:
- The `openai` SDK for native streaming and structured error types
- `sk-...` key format detection
- OpenAI-specific error types (`AuthenticationError`, `RateLimitError`, etc.)

**Impact:** Users with OpenAI keys cannot use them directly. They must route through OpenRouter.

### 3.2 Cohere

**Status: NOT INTEGRATED**

No Cohere integration. Not in any provider registry, no `COHERE_API_KEY` env var, no adapter, no model registry entry.

### 3.3 Mistral

**Status: NOT INTEGRATED**

No Mistral integration. Not in any provider registry, no `MISTRAL_API_KEY` env var, no adapter, no model registry entry.

---

## 4. Cross-Cutting Gaps

### 4.1 No Retry on Anthropic Adapter

- **Affected:** `aof-web/src/lib/server/ai-providers.ts`, `anthropicTextStream()` (lines 233–259)
- **What's missing:** `TRANSIENT_STATUSES` retry logic (3 attempts, exponential backoff) that exists for OpenRouter and all OpenAI-compat adapters.
- **Risk:** A single transient 503 from Anthropic triggers immediate failover rather than a cheap retry.
- **Fix:** Wrap the `anthropic.messages.stream()` call in a retry loop mirroring `openrouterConnect`.

### 4.2 No First-Token Timeout on OpenAI-Compat Adapters

- **Affected:** `aof-web/src/lib/server/ai-providers.ts`, `openAiCompatTextStream()` (lines 545–585) — applies to Gemini, DeepSeek, Qwen, Llama
- **What's missing:** Per-model `AbortController` that fires if no first token arrives within N seconds (OpenRouter has `firstTokenDeadlineMs()` = 6000ms).
- **Risk:** A slow or queued response can hang the streaming connection until the 60s platform limit, rather than quickly failing over.
- **Fix:** Add a first-token deadline to `openAiCompatTextStream()`:
```ts
const COMPAT_FIRST_TOKEN_MS = Number(process.env.COMPAT_FIRST_TOKEN_MS ?? 15_000);
const firstTokenCtrl = new AbortController();
const firstTokenTimer = setTimeout(() => firstTokenCtrl.abort(), COMPAT_FIRST_TOKEN_MS);
// clear on first yielded delta
```

### 4.3 Gemini Invalid-Key Mapped to Wrong Error Code

- **Affected:** `aof-web/src/lib/errors.ts`, `classifyProviderError()` (lines 293–296)
- **What's missing:** Detection of Gemini's 400 response for invalid API keys.
- **Risk:** Users with a wrong Gemini key see "Unknown Provider Error (400)" instead of "Invalid API Key."
- **Fix:** Add auth-keyword check before generic 400 handling.

### 4.4 Gemini RESOURCE_EXHAUSTED Not Mapped to Quota Error

- **Affected:** `aof-web/src/lib/errors.ts`, `classifyProviderError()` (line 289)
- **What's missing:** `resource_exhausted` keyword in the 429-quota pattern.
- **Risk:** Gemini quota-exceeded users see "Rate Limit Exceeded" instead of "Quota Exceeded," leading to incorrect remediation (wait vs. add billing).
- **Fix:** Extend the pattern to `/quota|billing|credit|insufficient|monthly|spending|out of|resource_exhausted/i`.

### 4.5 Groq Model ID Mismatch

- **Affected:** `aof-web/src/lib/server/ai-providers.ts`, line 93
- **What's missing:** The `-versatile` suffix on the default Groq/Llama model name.
- **Risk:** Every direct Llama request with default settings fails with 404 -> `AOF_ERROR_009` -> immediate failover. Llama is effectively non-functional as a direct provider in aof-web.
- **Fix:** `defaultModel: "llama-3.3-70b-versatile"`

### 4.6 Env Var Naming Inconsistency (Qwen/Llama)

- **Affected:** `aof-web/src/lib/server/ai-providers.ts`, `apiKeyFor()` — does not check `DASHSCOPE_API_KEY` or `GROQ_API_KEY`
- **What's missing:** The legacy env var fallback that tmap-v2's `legacyEnvKey` provides.
- **Risk:** Users who configured deployments using well-known provider key names (`GROQ_API_KEY`, `DASHSCOPE_API_KEY`) will find the aof-web chat API does not see their keys.
- **Fix:** Add a `legacyEnvVar` field to `ProviderMeta` and check it in `apiKeyFor()`.

### 4.7 Qwen Throttling Error Type Not Recognized

- **Affected:** `aof-web/src/lib/errors.ts`, `classifyProviderError()`, line 306
- **What's missing:** `"throttl"` in the rate-limit type pattern.
- **Risk:** DashScope `Throttling` error type may produce `AOF_ERROR_012` instead of `AOF_ERROR_005`.
- **Fix:** Extend pattern to `/rate_?limit|overloaded|too_many|throttl/`.

### 4.8 No Inter-Provider Failover Delay in aof-web

- **Affected:** `aof-web/src/app/api/chat/route.ts`, `handleChat()` (lines 311–363)
- **What's missing:** A small delay between provider attempts (tmap-v2's DARS has 100ms exponential backoff between attempts, line 67–69 of `run.ts`).
- **Risk:** Low. In practice, provider failures are typically key/auth errors, not simultaneous overloads.

### 4.9 Circuit Breaker Not Shared Across Lambda Instances

- **Affected:** `tmap-v2/src/dars/health.ts`, `HealthStore` (line 29)
- **What's missing:** Redis or another shared store backing the in-memory `Map`.
- **Risk:** Cold Vercel/Lambda starts reset all health state; a repeatedly failing provider gets fresh attempts on every new instance.
- **Note:** The code comment (line 2) acknowledges this: "At scale this interface is backed by Redis." Not yet implemented.

---

## 5. tmap-v2 DARS Layer — Circuit Breaker Assessment

| Feature | Status |
|---------|--------|
| Circuit breaker (closed/open/half_open) | Implemented |
| Consecutive-failure threshold (3 failures -> open) | Implemented |
| Exponential backoff cooldown | Implemented |
| Auth failure 24h cooldown | Implemented |
| Quota failure 1h cooldown | Implemented |
| Rate-limit cooldown (Retry-After header aware) | Implemented |
| Low-quality response detection | Implemented |
| EWMA latency tracking | Implemented |
| EWMA success-rate tracking | Implemented |
| Capability-scored provider selection | Implemented |
| Shared state across instances | NOT IMPLEMENTED |

---

## 6. Summary of Issues by Severity

### HIGH (service-impacting)
1. **No first-token timeout on Gemini, DeepSeek, Qwen, Llama adapters in aof-web** — slow providers hang the entire response slot.  
   File: `aof-web/src/lib/server/ai-providers.ts`, `openAiCompatTextStream()`, lines 545–585

2. **Groq model ID mismatch** — `"llama-3.3-70b"` is not a valid Groq model ID; all direct Llama requests fail with 404. Llama is effectively non-functional as a provider.  
   File: `aof-web/src/lib/server/ai-providers.ts`, line 93

3. **No timeout on Anthropic streaming** — Anthropic slow responses hold the 60s response slot.  
   File: `aof-web/src/lib/server/ai-providers.ts`, `anthropicTextStream()`, lines 243–251

### MEDIUM (degraded experience, wrong error code shown to user)
4. **No retry on Anthropic adapter** — transient 503 triggers full provider failover instead of cheap retry.  
   File: `aof-web/src/lib/server/ai-providers.ts`, `anthropicTextStream()`, lines 233–259

5. **Gemini invalid-key returns AOF_ERROR_012 instead of AOF_ERROR_002** — user sees "Unknown Provider Error" not "Invalid API Key."  
   File: `aof-web/src/lib/errors.ts`, `classifyProviderError()`, lines 293–296

6. **Gemini RESOURCE_EXHAUSTED classified as rate limit (AOF_ERROR_005) not quota (AOF_ERROR_004)** — incorrect remediation shown.  
   File: `aof-web/src/lib/errors.ts`, `classifyProviderError()`, line 289

### LOW (edge cases, configuration inconsistencies)
7. **Env var naming inconsistency** — `DASHSCOPE_API_KEY` and `GROQ_API_KEY` work in tmap-v2 but not aof-web.  
   File: `aof-web/src/lib/server/ai-providers.ts`, `apiKeyFor()`, lines 102–107

8. **Qwen `Throttling` error type not matched** — may produce AOF_ERROR_012 instead of AOF_ERROR_005.  
   File: `aof-web/src/lib/errors.ts`, line 306

9. **Circuit breaker not shared across Lambda instances** — health state resets on cold start.  
   File: `tmap-v2/src/dars/health.ts`, line 29

10. **No inter-provider failover delay in aof-web** — fast cascade may compound load; tmap-v2 DARS has this but aof-web does not.  
    File: `aof-web/src/app/api/chat/route.ts`, `handleChat()`, lines 311–363

### NOT INTEGRATED (out of scope for hardening unless adoption is planned)
11. **OpenAI direct** — accessible only via OpenRouter routing; no dedicated adapter
12. **Cohere** — no integration
13. **Mistral** — no integration

---

## 7. What Is Working Well

- **Unified error classification** (`AOF_ERROR_001–013`) with user-facing problem/solution messaging. Applied consistently in aof-web. Backed by 30+ unit tests in `aof-web/src/tests/errors.test.ts`.
- **Secret redaction** before logging (`redact()` in `errors.ts` lines 159–171). Tested.
- **Failover transparency** — UI receives `FailoverNotice` and `ModelNotice` frames that explain which provider is answering and why a switch occurred.
- **Key priority system** — user-saved per-account keys (`keys-store.ts`) always beat operator env vars; keys never leak to the client.
- **OpenRouter free-model chain** with first-token deadline, per-model retry, and multi-model fallback is the most resilient adapter in the codebase.
- **DARS circuit breaker** in tmap-v2 is well-designed with appropriate cooldown policies per failure type (auth/quota/rate-limit/transient).
- **Abort signal propagation** — user Stop button (`AbortController`) cancels in-flight requests all the way to the provider.
- **Mock mode fallback** in tmap-v2 — when no keys at all are configured, pipeline continues with simulated responses and clearly labels them as mock.
- **Test coverage** of streaming edge cases: `provider-stream.test.ts` covers priming, mid-stream failures, retries, model chain fallback, fatal status short-circuit, first-token timeout, and wire-protocol frame decoding.
