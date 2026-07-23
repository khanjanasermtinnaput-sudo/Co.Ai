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
Think). Context Builder is `execution: "local"` in `stagesFor()`'s specs and executes with zero
provider calls in `src/lib/server/workflow-context.ts` (sibling of the Simple Task Detector below) — it
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

**Ypertatos invariant** (Master Prompt Parts 5.1–5.6, all shipped): a `lightweight` turn makes
exactly ONE provider call, same as Kanon. An `engineering` turn makes **2 + N**: buffered
Requirement Analysis (5.3) → buffered TMAP planning (5.4) → **N ∈ [0, 6] buffered agent calls**
(5.5/5.6) → the ONE streamed answer. N is 0 whenever TMAP's plan has ≤1 task, has a dependency
cycle, TMAP itself failed, or the turn's wall-clock budget is spent — in every one of those
cases the orchestration ("multi-agent") stage is **never inserted into `stagesFor()`'s table at
all**, not faked and not simulated; it is only ever added *after* a real, parsed, >1-task,
acyclic plan confirms it should run. Ypertatos is only reachable on the `agent === "code-chat"`
path (CoCode) — CoChat's header selector and the one-shot build agents (`code-gen`/`plan`/
`analyze`/`debug`) can never reach `pro`; see the `tier` narrow in `src/app/api/chat/route.ts`
right after `tierEligible`.

The **Ypertatos Task Classifier** (`src/lib/server/task-classifier.ts`) is Part 5.2's mandatory,
deterministic, zero-LLM, <15ms gate — sibling of the Simple Task Detector above, but a
*separate* module (different taxonomy, different question: "does this turn need the
engineering workflow?", not "which product surface?"). It decides `stagesFor()`'s `"pro"`
branch between `"lightweight"` (delegates straight to `kanonWorkflow()`) and `"engineering"`.
Low confidence always escalates to `"engineering"` — Part 5.2's "never underestimate an
engineering task" — and a classifier failure defaults to `"lightweight"`, i.e. Kanon's exact
table, satisfying Part 5.2's own "fall back to Kanon-style workflow" failure policy for free.

**Every non-`"phase"` stage of a workflow — `"local"`, `"buffered"`, `"orchestrated"` — is
executed by `src/lib/server/prestream-dispatch.ts`'s `runPreStreamStages()`, never by ad-hoc
`findIndex()` calls in `route.ts`.** That module exists because of a real, shipped-then-fixed
bug: a `findIndex(s => s.execution === "buffered")` only ever runs the *first* buffered stage,
which was harmless while Ypertatos had at most one, but silently would have skipped TMAP the
moment a second buffered stage existed — present in the stage table, counted in the client's
stage total, absent from every log line, never actually executed. `prestream-dispatch.ts` runs
context-builder → requirement-analysis → planner → (conditionally) multi-agent by name, in
order, exactly once each; `prestream-dispatch.test.ts`'s first test is the regression lock (it
fails against the old `findIndex` shape). Extend this module, never reintroduce a `findIndex`
over `execution`, if a further stage is ever added.

The buffered Requirement Analysis call (`src/lib/server/requirement-analysis.ts`) is **not** the
same thing as CoCode's Requirements Architect in `src/lib/raa.ts` (`RAA_SYSTEM`,
`agent: "requirements"`) — that is a browser-safe conversational persona that gathers a
`ProjectBrief` across a DISCOVERY chat; Ypertatos's RAA is server-only, single-shot, and
produces a machine-parsed `RequirementSpec` folded into the streamed answer's system prompt
(`requirementSpecSystemAddon()`) — never shown to the user, never generates code itself. They
can never co-occur in one request: `tierEligible` already excludes `agent: "requirements"` from
all Ypertatos staging. `src/lib/server/buffered-call.ts`'s `runBufferedCall()` is the **only**
buffered (non-streamed) provider call primitive in the app — deliberately not re-exported from
`ai-providers.ts` — and every buffered/orchestrated call in the engineering workflow (RAA, TMAP,
and every individual agent call orchestrator.ts makes) goes through it, so all of them share its
one failover policy; Kanon and Mikros must never import it.

A failed RAA call degrades the WHOLE table to lightweight rather than failing the turn (5.3:
"never terminate the workflow unexpectedly") — TMAP and orchestration both drop with it, since
TMAP would be planning against no `RequirementSpec`, exactly the placeholder stage Part 5.1
forbids. `RequirementSpec`'s `completenessScore`/`confidenceScore` are `number | null` — `null`
when the model didn't emit one, **never** a computed substitute — and `readyForPlanning`, when
the model omitted the line, is *derived* from `missingInformation.length` and labelled
`readyForPlanningSource: "derived"` so the log never claims a measurement that didn't happen.

