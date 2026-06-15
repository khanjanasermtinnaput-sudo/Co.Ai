# Working Memory — Current Session Facts

> Managed by the `remember` plugin. Updated automatically each session.
> Do not edit manually — changes will be overwritten.

## Architecture Decisions (locked)
- ROLE_PROVIDER is config-only — never hardcode model inside agent functions
- All keys flow through CredentialBag — never process.env inside agents
- Blackboard is the only shared state between agents
- SSE event shape {role, text, kind} is frozen (backward-compatible)
- DARS wraps chat() via chatWithDARS() — never modifies chat() itself
- Vercel /tmp is ephemeral — all persistence goes to Supabase

## Current Sprint Focus
- Phase 1: DARS implementation (src/dars/)
- Phase 1: Login rate-limit / lockout (PIN entropy is low)
- Phase 1: agent_logs + events DB tables

## Known Active Issues
- blackboard.persist() writes to /tmp/.aof (Vercel ephemeral) — must migrate to tasks table
- validator.ts only checks JS syntax via `node --check` — not multi-language
- No server-side rate limiting on /v1/auth/login (brute-force risk with 4-digit PIN)

## Session Log
<!-- remember plugin appends session summaries here -->
