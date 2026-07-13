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
resolves to a single `processing` stage. Don't add a second mechanism that decides whether a
workflow runs — extend `stagesFor()`.

**Kanon invariant** (Master Prompt Part 4): Kanon makes **exactly ONE provider call per turn**,
at every effort level — Low (Processing→Review), Medium/`normal` (+Context Builder), High (+Deep
Think). Context Builder is `local: true` in `stagesFor()`'s specs and executes with zero provider
calls in `src/lib/server/workflow-context.ts` (sibling of the Simple Task Detector below) — it
REPLACES the history sent to the provider with a relevance-scored selection, so it can only save
tokens, never add them (the invariant a prior LLM-based version violated). Processing/Deep
Think/Review are NOT separate calls: they're phases inside that one generation, opened by
line-anchored markers (`PHASE_MARKER`, e.g. `<<<COAI_FINAL>>>`) the model is asked to emit
(`buildWorkflowSystem()`), parsed back out by `src/lib/server/phase-stream.ts` — draft/critique
text is suppressed server-side and only the FINAL phase streams to the user. `workflowMaxTokens()`
adds interior-phase overhead on top of `effortMaxTokens()`'s answer budget rather than routing the
combined total back through it, so Kanon Low's answer isn't starved paying for its own draft.
`phaseStream()`'s one hard rule: it must never yield before the wrapped provider generator's first
non-empty chunk, or `primeAndStream()` commits an HTTP 200 before the provider has even been
reached, silently breaking failover on every pre-first-token error.

Structured `Input → Processing → Output` server-side lifecycle logging lives in
`logAofStage()` (`src/lib/server/ai-log.ts`) — distinct from the client-facing `StageNotice`
frames (`errors.ts`) that drive the UI's live stage-progress indicator. Every Model Workflow
stage logs under `"Processing"` with a `stage=` field (same precedent as the Simple Task
Detector). Only log real, observed values — never fabricate a metric that isn't actually
available at that layer; Kanon's single call is the one path where real token usage genuinely
is observable (via `phaseStream()`'s `onComplete`, which can fire after the HTTP response has
already been returned), logged on `"Output"` as `promptTokens`/`completionTokens`.

**Mikros invariant** (`src/app/api/chat/route.ts` + `src/lib/effort.ts`): Mikros (CoChat `lite`)
is structurally limited to one stage/one provider call by `stagesFor()`, and
`tierAllowsSearch()` additionally skips Universal Search/retrieval for that same plain-chat
`lite` path — Master Prompt Part 3: "Mikros must never execute... expensive retrieval
workflows." Kanon and every agent-driven path (incl. CoCode code-chat) are unaffected. The
low/normal/high effort dial is intentionally kept for Mikros (sizes tokens/temperature only) —
a deliberate departure from the spec's literal "no selectable effort," approved by the user.
This does not apply to CoCode's `lite` build mode, a separate product surface with its own
conversation→generate workflow.

**Simple Task Detector** (`src/lib/server/simple-task-detector.ts`): a deterministic,
<10ms, zero-provider-call classifier that picks Mikros's response SHAPE (`simple` /
`medium` / `light-coding`) from the message text — orthogonal to `effort.ts`, which owns
response DEPTH. It is explicitly not a workflow stage; don't wire it into `stagesFor()`.
Scoped identically to `tierAllowsSearch()` (plain-chat `lite` only). Gotcha: Thai script is
not a JS regex "word" character, so `\b` is unreliable adjacent to it — Thai and English
detection patterns are kept as separate regexes (English uses `\b`, Thai relies on substring
containment only). Logged via `logAofStage("Processing", ...)`. `workflow-context.ts`'s
tokenizer hits the same gotcha from the other direction — Thai has no word spaces at all, so
whitespace/`\b` splitting collapses lexical overlap to ~0; it tokenizes Thai runs as character
trigrams instead (keeping vowels/tone marks, since stripping them merges distinct words).