**TMAP** (`src/lib/server/execution-plan.ts`, Part 5.4) follows RAA's exact anti-fabrication
discipline, reusing its exported line-walk helpers (`listUnder`/`lineValue`/`parsePercent`/
`parseRisks`/`hasHeader`) rather than a second parser: `priority`/`complexity`/`planConfidence`
are `null`, never a fabricated `"medium"`/`0`, when the model omits them; an unknown agent name
resolves to `"general"` with `agentSource: "fallback"`, never invented as a real assignment; a
dependency on a nonexistent task **drops the edge, not the task**, and is warned. The task
`executionOrder` is **always derived by Kahn's algorithm** (`buildExecutionOrder()`), never read
from the model even if it emits one — a residual cycle sets `integrity: "cycle"` and empties the
order rather than breaking an arbitrary edge to force one. Part 5.4's "no orphan tasks" is
deliberately read as "no dangling dependency references" — DAG roots/leaves are the normal,
required shape of the parallel plans Part 5.5 exists to execute, so the literal reading would be
self-contradictory with orchestration.

**The Agent Registry** (`src/lib/server/agent-registry.ts`, Part 5.6) is the single source of
truth for the ten agents TMAP may assign a task to (architect, frontend, backend, database,
security, testing, documentation, reviewer, validator, general — the exact names
`YPERTATOS_RESERVED_STAGES` used to reserve; they are agent ids, not workflow stages, which is
why that reserved list shrank to just `"consensus"`). `resolveAgent()` never invents an agent —
unrecognized input resolves to `"general"`/`"fallback"`. Every agent produces exactly ONE text
artifact (no repo writes — `/api/chat` has no write surface); `buildAgentSystem()` prepends a
shared contract to every persona saying so explicitly.

**The Prompt Compiler** (`src/lib/server/prompt-compiler.ts`, Part 6.6) is the one place `system`
is finalized before `/api/chat`'s provider loop — `route.ts` no longer builds the final system
string by hand. It does not invent prompt text: every layer's content still comes from this repo's
existing generators (`buildSystem`/`agentConfig`, `effortSystemAddon`, `simpleTaskSystemAddon`,
`buildSearchContext`, `userPreferenceSystemAddon`, `prestream-dispatch.ts`'s engineering/context
addons, `buildWorkflowSystem`) — `compilePrompt()` only owns layering/ordering/dedup/validation/
caching/metadata around that unchanged text. Real render order (`PROMPT_LAYER_ORDER`) is `system →
memory → context → workflow`, deliberately NOT the spec's literal Layer-1..7 numbering: the
`"workflow"` layer (buildWorkflowSystem's phase-marker protocol) must render LAST, both because
phase-stream.ts needs the model's freshest instruction to be the marker protocol and because the
protocol's own text ("Any length/depth guidance elsewhere in this prompt...") is self-referential
and assumes everything else was already stated above it — reordering to the spec's numbering would
silently change what that sentence refers to. `"context"` deliberately merges the spec's Engineering
Context and Conversation Context layers, since `prestream-dispatch.ts`'s regression-locked return
contract accumulates the Context Builder digest and RAA/TMAP/orchestration artifacts into one opaque
`system` string already — splitting that return contract into separate named layers would touch a
module this repo explicitly protects, for no behavioral gain. A dedicated regression test
(`prompt-compiler.test.ts`) proves `compilePrompt()`'s output is byte-identical to the pre-6.6 manual
string concatenation for a representative Ypertatos-engineering turn, and a separate test proves
`PHASE_MARKER` values pass through unmodified. `compilePrompt()` is synchronous and pure — it makes
zero provider calls, so it cannot affect Kanon/Mikros/Ypertatos's call-count invariants. It compiles
once per turn, before the provider failover loop, since no per-provider prompt formatting exists in
this codebase yet (Provider Awareness is Future Compatibility, not implemented) — `provider`/`model`
in its metadata name the primary candidate for observability only, not a per-attempt truth. Token
Manager (Part 6.7) reuses `prompt-compiler.ts`'s `estimateTokens()` rather than defining a second one;
Prompt Size / Provider Limits / Context Budget validation is deliberately left to Token Manager,
not duplicated in Prompt Compiler's own (Required Sections only) validation.

**Token Manager** (`src/lib/server/token-manager.ts`, Part 6.7) runs immediately after the Prompt
Compiler, right before the provider loop. `allocateBudget()` wraps the SAME output-budget
computation route.ts always used (`workflowMaxTokens()`/`effortMaxTokens()`, reused verbatim, not
recomputed differently) with a real char/4 estimate of the whole turn (compiled system + history +
message) and the resolved primary provider/model's REAL `ModelDef.contextWindow` from
`model-registry.ts` — the first consumer of `contextWindow` for anything other than `matchScore()`'s
cosmetic scoring; when no exact registry match exists (an OpenRouter model outside its one
representative entry, or an explicit `*_MODEL` env override) it falls back to
`CONSERVATIVE_DEFAULT_CONTEXT_WINDOW` (the smallest real window in the registry), never a fabricated
number. `guardOverflow()` is the actual enforcement: when `promptTokens + outputBudget` would exceed
`contextWindow`, it drops the OLDEST history turns first (mirroring `workflow-context.ts`'s own
"replace conversation, keep the freshest" precedent) and, only as an absolute last resort, floors
`outputBudget` at `MIN_OUTPUT_BUDGET` (256) rather than aborting the turn — "Token Manager must never
terminate workflows unexpectedly." It deliberately does NOT drop lower-priority PROMPT LAYERS
(RAA/TMAP grounding, memory) — there is no layer in this pipeline safe to cut without risking real
engineering-context loss, so that spec lever is out of scope by design, not faked. `reportEfficiency()`
computes an accuracy ratio ONLY from real provider `usage`; absent usage, it never fabricates an
`actualPromptTokens`/`estimateAccuracy`. `estimateTokens()` is NOT redefined here — it's re-exported
from `prompt-compiler.ts`, the single source of truth for both Parts 6.6 and 6.7. Verified live: a
normal turn logs `overflow=false` with the primary provider's real `contextWindow` (e.g. Anthropic's
200,000) and an unchanged `outputBudget`; a deliberately oversized history (a single ~900KB turn)
logs `overflow=true compressed=true historyDropped=1` and the turn still completes rather than
crashing — see `token-manager.test.ts` for the same behavior locked as regression tests.

