# Hookify Rules — Memory-First Enforcement

> These rules are enforced by the `hookify` plugin.
> They encode the Memory-First Workflow from CLAUDE.md.

## Rule 1: Load CLAUDE.md before any source file
When starting work on any task:
- ALWAYS check CLAUDE.md first
- Check which Level (L1–L5) covers the task
- Only descend to source files if L1–L3 are insufficient

## Rule 2: Prefer semantic search over file reads
Before reading any file to find a function or symbol:
- First query: "find [symbol] using serena" or "search [concept] using greptile"
- Only read the full file if semantic search returns insufficient context

## Rule 3: Never re-read architecture documents for known facts
The following documents should NOT be re-read in full each session:
- `AOF_CODE_TDD.md` — use L2 DARS / Memory / DB sections in CLAUDE.md instead
- `aof-web/ARCHITECTURE.md` — use L2 aof-web section in CLAUDE.md instead
- `README.md` — use L1 project summary in CLAUDE.md instead
Exception: read when the document itself needs to be updated.

## Rule 4: Never modify these files without explicit user instruction
- `src/providers/client.ts` (chat() function)
- `src/types.ts` (Blackboard contract)
- `api/index.ts` (Vercel entry)
- `aof-web/src/app/globals.css` (design tokens)
- `aof-web/tailwind.config.ts` (theme)

## Rule 5: TypeScript ESM import discipline
In all tmap-v2 files, imports of local modules MUST use `.js` extension:
- ✅ `import { foo } from './foo.js'`
- ❌ `import { foo } from './foo'`
Never suggest removing `.js` from local imports in ESM TypeScript.

## Rule 6: Security gate
Before writing any code that handles:
- API keys or credentials → check crypto.ts pattern first
- User input that reaches DB → verify parameterized query or Supabase SDK
- File paths from user → verify path.join + root constraint
- Auth routes → check rate-limit requirement (PIN brute-force risk)
