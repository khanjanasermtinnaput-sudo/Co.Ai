# Performance Report — Co.AI

**Date:** 2026-06-21 · **Branch:** `audit/production-hardening`

## Summary
No performance defects requiring code changes. The streaming/AI paths are already efficient. One scaling note for large user bases.

| Area | Observation |
|------|-------------|
| React rendering | App Router; components are server-leaning, client components scoped (`"use client"` only where needed, e.g. `markdown.tsx`) |
| Streaming | SSE-style streaming with `primeAndStream`; provider failover happens **before** first token so a slow provider degrades gracefully (`api/chat/route.ts:311-364`) |
| AI routing / agent selection | task → provider order computed once per request from `model-registry`; cheap (`routeOrder`, `configuredProvidersForOrder`) |
| Caching | scrypt-derived key cached per process (`crypto.ts:33`); search has hard 6s timeouts (`search/providers.ts:11`) |
| Bundle size | Radix + Framer Motion + react-markdown — standard for the UI scope; no obvious bloat; `next lint` clean |
| DB queries | admin user list batches Supabase at 1000/page then filters in memory |

## Recommendation (scaling, not a bug)
**P-1 — `api/admin/users/route.ts:49-68`** loads *all* users into memory before filtering/paginating. Fine for hundreds–low-thousands of users; for large bases this is O(users) memory and latency per request. The code already documents the fix in a comment: replace with a Postgres view + RPC that pushes search/role/plan filters into SQL. Not changed automatically — it requires a DB migration and is a scale-dependent decision.

## Recommendation (optional)
- Add HTTP caching headers to keyless search responses if the same queries repeat.
- Consider `React.memo` on heavy list items (project cards, admin tables) if profiling shows re-render cost — not evidenced as a problem today.

**Performance fixes applied:** 0 (no defects); 1 scaling recommendation documented.