**Budget Enforcer** (`src/lib/server/budget-enforcer.ts`, Part 6.8.1) runs right after Token
Manager, purely observational: `enforcementFor()` evaluates the turn's ALREADY-computed real
snapshots — `turn-budget.ts`'s wall clock and Part 6.7's `TokenBudget` — against graduated
healthy/warning/critical/exceeded thresholds and returns whichever dimension is WORSE. It does not
gate, pause, or abort anything itself; actual enforcement is the pre-existing degrade paths this
module merely classifies the severity of — `orchestrator.ts`'s `timeUp()` → `TaskRecord.skipReason:
"budget"`, and Part 6.7's `guardOverflow()` dropping history. Deliberately mirrors
`tmap-v2/src/core/budget-enforcer.ts`'s vocabulary (`BudgetLevel`/`BudgetCategory`/`BudgetAction`/
`EnforcementDecision`) — same pattern as `crypto.ts` and the Tool Execution Engine's two independent
copies, since aof-web and tmap-v2 share no workspace. **Boundary (documented, following the Part
5.5 precedent of not building an Event Bus/Recovery Engine for a stateless pipeline):** no
pause/resume control plane exists here — a stateless HTTP request has no live actor to pause and
resume later. Verified live: a normal turn logs `level=healthy category=tokens action=continue`; the
same deliberately oversized history that trips Token Manager's overflow guard logs
`level=exceeded category=tokens action=abort ratio=1.131` — an honest classification of the
turn's PRE-mitigation severity (Token Manager's own `compressed=true` on the preceding log line
shows what was actually done about it; the two log lines answer different questions on purpose).

In tmap-v2, the SAME `evaluate()`/`BudgetEnforcer` pair (`tmap-v2/src/core/budget-enforcer.ts`)
wraps `cost-budget.ts`'s `CostMonitor`: `precheckWithEnforcement()` is a drop-in replacement for
`CostMonitor.precheck()` that emits `budget_warning`/`budget_critical`/`budget_exceeded` events on
`v2/events.ts`'s `EventBus` on level TRANSITIONS only (never once per call, which would be spam on
a run with hundreds of calls at the same level) before calling through to the SAME
`precheck()` — every existing `catch (isBudgetError(e))` call site is unaffected because the hard
throw is byte-identical to before. Wired into `core/orchestrator.ts`'s `runTMAP` (no bus available,
graduated classification only) and `core/ypertatos.ts`'s `runYpertatosNormal` (with its `wfBus`,
whose construction was moved earlier — before `callFor` is defined — so the enforcer can publish to
it from the very first LLM call, not just after `executeGraph()` starts). `chief-agent.ts` and
`v2/executor.ts` are deliberately left unwired this phase: `chief-agent.ts` follows the identical
already-proven `callFor`+precheck pattern with no new engineering value from repeating it, and
`executeGraph()` has no budget parameter in its signature at all — adding one would be a
signature-breaking change touching every caller, out of scope for "graduated enforcement over
EXISTING budgets."

**Observability & Telemetry** (`src/lib/server/telemetry.ts`, Part 6.9): `buildTimeline()` is a pure
aggregation of the real, already-computed structured data every stage of a turn produces
(`prestream-dispatch.ts`'s `PreStreamTelemetry`, Prompt Compiler's `PromptMetadata`, Token Manager's
`TokenBudget`/`GuardOverflowResult`, Budget Enforcer's `EnforcementDecision`) into one
`WorkflowTimeline`, keyed by the SAME `turnRequestId` that already correlates every existing
`logAofStage` line — that id IS this turn's trace id; no new id scheme. `summarizeTimeline()`
flattens it into the same greppable `key=value` shape every other field uses, merged into the
EXISTING three `"Output"` log calls in `route.ts` (staged/Kanon `onComplete`, non-staged success,
all-providers-failed) rather than a fourth log line — omits `traceId`/`totalDurationMs`/`outcome`
since those duplicate the Output line's own `requestId`/`durationMs`/`success`. A stage that didn't
run for a turn is simply absent from `spans`, never a placeholder. **Boundary (documented, following
the Part 5.5 precedent of not building an Event Bus/Recovery Engine/standalone Monitor for a
stateless pipeline):** no long-lived global event bus and no live dashboard exist here — aof-web is
a stateless per-request Vercel runtime with no persistent process to host one; the existing
`/api/admin/analytics` + `/api/timeline` product surfaces and tmap-v2's Prometheus/health endpoints
(genuinely long-lived processes) are where that belongs. Verified live: a failed turn logs
`spanCount=3 spans=prompt-compiler:ok(0ms),token-manager:ok,budget-enforcer:ok alertCount=1
alerts=error:provider`; the same oversized-history turn that trips Token Manager's overflow guard
logs three DISTINCT real alerts on one line — `warning:token-manager` (mitigated),
`error:budget-enforcer` (classified exceeded), `error:provider` (the eventual failure) — proving the
whole chain (6.6→6.7→6.8.1→6.9) produces one coherent, honest picture of a turn.

In tmap-v2, `core/ypertatos.ts`'s `wfBus.onAny` handler routes `budget_warning`/`budget_critical`/
`budget_exceeded` events through `logger.logSystem()` in addition to the existing `emit()` status
stream — landing in the SAME structured, persisted record every node/agent/cost/failure event
already does, via `logSystem`'s freeform `meta`, deliberately without adding a new `LogCategory` to
`v2/logger.ts` (which several exhaustive category-based aggregations already switch over).

**Security & Permission Manager** (`src/lib/server/security-manager.ts`, Part 6.10) is the ONE
facade for every security-relevant decision on `/api/chat`: `authenticate()`
(`getUserFromRequest`), `resolveSecrets()` (`loadUserKeyOverrides`), `redactForLog()` (`errors.ts`'s
`redact`) delegate to EXISTING implementations, unchanged — this is a facade, not a rewrite of the
systems it wraps. Two genuinely new capabilities: `checkEgress()` (defined in `ai-providers.ts`
itself, re-exported here — co-located with the real `OPENAI_COMPAT`/`OPENROUTER_CHAT_URL` config it
reads, to avoid a circular import between the two modules) is a fail-closed provider-hostname
allowlist wired into `openAiCompatConnect()` before every fetch; it is a **defense-in-depth
drift-guard, not a fix for a live vulnerability** — no user-supplied URL reaches any fetch call in
this file today, every target is a hardcoded literal or an operator-set `OLLAMA_BASE_URL`/
`VLLM_BASE_URL`. `assessKeyAccessRisk()` scores the ONE privileged action this path takes (reading a
stored provider key) from a real signal only — per-user key present vs. server env fallback — never
a fabricated numeric score. `auditSecurityEvent()` is aof-web's first audit log (only tmap-v2's
`server/audit.ts` had one before); it runs every value through `redactForLog()` so an audited
`detail` string can never leak a secret, and logs through the SAME `[AOF]` console sink as every
other security-relevant line, keyed by `turnRequestId`. **Deliberately has NO
`checkToolPermission()`-style method**: `/api/chat` has no write surface and no tool execution at
all (every agent produces exactly one text artifact — `agent-registry.ts`'s `AGENT_CONTRACT`); the
REAL Tool Permission Engine (Part 6.3's `permissionSatisfied` ladder) already exists in
`tmap-v2/src/v2/tools/registry.ts` and, as of the CLI's `coai tool` command,
`coagentix-cli/src/tools/registry.ts` too — a scripted/automation entrypoint that invokes
`fs`/`git`/`terminal` through the standardized `ToolAdapter` contract, permission-checked via the
same ladder. It is deliberately NOT how AI-proposed file changes reach disk: every single-shot
command and the interactive REPL both apply AI-generated changes through `cli.ts`'s
`applyWithConfirm()` (security gate → reliability score → patch validation → checkpoint → apply →
build validation with auto-rollback), never through the tool registry — `coai tool` is for direct,
scripted invocation (CI, automation), not the agent-facing write path. Faking an aof-web analog with
nothing to gate would be the exact scaffold this repo's discipline forbids (see the Workflow
Orchestrator entry below for the same principle applied to Part
5.5). Verified live: a normal turn logs `[SECURITY AUDIT] action=auth ... detail=anonymous` and
`action=key-access ... detail=low: request uses the server's own configured provider key(s)`,
correctly correlated with the turn's `requestId` alongside every Part 6.6–6.9 log line on the same
turn.

