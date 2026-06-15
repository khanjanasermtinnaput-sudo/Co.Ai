# Long-Term Memory — Cross-Session Architectural Decisions

> Managed by the `remember` plugin. Contains decisions that should never be lost.

## Project Identity
- Aof = professional AI platform, not a generic chatbot
- TMAP = Technology Multi-AI Agent Processing (4 roles: Planner/Coder/Reviewer/Validator)
- Target audience: developers who want multi-model AI coding assistance
- Design philosophy: "ของที่สร้างไปแล้ว = รักษาไว้ ไม่รื้อ" (preserve what works, add only)

## Technology Choices (rationale)
- TypeScript ESM (not CJS): future-proof, tree-shakeable, required .js extensions in imports
- tsx runtime: fast iteration without build step in development
- OpenAI-compatible client: single chat() function works with ALL providers — critical for DARS
- Supabase over direct Postgres: managed auth, realtime, RLS out of box
- Vercel for aof-web: zero-config Next.js deployment, edge functions, CI/CD
- Render for tmap-v2: persistent server (Vercel timeout too short for TMAP loop in pro mode)

## Design System Decisions
- Dark-first (#0A0A0A base, #F59E0B gold accent) — immovable brand choice
- Glass surfaces (.glass class) — used everywhere, don't add opaque cards
- Inter + JetBrains Mono — font pairing is intentional, not configurable
- HSL CSS vars only — no hardcoded colour values anywhere

## API Contract Decisions
- /v1/run is SSE-only (not REST) — client MUST handle EventSource / ReadableStream
- SSE events are append-only — new event kinds can be added, existing ones never renamed
- Bearer token auth for all /v1/* routes — cookie auth was explicitly rejected
- Masked key format in /v1/me — raw keys never transmitted, ever

## DARS Design Decisions
- Capability scores are data-driven (from agent_logs), not hardcoded — must remain evolvable
- Circuit breaker has 3 states (closed/open/half_open) — standard pattern, don't simplify
- MAX_FAILOVER = 4 attempts (one per available provider) — beyond 4, fail the job
- Diversity bonus (+0.15) in scoring prevents always picking same backup provider

## Memory Architecture Decisions
- 6 layers maps to AOF_CODE_TDD.md §6 exactly — implement in this order
- Layer 6 (Agent Memory) must be implemented alongside DARS (they feed each other)
- pgvector over Qdrant for MVP (already have Supabase) — migrate to Qdrant at 10K+ users
- Embedding dimension: 1024 (balanced cost vs quality for code retrieval)
