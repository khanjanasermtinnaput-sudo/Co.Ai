# aof-web

## UI contrast rule (hard requirement)

Never let a text color and its background/surface color resolve to the same or
near-same value, in either theme. This has caused real bugs (e.g. `.glass-strong`
in `globals.css` was hardcoded to a near-black fill with no light-mode variant,
making `text-foreground`/`text-popover-foreground` unreadable on it in Light mode —
affecting every tooltip, dropdown menu, dialog, and toast).

When adding or touching UI:
- Any custom surface utility (like `.glass`, `.glass-strong` in `src/app/globals.css`)
  must define both a base (light) rule and a `.dark` override — never a single
  hardcoded fill shared across themes.
- When pairing a `bg-*`/`background`/`style={{ backgroundColor }}` with text, use
  matched design tokens (`bg-card` + `text-card-foreground`, `bg-popover` +
  `text-popover-foreground`, etc.) rather than mixing an arbitrary background with
  an unrelated text token.
- For text on a *dynamic* background color (e.g. per-user avatar colors), don't
  hardcode `text-white`/`text-black` — pick based on the background's luminance.
  See `readableTextColor()` in `src/lib/utils.ts`.
- Before merging any visual change, check it in both Light and Dark theme
  (Settings → Appearance in the app, or `next-themes`' `useTheme()`).

## Co.AI Master Prompt — governance

This repo is governed by the "Co.AI Master Prompt v1.0" (Parts 1–3: global engineering
rules, layered system architecture, Mikros tier spec). Its core rules — no fake/placeholder
workflows, single source of truth per concept, one responsibility per module, every
config must be consumed at runtime, every runtime decision must be loggable/explainable —
apply to all work in this repo, not just CoChat.

Tier branding SoT: `src/lib/model-branding.ts` (`lite`→Mikros, `normal`→Kanon, `pro`→Ypertatos,
`titan`→Titan). Effort/depth SoT: `src/lib/effort.ts`. Stage-*sequence* SoT (which stages a
tier/effort combo runs): `src/lib/server/model-workflow.ts` `stagesFor()` — Mikros always
resolves to a single `processing` stage; Kanon runs a real Context Builder→Processing→[Deep
Think]→Review pipeline via `src/lib/server/workflow-runner.ts`. Don't add a second mechanism
that decides whether a workflow runs — extend `stagesFor()`.

**Mikros invariant** (`src/app/api/chat/route.ts` + `src/lib/effort.ts`): Mikros (CoChat `lite`)
is structurally limited to one stage/one provider call by `stagesFor()`, and
`tierAllowsSearch()` additionally skips Universal Search/retrieval for that same plain-chat
`lite` path — Master Prompt Part 3: "Mikros must never execute... expensive retrieval
workflows." Kanon and every agent-driven path (incl. CoCode code-chat) are unaffected. The
low/normal/high effort dial is intentionally kept for Mikros (sizes tokens/temperature only) —
a deliberate departure from the spec's literal "no selectable effort," approved by the user.
This does not apply to CoCode's `lite` build mode, a separate product surface with its own
conversation→generate workflow.

Structured `Input → Processing → Output` server-side lifecycle logging lives in
`logAofStage()` (`src/lib/server/ai-log.ts`) — distinct from the client-facing `StageNotice`
frames (`errors.ts`) that drive the UI's live stage-progress indicator. Only log real, observed
values — never fabricate a metric (e.g. token usage) that isn't actually available at that
layer.