In tmap-v2, `server/logger.ts` gained its first automatic redaction pass (`redactLogLine()`) —
previously EVERY `fields` value was written to stdout/stderr verbatim, so a caller logging a raw key
would leak it. Mirrors aof-web's `errors.ts` `redact()`/`SECRET_PATTERNS` (separate packages, no
shared workspace — same precedent as `crypto.ts` and the Tool Execution Engine's two independent
copies), plus this package's own `cgntx_sk_` developer-key prefix (`server/developer-keys.ts`).
Applied to the WHOLE stringified log line rather than walking `fields`' arbitrary shape
field-by-field, so a secret-looking substring is caught regardless of which key it was logged under.

**Runtime Kernel / Recovery Engine / Certification** (Parts 6.11–6.13) live entirely in
`tmap-v2` (`tmap-v2/src/v2/kernel/`, `tmap-v2/src/v2/recovery/`, `tmap-v2/src/v2/certification/`),
not here — the same boundary the Budget Enforcer, Observability, and Workflow Orchestrator
entries above already draw and explain: aof-web is a stateless, per-request Vercel runtime with
no persistent process to host a lifecycle manager, a long-lived recovery coordinator, or a test-
certification runner. tmap-v2 is the genuine long-lived process (`tmap-v2/src/server/index.ts`,
a CLI + Express server) where a process lifecycle, graceful shutdown, an executor with a real
failure ladder, durable checkpoints, and the `node:test` harness those three parts coordinate
already exist. Building parallel/analog modules here would be exactly the scaffold-with-nothing-
to-do-here anti-pattern Part 6.10's boundary note calls out for `checkToolPermission()`. See
`tmap-v2`'s own module headers (each opens with a "Deliberately NOT built" list) for what each
part actually owns versus coordinates.

