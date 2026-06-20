# TypeScript Report — Co.AI

**Date:** 2026-06-21 · **Branch:** `audit/production-hardening`

## Baseline: already hardened
Both `tsconfig.json` files have `"strict": true`. `tsc --noEmit` passes clean in both projects.

| Metric | Value |
|--------|-------|
| `strict` mode | ✅ enabled (aof-web + tmap-v2) |
| `tsc --noEmit` errors | 0 |
| `: any` occurrences | 9 total, across 4 files |
| `@ts-ignore` / `@ts-nocheck` | none in app source (the 17 grep hits are `TODO`/`eslint-disable` markers, not type suppressions) |
| unsafe casts | localized `as` casts with runtime guards (e.g. `roleRow.role as string` after a presence check) |

## The 9 `any` usages
Located in: `aof-web/src/tests/plans.test.ts` (1), `tmap-v2/src/providers/client.ts` (1), `tmap-v2/src/core/validator.ts` (6), `tmap-v2/src/cli.ts` (1).

These are mostly at boundaries where `any` is reasonable (test fixtures, dynamic provider payloads, validator AST handling). None are in security- or data-integrity-critical control flow. Replacing them risks over-narrowing dynamic external shapes for little safety gain, so they were **left as-is** rather than churned. If you want zero-`any`, the highest-value target is `validator.ts` (6) — convert to `unknown` + narrowing.

## Verdict
No TypeScript hardening required. The project already meets a strict-mode, near-zero-`any` bar.

**`any` removed:** 0 (changing them would be churn, not improvement; documented instead)
