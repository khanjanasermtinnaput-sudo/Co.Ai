# Co.Ai / CoCode Workspace — End-to-End QA Validation Report

**Date:** 2026-07-24
**Scope:** aof-web (Next.js 14) running locally in demo mode (`NEXT_PUBLIC_COAGENTIX_DEMO=1`, no live provider key), with special focus on the unified CoCode workspace (`/code`). GitHub testing limited to entry-point/error-path verification (no real commits/pushes/PRs). Static checks run across `aof-web` and `tmap-v2`.
**Method:** Static checks run for real (`npm run typecheck/lint/test/build`). Live UI tested via a custom Playwright driver (no browser extension available this session) driving the actual running app at `localhost:3000` — every finding below was reproduced by an actual command or browser action taken during this session, not inferred from reading code alone. Code reading was used to find root causes after live reproduction, and to establish a baseline of already-documented, intentional limitations (Phase 0 recon) that are called out explicitly below wherever relevant, so they are not double-reported as new bugs.

---

# Executive Summary

**Overall status: FAIL** (one CRITICAL, silent data-corruption defect in the Editor — the core of the CoCode workspace)

**Overall score: 6.3 / 10**

**Top 5 findings:**

1. **CRITICAL — Silent content corruption on first keystrokes in a fresh Editor session.** The very first character(s) typed into the first file of a new CoCode session get displaced to the end of the content, with no error shown. Reproduced 3 times independently across different files/content. Root cause: Monaco is used in fully-controlled mode (`value` prop bound to a Zustand store that `onChange` also writes to every keystroke), racing the user's live input. This cascades into visibly broken Preview output.
2. **HIGH — "Sign in" is a dead loop in demo mode.** Clicking Sign In always bounces straight back to Home without ever showing the Google sign-in screen, because `/login`'s redirect guard doesn't distinguish the demo stand-in user from a real session (unlike the sidebar's own correct `configured && !!user` check).
3. **HIGH — tmap-v2's Python code-execution sandbox is broken on Windows and made an unprompted network install attempt during `npm test`.** The sandbox's minimal-env policy breaks the Windows Python launcher alias, causing it to try silently downloading/installing Python 3.14 instead of finding the already-installed interpreter.
4. **Positive/notable — GitHub OAuth integration is genuinely well-built.** Correct client ID, redirect URI, scopes, and CSRF state parameter; verified real error handling (server 500 surfaces the actual error text to the user, no crash, no fake success).
5. **Scoping limitation, not a defect — demo mode cannot exercise the real generation→file/editor bridge or real AI network-failure handling.** The mock AI engine explicitly tells the user "In a live workspace you'd see the file tree, a diff view..." and never calls any `/api/` endpoint for chat. This is honestly disclosed by the app itself, but it means several requested test scenarios (generation→editor integration, AI network-failure recovery) could not be exercised under the agreed demo-mode scope and would need a real provider key to verify.

---

# Critical Issues

### C1 — Editor silently corrupts the first keystrokes of the first file in a session
- **Reproduction steps:** Open `/code` → "Open Editor" → create a new file (`New File` icon → filename → Enter) → click into the Monaco editor → type any text as the very first edit action in this browser session (verified with plain text, JS with braces, and full HTML documents).
- **Expected:** `model.getValue()` returns exactly what was typed.
- **Actual:** The first character is missing from the start and reappears at the very end. Reproduced 3 independent times:
  - `"hello world no brackets here"` → stored as `"ello world no brackets hereh"`
  - `"function hello() {...}"` → stored as `"unction hello() {...}f"`
  - `"<!DOCTYPE html>...</html>"` → stored as `"!DOCTYPE html>...</html><"`
  - Verified via the authoritative `window.monaco.editor.getModels()[0].getValue()` API, not DOM scraping (DOM scraping of Monaco's virtualized `.view-line` nodes was tried first and is NOT a reliable source of truth — ruled out as the cause of the discrepancy).
  - Ruled out timing/speed as the cause: reproduced identically with zero wait before typing AND with a 1.5s post-mount + 300ms post-click settle delay plus slow (20ms/keystroke) typing. The one consistent variable is being the first Monaco instance edited in a fresh page session — a second file typed into within the same session did not show this specific displacement.
- **Severity:** CRITICAL. It is deterministic (not intermittent) for every fresh session's first edit, it is silent (no error, warning, or visual indicator), it corrupts the core "write code" workflow of the product, and it cascades into a second major feature: **opening Preview on the corrupted `index.html` renders visibly broken output** (`!DOCTYPE html>` appears as literal text, a stray `<` appears at the bottom) — a real user would very plausibly conclude "Preview is broken" when the actual defect is silent Editor corruption.
- **Root cause:** `aof-web/src/components/cocode/monaco-editor.tsx`. The editor is used in fully-**controlled** mode: `value={activeFile.content}` (line 187) is bound to a Zustand store field, and `onChange` (lines 212-216) writes every keystroke straight back into that same field via `updateFile()`. This creates: keystroke → `onChange` → Zustand write → React re-render → new `value` prop flows back into `@monaco-editor/react`. The component's own `useEffect` (lines 122-132, guarded by `currentPathRef`) only prevents redundant `model.setValue()` calls on *file-switch* — it does nothing to stop `@monaco-editor/react`'s own internal value-prop reconciliation from racing the user's live input, especially during the very first content transition away from an empty/initial model. This is the exact controlled-component anti-pattern `@monaco-editor/react`'s own documentation warns against.
- **File:** `aof-web/src/components/cocode/monaco-editor.tsx:122-132, 187, 212-216`
- **Recommended fix:** Stop binding `value` to store state on every render. Use Monaco in effectively-uncontrolled mode: seed initial content once via `onMount`/`defaultValue`, and only call `model.setValue()` explicitly for programmatic changes (file switch, AI-applied diffs) gated by an explicit revision/version check — never let the store's echo of the user's own `onChange` flow back into the `value` prop on the same keystroke cycle.

---

# High Priority Issues

### H1 — "Sign in" is a dead loop in demo mode
- **Reproduction steps:** In demo mode (`NEXT_PUBLIC_COAGENTIX_DEMO=1`, no Supabase secrets — this repo's own documented standard local/demo run mode), from any page, click the sidebar "Sign in" button.
- **Expected:** Land on `/login` and see the actual sign-in UI (Logo, "Sign in to Co.AI", "Continue with Google" button).
- **Actual:** Verified live via Playwright (`getByRole('link', {name: /sign in/i}).click()`): the URL ends up back at `http://localhost:3000/` and the sidebar still shows "Sign in" — `/login` is visited and immediately redirects back to Home without ever rendering.
- **Root cause:** `aof-web/src/app/login/page.tsx:18-22` — the redirect-away-if-authenticated effect checks `if (!user) return;`, but demo mode always supplies a synthetic `DEMO_USER` (`auth-provider.tsx:32-33,71-75`) even though there is no real session. Elsewhere in the same codebase, `aof-web/src/components/layout/user-menu.tsx:41-43` correctly distinguishes this exact case: `const realSession = configured && !!user;`, with an explicit comment explaining why. The login page's own redirect guard never applies that same distinction.
- **File:** `aof-web/src/app/login/page.tsx:18-22`
- **Recommended fix:** `if (!configured || !user) return;` — mirror `user-menu.tsx`'s `realSession` logic.
- **Impact:** In the exact configuration this repo documents as its standard local/demo mode, the ONLY path from anonymous/demo access to a real persistent account is completely unreachable.

### H2 — tmap-v2's Python sandbox is broken on Windows and attempts an unprompted network install during `npm test`
- **Reproduction steps:** `cd tmap-v2 && npm test` on Windows, with `python3` resolving via the Windows App Execution Alias (a real Python 3.12 is also separately installed via python.org).
- **Expected:** `runInSandbox({language:'python', code:'print(2+2)'})` returns `{success:true, stdout:'4'}`, or the test gracefully skips per its own name ("...or skips if python3 unavailable").
- **Actual:** `isPython3Available()` (full inherited env) correctly reports Python present, so the test does not skip — but the actual execution path (`runPython()`) spawns `python3` with a deliberately minimal environment (`{PATH, LANG}` only). Verified directly: with the full inherited environment, the same call succeeds (`stdout:"4"`); with the sandbox's stripped env, it instead times out after invoking Microsoft's Python Install Manager, which began silently downloading/installing Python 3.14.6 (`stderr` showed "Installing Python 3.14.6"/"Extracting...") before the 10s timeout killed it.
- **Root cause:** The Windows App Execution Alias for `python3.exe` needs additional environment context (likely `LOCALAPPDATA`/`USERPROFILE`/`SystemRoot`) to resolve to the already-installed real Python; deprived of it by the sandbox's security-motivated minimal-env policy, it falls back to "no Python installed, let me fetch one" — reaching the network during what should be a fully hermetic, offline test run.
- **Files:** `tmap-v2/src/core/sandbox.ts:140-150` (`runPython`, minimal env); `tmap-v2/src/tests/phase5.test.ts:255`, `tmap-v2/src/tests/phase5-platform.test.ts` (the skip-detection doesn't account for the sandbox's own restricted env).
- **Recommended fix:** Either (1) pass through the additional env vars Windows needs to resolve the alias (`LOCALAPPDATA`, `SystemRoot`, `USERPROFILE`) while still omitting `PYTHONPATH`/`HOME`, or (2) resolve the real python binary's absolute path once and invoke that directly instead of relying on `python3` resolving through PATH at execution time, or (3) make `isPython3Available()` do a full dry-run execution with the SAME restricted env `runPython` actually uses, so it skips correctly in this environment.
- **Impact:** (a) the Python code-exec sandbox — used by TMAP's code-exec tool — is non-functional for any Windows developer in this common configuration; (b) the test suite made an unprompted network/install attempt, breaking the hermeticity guarantees the rest of the codebase is otherwise careful about.
- Note: this is tmap-v2 (backend), not the CoCode web workspace itself, but it's a real bug surfaced by the requested "run all validation" static pass.

---

# Medium Priority Issues

### M1 — Flaky test: `turn-budget.test.ts` (aof-web)
- **Reproduction:** `npm test` in `aof-web`, particularly on a loaded machine.
- **Actual:** `AssertionError: 18999 !== 19000` in "the stream reserve is never encroached" — asserts `preStreamRemainingMs() === 19_000` via exact equality against wall-clock elapsed time. The sibling test immediately above it (lines 29-46) explicitly documents that exact-equality assertions against `Date.now()`-based elapsed time flake under scheduling jitter and uses a tolerant `<=`/`>=` check instead — this test didn't get the same treatment.
- **File:** `aof-web/src/tests/turn-budget.test.ts:61`
- **Fix:** Replace the exact-equality assertion with a tolerant bound, matching the pattern two tests above it.
- Not a product bug — `turn-budget.ts` itself is correct; this will cause intermittent CI red on slower/loaded runners.

### M2 — Editor's core dependency (Monaco) loads entirely from an external CDN with no evident local fallback
- **Observed:** Network trace during Editor use showed ~20 sequential requests to `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/...` (loader, editor core, language workers, CSS) before the editor becomes interactive (~4s on a fast unthrottled connection).
- **Risk:** If a user's network can't reach jsdelivr.net (corporate firewall, restricted region, CDN outage), the Editor — a core CoCode feature — has no evident local/self-hosted fallback and would fail to load entirely.
- **File:** `aof-web/src/components/cocode/monaco-editor.tsx:14-24` (dynamic import of `@monaco-editor/react`, which itself pulls Monaco's assets from the CDN by default).
- **Recommended fix:** Self-host Monaco's assets (webpack/Next.js supports bundling `monaco-editor` locally) or explicitly document this as an accepted tradeoff.

---

# Low Priority Polish

- **Hardcoded Thai `GENCODE_HINT` regardless of conversation language** — live-confirmed: an English conversation's fully-streamed AI reply ends with "✅ พร้อมแล้ว — กดปุ่ม Generate Code..." (Thai). File: `aof-web/src/lib/raa.ts` (`GENCODE_HINT`). Jarring first-impression inconsistency for non-Thai users, not functionally broken.
- **Deploy panel description overstates capability in one surface but not another.** The Deploy panel's own content is honest ("Export as ZIP", "Publish Live — Auto-detects your framework to suggest a hosting target"), but `adaptive-panels.ts`'s separate PANEL_DEFS description elsewhere says "Deploy to Vercel, Railway, or Render" — only ZIP export + GitHub Pages are actually implemented. File: `aof-web/src/lib/cocode/adaptive-panels.ts:69` (confirmed via code read, not re-verified live against a second UI surface this session).
- **Monaco tab bar's dirty/unsaved indicator is dead code.** `const dirty = false; // Would check fs` in `TabBar()` — the underlying `VirtualFile.dirty` field is real and correctly maintained elsewhere (GitHub panel's changed-files list), but tabs never surface it. File: `aof-web/src/components/cocode/monaco-editor.tsx:68`.
- **Sidebar "New Project" button (on `/code`) routes to the `/projects` gallery, not a fresh Build session** — a minor extra hop; not a bug since a fresh `/code` load already starts a clean session, but the button's destination may surprise a user expecting an immediate blank build.
- **GitHub panel's PR body is hardcoded** ("Generated by CoCode AI", not user-editable) — confirmed via code read in `github-panel.tsx`'s `handleOpenPR()`, not re-verified live (would require a real repo write, out of agreed scope).
- **Demo-mode AI responses to ambiguous/destructive prompts are generic canned templates**, not situationally relevant reasoning — expected for a mock engine, not a real-LLM defect, but worth knowing this specific behavior wasn't exercised against a real provider.
- **Preview device-size toggle (phone/tablet/desktop) was not located** within the session's time — not confirmed broken, just not found/tested; flagged for follow-up rather than scored as a defect.

---

# CoCode Workspace Assessment

CoCode reads as **one shell with a genuine shared chrome** — a single titlebar (project name, git branch chip, undo/redo, command palette), one persistent right-rail tab strip (Diff/GitHub/Deploy/Preview/Docs) that stays consistent across every panel, and one Zustand store (`cocode-ide-store.ts`) backing Editor/Diff/GitHub/Deploy/Preview simultaneously. Navigating between Build (Agent) and Editor via "Open Editor"/"Back to CoCode" felt like moving within one product, not switching apps — no full-page reload, no jarring layout reset, no lost sidebar/recent-projects context. Responsive behavior of this shell is strong (see Responsive Assessment).

Two things undercut the "unified workspace" promise specifically:
1. **The CRITICAL Editor corruption bug (C1)** breaks the most central step of the ASK→...→IMPLEMENT loop — typing code — silently, and its Preview cascade means a user could easily misattribute the failure to the wrong panel, undermining trust in the whole workspace, not just the Editor.
2. **In demo mode, "Generate Code" does not actually bridge into the Editor/Diff/Preview at all** — the mock engine is explicit about this ("In a live workspace you'd see the file tree, a diff view, and a one-click download"), so the generation→editor integration that is the heart of the unified-workspace pitch was not exercised end-to-end this session. This is honestly disclosed by the product itself (consistent with the "no fake workflows" governance rule), not a hidden defect — but it does mean this report cannot certify that leg of the loop.

Everything downstream of "already have files" (Editor mechanics, Diff empty/state handling, GitHub connect+OAuth+error-path, Deploy's honest capability disclosure, Preview's real HTML/CSS/JS execution and error relay) held together as one coherent product when tested directly with manually-created files.

---

# Agent Experience Assessment

The activity/progress model is real, not fabricated: streamed replies carry actual stage labels (Planner/Coder/Validator/Reviewer narrative during "Generate Code"; Requirement Analysis → Planning → Building narrative during brief-building), consistent with the `StageNotice`/`WorkflowProgress` architecture found in Phase-0 code review. The Project Brief panel correctly parses the AI's structured summary block once streaming completes (raw markers are only visible transiently mid-stream, which is expected and not a bug — confirmed by watching the same conversation settle).

Two caveats limit how far this assessment can go in demo mode: (1) the mock engine's answers to ambiguous/destructive prompts were generic canned templates rather than real reasoning or clarifying questions, and (2) the demo engine ignored an explicit user constraint ("no frameworks") and defaulted to a canned Next.js/TypeScript/Tailwind brief — both are almost certainly artifacts of the mock engine's canned nature, not verified against the real RAA/LLM-backed pipeline (would need a real provider key). The one live-confirmed real defect in this area is the hardcoded Thai `GENCODE_HINT` string appearing in an all-English conversation.

---

# Editor Assessment

File creation, tabs, multi-file switching (including 6x rapid switching with zero console errors), and Monaco's rendering (line numbers, correct per-language syntax mode) all work. The empty state ("No files yet. Connect a GitHub repo or paste AI-generated code.") is honest and well-designed. However, the CRITICAL first-keystroke corruption bug (C1) is disqualifying for a high score here — it is the single most severe finding in this report, sitting at the exact center of the product's core workflow.

---

# Preview Assessment

Genuinely functional: HTML, CSS, and JavaScript all render/execute correctly (verified with a custom page: styled heading rendered with correct color/background, and `document.getElementById(...).textContent = "JS executed: " + (2+2)` correctly updated the DOM to "JS executed: 4"). The console relay (iframe → parent via `postMessage`) correctly surfaced a deliberately-triggered `ReferenceError` as a red "2" badge on the Console sub-tab — errors are honestly reported, not swallowed. The earlier-observed "broken" preview (raw `!DOCTYPE` text visible) was conclusively traced back to the Editor corruption bug (C1), not a Preview defect. Device-size toggle controls were not located within session time — untested, not confirmed broken.

---

# GitHub Assessment

The strongest area of this audit. The Connect panel is honest about requirements ("Requires GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET in your environment"). The OAuth flow is real and correctly implemented: verified (without completing a live authorization, per agreed scope) that clicking "Sign in with GitHub" produces `PATCH /api/github` → 200, then navigates to a properly-formed `https://github.com/login/oauth/authorize` URL with the correct `client_id`, a `redirect_uri` pointing back to the app's own callback route, an appropriately scoped `scope=repo,read:user` (not excessive), and a CSRF `state` parameter. Error handling was also verified genuinely: forcing the OAuth-initiation call to fail with a 500 caused the app to display the actual server error text to the user, with no crash and no fake success state — real, honest error handling.

---

# Deploy Assessment

Deploy is honestly scoped in its own panel: a real, working "Export as ZIP" action, and a "Publish Live — Auto-detects your framework to suggest a hosting target" flow with a "Detect Config" button — no fake progress bar or fake deployment URL for unimplemented targets, consistent with Phase-0's code-level finding that Vercel/Netlify/Railway/Cloudflare honestly report "not configured." The one blemish is a copy inconsistency in a *different* UI surface (`adaptive-panels.ts`'s panel description, not re-verified live this session) that oversells the same feature as "Deploy to Vercel, Railway, or Render."

---

# Visual Design Assessment

Evaluated against `aof-web/DESIGN.md`. The CoCode workspace and surrounding shell consistently match the documented direction: hairline-border surfaces over shadows/elevation, a single accent color with no third-party brand colors leaking in, restrained/compact spacing appropriate for app UI, and clear empty states throughout (Editor, Diff, GitHub, Build) that follow the "what's the state, what can I do next" pattern §19 asks for. Checked contrast specifically in Light theme — including the mode-switcher **dropdown menu**, the exact class of surface (`.glass-strong`-style popovers) that `CLAUDE.md` documents as having caused a real historical bug — and found no regression; text/background pairs were readable throughout Settings (including the red-on-light Danger Zone) and the CoCode workspace. Titan mode correctly renders as locked (padlock badge, greyed styling), matching its documented intentionally-disabled state.

---

# Responsive Assessment

Strong. Tested Desktop (1440px), Tablet landscape (1024px), Tablet portrait (768px), and Narrow tablet (600px) on both the global shell and the CoCode workspace specifically. No horizontal overflow, no clipped content, and no broken split panels were found at any breakpoint. Specific good details: the Project Brief right panel hides below tablet-portrait rather than being squeezed into uselessness; the CoCode breadcrumb degrades from full text to icon-only buttons at narrow-tablet width instead of truncating illegibly; suggestion cards reflow from a 2-column to 1-column stack cleanly.

---

# Accessibility Assessment

Not independently re-verified via a live keyboard-navigation pass this session (time did not permit a full audit), but two independent sources — this session's own Phase-0 code review and the repo's own `AUDIT-REPORT.md` — agree: CoCode's core interactive surfaces (file tree, tabs, diff viewer) are built on non-semantic `<div>`s with no `data-testid` hooks and, more importantly, no keyboard focusability. This is corroborated by the project's own `qa-loop` harness, whose phase72/73 test files explicitly note they couldn't build reliable UI-automation against these elements for the same reason. This is treated as a confirmed, real gap (not freshly discovered, but not stale either — nothing in this session's live testing contradicted it), and is the primary reason the Accessibility score below is low.

---

# Performance Assessment

No major performance red flags found in the areas tested. The one evidence-backed observation is Monaco's ~4-second cold-load time driven by ~20 sequential external CDN requests (see M2) — a real, measured latency cost, not a guess. Rapid tab-switching (6x back-and-forth) produced no console errors or visible jank. No broader performance profiling (bundle size analysis, render-count instrumentation) was performed this session — recommendations are limited to what was directly observed.

---

# Reliability Assessment (folded into Scorecard below)

Dragged down primarily by C1 (silent, deterministic data corruption) and secondarily by the tmap-v2 sandbox issue (H2) and the flaky test (M1). Everything that didn't involve typing into a fresh Monaco session or the tmap-v2 Python sandbox was reliable across repeated testing (zero console errors across dozens of interactions, zero crashes, correct honest-failure behavior in GitHub's error path).