**The Workflow Orchestrator** (`src/lib/server/orchestrator.ts`, Part 5.5) executes TMAP's plan
wave-by-wave, up to `MAX_PARALLEL` (3) concurrent agent calls per wave, inside
`src/lib/server/turn-budget.ts`'s shared wall-clock ledger — a fixed margin under `route.ts`'s
`maxDuration = 60`, with orchestration as the elastic term that gets whatever's left after RAA
and TMAP's fixed deadlines, capped, and degrades (skips tasks, honestly reported via
`TaskRecord.skipReason`) rather than blowing the budget. Of Part 5.5's 11 listed internal
components, only 4 are actually new code here (wave scheduler, task-state map, context assembly,
Result Integrator) plus one run record; the Retry Engine is `buffered-call.ts`'s existing
failover loop (reused, not duplicated) and the Dependency Resolver is TMAP's own
`executionOrder` — Recovery Engine, Event Bus, and a standalone Timeline/Monitor were
deliberately **not** built, since none would have a real runtime job in a stateless,
single-request, ≤6-agent pipeline with no write surface (see the module's own header comment for
the full reasoning). `OrchestrationRun.maxParallelObserved` is a real, measured peak of
concurrent in-flight calls — proof parallelism happened, never a claim. `integrateArtifacts()`
folds completed artifacts into the streamed answer's system prompt and explicitly names every
task that did **not** produce one, so the final answer can never claim an agent finished work it
didn't.
