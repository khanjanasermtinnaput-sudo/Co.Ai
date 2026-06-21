# `.coagentix-memory/` — Repository Intelligence System

Persistent project memory for Coagentix (Co.AI / AOF). The goal: **locate code and trace
impact without re-reading the whole repo**, reducing token usage and improving accuracy.

## Files

| File | Purpose |
|---|---|
| `memory-summary.md` | Human-readable overview + special-systems index. **Start here.** |
| `project-index.json` | Monorepo layout, stacks, entry points, area breakdown |
| `feature-map.json` | Feature → owning files across packages |
| `dependency-map.json` | Module hubs, import→used-by, blast radius |
| `api-map.json` | All HTTP routes (aof-web `/api/*` + tmap-v2 `/v1/*`) |
| `database-map.json` | Supabase tables, RLS, RPCs, which code queries them |
| `agent-map.json` | Agents/roles → providers, models, tools |
| `workflow-map.json` | TMAP, Titan, Chief, DARS, vision, auth, CLI flows |
| `prompt-map.json` | System prompts → call sites |
| `component-map.json` | UI components → state sources |
| `route-map.json` | Next.js App Router pages/route groups |
| `knowledge-graph.json` | Typed relationship edges + special-systems node map |
| `search-index.json` | keyword → canonical file(s). **Fastest lookup.** |
| `memory-changelog.md` | Append-only log of memory updates |

## How to query (task execution mode)

1. **Search** `search-index.json` (keyword) or `feature-map.json` (feature) for entry files.
2. **Trace** via `dependency-map.json` (blast radius) + `knowledge-graph.json` (edges) — find consumers & side effects.
3. **Verify** contracts in `api-map.json` / `database-map.json` / `prompt-map.json`.
4. Open only the specific files identified. Don't scan the whole tree.

## Impact analysis before editing

For any change, derive from the maps: affected files, features, APIs, components, agents,
and risks. The "High blast-radius files" list in `memory-summary.md` flags wide-reach modules.

## Incremental updates (keep memory in sync)

This memory is **data, not an automated process** — it does not self-update. Refresh it when code changes:

- Find changed files since baseline:
  `git diff --name-only 247e4b5d36b50dba75c915fd593665fcabdd3499 HEAD`
- Update **only** the affected map(s):
  - new/removed/renamed file → `project-index`, relevant feature/component/dependency map, `search-index`
  - new/changed route → `api-map` (+ `route-map` for pages)
  - migration → `database-map`
  - new agent/prompt/workflow → `agent-map` / `prompt-map` / `workflow-map` + `knowledge-graph`
- Bump `generatedAt`/`gitHead` in `project-index.json`.
- Append an entry to `memory-changelog.md` (date · short sha · what changed · maps touched).

To fully rebuild, re-run a structured scan (exports via `grep -nE '^export'`, routes via the
route patterns, SQL via `create table|function`) and regenerate the JSON — only necessary after
large refactors.

## Optional automation

A `SessionStart` hook (see the `session-start-hook` skill) or a CLI step could print the
`git diff --name-only <baseline> HEAD` so stale maps are obvious at session start. Not installed
by default — add it if drift becomes a problem.
