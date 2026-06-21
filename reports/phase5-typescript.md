# Phase 5 — TypeScript Hardening

**Method:** inspect `tsconfig` strictness; locate every `any` / unsafe cast / `unknown` misuse; replace with precise types; re-verify.

---

## Baseline

| Workspace | `strict` | Real `any` (non-test) before | after |
|-----------|----------|------------------------------|-------|
| **aof-web** | ✅ `true` | **0** | **0** |
| **tmap-v2** | ✅ `true` | **8** | **1** (legitimate) |

Both projects already compile under `strict: true` (implies `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.). **aof-web — the user-facing, portfolio-critical app — was already 100% free of `any`/unsafe casts.** The two grep hits there were the English word "any" in a comment and a test name, not the type.

---

## Changes (tmap-v2)

### T5.1 — `core/validator.ts`: 6× `catch (e: any)` → typed narrowing
Added one shared helper instead of `any`:
```ts
interface ExecError { stderr?: { toString(): string }; stdout?: { toString(): string }; message?: string }
function execErr(e: unknown): ExecError { return (e ?? {}) as ExecError; }
```
All six language-syntax checkers (JS/TS/Python/JSON/Go/Rust) now `catch (e)` (implicitly `unknown`) and narrow via `execErr(e)`. Removes 6 `any`s, dedups the error-extraction pattern, and keeps the exact same runtime message behavior.

### T5.2 — `providers/client.ts`: `const data: any = await res.json()` → typed
```ts
const data = (await res.json()) as {
  choices?: Array<{ message?: { content?: string }; text?: string }>;
};
```
The actual LLM-response parse path is now typed end-to-end; the optional-chaining extraction is unchanged but now type-checked.

### T5.3 — `cli.ts`: `(i: any)` → `(i: { severity?: string })`
Session-history review filter now has a precise predicate type.

---

## Intentionally retained

| Location | Cast | Why kept |
|----------|------|----------|
| `server/redis.ts:195` | `_require('ioredis') as any` | Dynamic `require` of an **optional** peer dep that may be absent; `any` here is the standard, correct escape hatch for an untyped optional module loaded at runtime. Wrapping it in a typed facade would add no safety (the module's types aren't installed). |

## Strictness flags considered but not enabled
- `noUnusedLocals` / `noUnusedParameters`: **not** added to either `tsconfig`. tmap-v2 still has a few intentionally-retained unused symbols (Phase 4 deferred list: `cli-auth.sb`, `queue._Queue/_Worker`, etc.), so enabling these would break the build. Recommended as a Phase 12 follow-up *after* the deferred cleanup, gated in CI.
- `exactOptionalPropertyTypes`: high-churn, low-yield on this codebase; not pursued.

---

## Output format (per directive)

1. **Findings:** aof-web already `any`-free; tmap-v2 had 8 real `any`s (6 catch, 1 json-parse, 1 filter).
2. **Root cause:** untyped `catch` bindings + untyped `res.json()` results.
3. **Files affected:** `core/validator.ts`, `providers/client.ts`, `cli.ts`.
4. **Changes made:** 7 `any`s replaced with precise types via a shared `execErr` narrowing helper + inline response/predicate types; 1 legitimate optional-require `any` retained.
5. **Risks:** none — runtime behavior identical; only static types tightened.
6. **Validation evidence:** tmap-v2 `tsc --noEmit` clean; 432/436 tests pass (4 pre-existing skips); aof-web unchanged (still clean).

---

### ✅ Phase 5 complete — proceeding automatically to Phase 6 (Security Audit).