---

# Scorecard

| # | Category | Score | Evidence |
|---|---|---|---|
| 1 | Product coherence | 7/10 | One shell, one store, consistent chrome across Agent/Editor panels; undercut by the Sign-in dead loop and the demo-mode generation→file-bridge gap. |
| 2 | Unified CoCode workspace | 6/10 | Navigation between Build and Editor feels seamless with no state loss; but the CRITICAL corruption bug breaks the core loop, and generation→editor integration itself wasn't exercisable in demo mode. |
| 3 | Agent UX | 6/10 | Real, non-fabricated stage/activity labels; but demo-mode responses are generic canned templates and the Thai-hint bug is a real, confirmed defect. |
| 4 | Project Brief flow | 7/10 | Brief parses and structures correctly once streaming settles; demo mock ignored an explicit user constraint (caveat: mock-only, not verified against real LLM). |
| 5 | Editor | 3/10 | File/tab mechanics and Monaco rendering work, but the CRITICAL silent first-keystroke corruption bug is disqualifying. |
| 6 | Diff | 7/10 | Correct, honest empty state; could not verify a populated diff's line-accuracy live (blocked by the demo-mode generation gap) — hermetic unit tests for `diffStats()` do pass. |
| 7 | GitHub | 9/10 | Real, correctly-scoped, CSRF-protected OAuth flow; genuine honest error handling verified live. Strongest area of the audit. |
| 8 | Deploy | 8/10 | Honest, accurately-scoped panel content (ZIP export + framework-detect); one copy mismatch in a separate UI surface, not re-verified live. |
| 9 | Preview | 8/10 | Real HTML/CSS/JS execution confirmed; console-error relay confirmed working; device-size toggle unverified (not located, not scored as broken). |
| 10 | Error handling | 7/10 | GitHub's real error path is honest and robust; AI-chat error handling could not be exercised at all in demo mode (no network calls made) — an evidence gap, not a pass or fail. |
| 11 | Accessibility | 4/10 | Corroborated (not freshly re-verified) lack of keyboard focus/testid hooks on CoCode's core interactive elements, from two independent sources. |
| 12 | Responsive design | 9/10 | Zero overflow/clipping across 4 breakpoints on both the global shell and CoCode workspace; thoughtful reflow details throughout. |
| 13 | Visual design | 8/10 | Consistent with DESIGN.md's documented system; verified no contrast regression in Light theme including the historically-risky dropdown/popover surface. |
| 14 | Performance | 6/10 | No major issues found in what was tested; one real, measured latency/reliability cost (Monaco's external CDN dependency). |
| 15 | Reliability | 5/10 | One CRITICAL silent-corruption bug and one HIGH backend sandbox bug outweigh an otherwise error-free, crash-free session across dozens of interactions. |

**Overall: 6.3 / 10** (unweighted mean)

---

# Recommended Fix Order

**P0 — Critical**
- Fix the Monaco controlled-value race causing silent first-keystroke content corruption (C1). This is the single highest-priority fix in this report — it silently corrupts user work in the core editing workflow of the product.

**P1 — High impact**
- Fix the `/login` redirect guard so demo-mode's stand-in user doesn't make Sign In unreachable (H1).
- Fix or work around the Windows Python sandbox environment issue in tmap-v2, and stop the test suite from being able to trigger a real network install attempt (H2).

**P2 — Medium**
- Fix the flaky `turn-budget.test.ts` assertion (M1) — cheap, mechanical fix, prevents intermittent CI noise.
- Decide and document (or fix) Monaco's external CDN dependency (M2) — either self-host or explicitly accept the tradeoff.

**P3 — Polish**
- Remove/localize the hardcoded Thai `GENCODE_HINT`.
- Reconcile the Deploy panel's capability description across UI surfaces (`adaptive-panels.ts` vs. the panel itself).
- Wire up the Monaco tab bar's dirty indicator (the underlying data already exists).
- Consider making the sidebar "New Project" button start a fresh Build session directly rather than routing through the Projects gallery.
- Make the GitHub PR body editable rather than hardcoded.

---

# Evidence Appendix

Full reproduction steps, expected/actual output, and file references for every finding above are included inline in the sections above (Critical/High/Medium/Low Issues and the per-area Assessments). Screenshots and raw script output backing every claim were captured during this session under a scratch directory and are available on request; key screenshots referenced during investigation include the Editor empty state, the light-theme mode dropdown (Titan-locked confirmation), the corrupted `index.html` Preview render, the GitHub Connect panel and its OAuth redirect capture, and the Deploy panel.

**A note on test-environment limitations, stated plainly:** this session ran entirely in demo mode with no real AI provider key and no completed GitHub authorization, per agreed scope. This was the right tradeoff for safety and cost, but it means two categories of testing could not be done to full depth: (1) real generation→Editor/Diff file-bridge integration, and (2) real AI-path network-failure recovery. Both are flagged explicitly above rather than silently skipped or falsely reported as passing.
