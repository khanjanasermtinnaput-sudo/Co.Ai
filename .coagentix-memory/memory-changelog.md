# Memory Changelog

Append one entry per change set that affects the memory. Newest first.
Format: `## <date> · <git short sha> — <title>` then bullets of what changed and which map files were updated.

---

## 2026-06-21 · 247e4b5 — Initial full index (baseline)

- Built the complete `.coagentix-memory/` system from a full repository scan at git `247e4b5`.
- Indexed 3 packages: `aof-web` (Next.js 14 frontend+API), `tmap-v2` (Express multi-agent backend), `coagentix-cli` (terminal agent).
- Captured: 28 aof-web API routes + ~80 tmap-v2 `/v1` routes, 30+ DB tables across 12 migrations, all special systems (TMAP, Titan, DARS, Chief, RAA, Voting, Memory, vision), 105 UI components, 9 Zustand stores, system prompts and call sites.
- Files written: `project-index`, `feature-map`, `dependency-map`, `api-map`, `database-map`, `agent-map`, `workflow-map`, `prompt-map`, `component-map`, `route-map`, `knowledge-graph`, `search-index` (`.json`), plus `memory-summary.md`, `memory-changelog.md`, `README.md`.
- No source code changed — indexing only.
