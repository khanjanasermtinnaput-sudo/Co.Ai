# Phase 4 — Dead Code Elimination

**Method:** ESLint (`next lint`, includes `no-unused-vars`) on aof-web; `tsc --noUnusedLocals --noUnusedParameters` on tmap-v2; custom orphan-module detector (source files with zero import references repo-wide).
**Safety:** every removal re-verified against importers before deletion; full typecheck + lint + test re-run after.

---

## Verdict

aof-web was already **ESLint-clean** (no unused imports/locals). Removed **5 orphan modules** (zero importers anywhere) and **9 unused imports** across tmap-v2 source files. **No regressions** — both suites typecheck clean, 610 tests green.

---

## Removed — Orphan modules (aof-web)

| File | Reason | References (pre-removal) |
|------|--------|--------------------------|
| `src/components/code/code-build.tsx` | `CodeBuild` component never imported | 0 external |
| `src/components/error/error-modal.tsx` | `ErrorModal` never imported (error UX uses `error-toast` + `errors/*`) | 0 external |
| `src/components/growth/social-share.tsx` | `SocialShare`/`ReferralShare` never imported | 0 external |
| `src/components/ui/scroll-area.tsx` | Radix wrapper never used (lists use native scroll) | 0 external |
| `src/hooks/use-media-query.ts` | `useMediaQuery` never imported | 0 external |

> Verified-NOT-orphan (kept): `components/mascot/index.ts` (imported by `chat-message`/`chat-view` as `@/components/mascot`) and `instrumentation.ts` (Next.js special auto-loaded file). Both were false positives from the basename detector.

## Removed — Unused imports (tmap-v2)

| File | Symbols removed |
|------|-----------------|
| `src/cli.ts` | `extname`, `DEFAULT_QUOTA`, `loadSession` |
| `src/core/validator.ts` | `existsSync` |
| `src/core/advanced-router.ts` | `Role` (type) |
| `src/server/index.ts` | `recordUsage`, `authenticateDevKey`, `hasScope` |
| `src/server/analytics.ts` | `fsGet` |
| `src/server/backup.ts` | `BackupStatus` (type) |
| `src/server/permissions.ts` | `fsGet` |
| `src/server/webhooks.ts` | `timingSafeEqual` |

---

## Identified but NOT removed (deferred — risk/scope)

These are inert but removing them carries higher regression risk than import-pruning (function/param/local removal, or signals of incomplete features). Documented for Phase 12, not auto-deleted:

| File | Item | Why kept now |
|------|------|--------------|
| `server/cli-auth.ts` | `sb()` helper flagged unused | Removing a whole function; verify the auth path doesn't reach it dynamically first. |
| `server/webhooks.ts` | `SUPABASE_URL`/`SUPABASE_KEY` consts unused | Signals webhook persistence may be file-only — a **feature gap**, flag for Phase 9 not a blind delete. |
| `server/queue.ts` | `QueueStats`, `_Queue`, `_Worker` | `_`-prefixed = intentional optional-`bullmq` type placeholders. |
| `server/analytics.ts` | `period` param | Removing changes a function signature/contract. |
| `core/eval-framework.ts` | `DimName` type, `emptyBb` local | Low value; bundle with Phase 12 sweep. |
| `src/tests/*` | several unused test imports | Test-only; no production impact. |

> Note: tmap-v2's production `tsconfig` does **not** enable `noUnusedLocals`, so none of these block the build — they are hygiene, not defects.

## Duplicate code reviewed — intentional, kept
- `aof-web/src/lib/server/crypto.ts` ↔ `tmap-v2/src/server/crypto.ts`: deliberate mirror so both surfaces encrypt keys identically (same blob format). **Not** a dedup target — they live in separately-deployed packages with no shared module path. Documented in the files themselves.

---

## Output format (per directive)

1. **Findings:** 5 orphan modules + 9 unused imports = 14 dead-code removals; ~10 lower-risk items deferred with rationale.
2. **Root cause:** components/hooks built but never wired; leftover imports after refactors.
3. **Files affected:** 5 deleted (aof-web), 8 edited (tmap-v2).
4. **Changes made:** deletions + import pruning above.
5. **Risks:** none — no importers existed; verified post-change.
6. **Validation evidence:** aof-web `tsc` clean · `next lint` clean · 178/178 tests; tmap-v2 `tsc` clean · 432/436 tests (4 pre-existing skips). All green after changes.

---

### ✅ Phase 4 complete — proceeding automatically to Phase 5 (TypeScript Hardening).
