# Provider & API-Key Audit — Co.AI

**Date:** 2026-06-21 · **Branch:** `audit/production-hardening`

## Model
Keys are sourced from **env vars** and **per-user keys** (Settings → API Keys, stored AES-256-GCM encrypted). Per-user keys override env. Provider availability is computed per request; an unconfigured provider is simply removed from the routing order. This is the correct "fail-soft + clear error" design.

## Per-provider status

| Provider | Configured via | Behavior |
|----------|----------------|----------|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` (+ `@anthropic-ai/sdk`) | primary chat provider |
| OpenRouter | `OPENROUTER_API_KEY` | secondary / failover |
| Google Gemini | registry-routed model | task-aware model pick |
| DeepSeek | registry-routed | task-aware |
| Qwen / Llama | registry-routed | task-aware |
| Tavily (search) | `TAVILY_API_KEY` | keyed search, fails soft to `[]` |
| Google CSE (search) | `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | keyed search |
| GitHub / Wikipedia / Reddit (search) | keyless | always-on baseline |

> The audit brief listed OpenAI, Groq, Cohere, Mistral. These are **not** wired in this codebase — the active chat providers are Anthropic → OpenRouter, plus the registry models (Gemini/DeepSeek/Qwen/Llama) and the search providers above. No dead OpenAI/Groq/Cohere/Mistral integrations to remove.

## Key validation & error handling (already present)
The unified error catalog (`aof-web/src/lib/errors`) classifies provider failures into `AOF_ERROR_001…013` and maps them to HTTP status + user-facing copy (`api/chat/route.ts:149-170`):

| Condition | Code | Status | User sees |
|-----------|------|--------|-----------|
| Missing key (all providers) | `AOF_ERROR_001` | 503 | which env vars to set / save a key in Settings |
| Invalid/expired/auth | `AOF_ERROR_002/003/010` | 401 | auth failure, re-check key |
| Quota/billing | `AOF_ERROR_004` | 402 | billing issue |
| Rate limit | `AOF_ERROR_005` | 429 | retry-after seconds |
| Timeout | `AOF_ERROR_008` | 504 | provider slow, failed over |
| Upstream/provider | `006/007/011/012` | 502 | provider problem |

Mid-stream failures and failover are emitted as in-band control frames so the UI can show "failed over A → B" without losing the stream.

## Verdict
Provider/key handling is **production-grade**. No fixes required. The user-friendly error messages the brief asked to "add" already exist.

**Provider issues fixed:** 0 (none found).
