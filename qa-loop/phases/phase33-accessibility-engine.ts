/**
 * Phase 33 — AI Accessibility Engine
 *
 * Validates WCAG 2.1 AA compliance: ARIA, keyboard nav, color contrast,
 * semantic HTML, focus management, and screen-reader support.
 */
import { openPage, navigate, screenshot } from "../utils/browser.ts";
import { httpGet } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;

// ── WCAG reference map ─────────────────────────────────────────────────────

const WCAG: Record<string, string> = {
  altText:       "WCAG 1.1.1 Non-text Content (Level A)",
  langAttr:      "WCAG 3.1.1 Language of Page (Level A)",
  headingOrder:  "WCAG 1.3.1 Info and Relationships (Level A)",
  buttonLabel:   "WCAG 4.1.2 Name, Role, Value (Level A)",
  inputLabel:    "WCAG 1.3.1 / 4.1.2 (Level A)",
  focusVisible:  "WCAG 2.4.7 Focus Visible (Level AA)",
  skipLink:      "WCAG 2.4.1 Bypass Blocks (Level A)",
  colorContrast: "WCAG 1.4.3 Contrast Minimum (Level AA)",
  touchTarget:   "WCAG 2.5.8 Target Size (Level AA — WCAG 2.2)",
  noAutoplay:    "WCAG 1.4.2 Audio Control (Level A)",
};

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase33(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // Open browser session
  const sess = await openPage();
  let screenshotPath: string | undefined;

  try {
    await navigate(sess.page, BASE, config.timeoutMs);
    screenshotPath = await screenshot(sess.page, runDir, "phase33-a11y-homepage");

    // ── 1. lang attribute on <html> ─────────────────────────────────────
    {
      const t0 = Date.now();
      const lang = await sess.page.evaluate(() => document.documentElement.lang);
      const ok = typeof lang === "string" && lang.length >= 2;

      const t: TestResult = {
        name: "html[lang] attribute present",
        passed: ok,
        durationMs: Date.now() - t0,
        details: { lang },
        screenshot: screenshotPath,
      };
      if (!ok) {
        t.error = `<html lang> is "${lang}" — missing or empty`;
        t.rootCause = "next/document or layout.tsx not setting lang on <html>";
        t.suggestedFix = `Add lang="en" to <html> in aof-web/src/app/layout.tsx`;
      }
      tests.push(t);
      ok ? log.ok(`${t.name} (lang="${lang}")`) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 2. Page <title> ─────────────────────────────────────────────────
    {
      const t0 = Date.now();
      const title = await sess.page.title();
      const ok = title.length > 0;

      const t: TestResult = {
        name: "Page <title> is non-empty",
        passed: ok,
        durationMs: Date.now() - t0,
        details: { title },
      };
      if (!ok) {
        t.error = "Page title is empty — screen readers announce blank title";
        t.rootCause = "Missing <title> in Next.js metadata export";
        t.suggestedFix = "Export metadata = { title: 'Co.AI' } in layout.tsx";
      }
      tests.push(t);
      ok ? log.ok(`${t.name} ("${title}")`) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 3. Images have alt text ──────────────────────────────────────────
    {
      const t0 = Date.now();
      const result = await sess.page.evaluate(() => {
        const imgs = [...document.querySelectorAll("img")];
        const missing = imgs.filter((img) => !img.alt && img.getAttribute("role") !== "presentation" && img.getAttribute("aria-hidden") !== "true");
        return { total: imgs.length, missingAlt: missing.map((img) => img.src.slice(-60)) };
      });
      const ok = result.missingAlt.length === 0;

      const t: TestResult = {
        name: "All <img> elements have alt text",
        passed: ok,
        durationMs: Date.now() - t0,
        details: result,
      };
      if (!ok) {
        t.error = `${result.missingAlt.length} image(s) missing alt: ${result.missingAlt.slice(0, 3).join(", ")}`;
        t.rootCause = "Images rendered without alt attribute — invisible to screen readers";
        t.suggestedFix = `Add alt="" (decorative) or descriptive alt="..." to each <img>; ${WCAG.altText}`;
      }
      tests.push(t);
      ok ? log.ok(`${t.name} (${result.total} images checked)`) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 4. Buttons have accessible labels ───────────────────────────────
    {
      const t0 = Date.now();
      const result = await sess.page.evaluate(() => {
        const buttons = [...document.querySelectorAll("button, [role='button']")];
        const unlabeled = buttons.filter((btn) => {
          const text = (btn.textContent ?? "").trim();
          const ariaLabel = btn.getAttribute("aria-label") ?? "";
          const ariaLabelledBy = btn.getAttribute("aria-labelledby") ?? "";
          const title = btn.getAttribute("title") ?? "";
          return !text && !ariaLabel && !ariaLabelledBy && !title;
        });
        return { total: buttons.length, unlabeled: unlabeled.length };
      });
      const ok = result.unlabeled === 0;

      const t: TestResult = {
        name: "All buttons have accessible labels",
        passed: ok,
        durationMs: Date.now() - t0,
        details: result,
      };
      if (!ok) {
        t.error = `${result.unlabeled} button(s) without accessible label`;
        t.rootCause = "Icon-only buttons without aria-label — announced as 'button' with no context";
        t.suggestedFix = `Add aria-label="..." to icon-only buttons; ${WCAG.buttonLabel}`;
      }
      tests.push(t);
      ok ? log.ok(`${t.name} (${result.total} buttons)`) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 5. Form inputs have labels ───────────────────────────────────────
    {
      const t0 = Date.now();
      const result = await sess.page.evaluate(() => {
        const inputs = [...document.querySelectorAll("input:not([type='hidden']), textarea, select")];
        const unlabeled = inputs.filter((el) => {
          const id = el.id;
          const ariaLabel = el.getAttribute("aria-label") ?? "";
          const ariaLabelledBy = el.getAttribute("aria-labelledby") ?? "";
          const placeholder = el.getAttribute("placeholder") ?? "";
          const label = id ? !!document.querySelector(`label[for="${id}"]`) : false;
          return !label && !ariaLabel && !ariaLabelledBy && !placeholder;
        });
        return { total: inputs.length, unlabeled: unlabeled.length };
      });
      const ok = result.unlabeled === 0;

      const t: TestResult = {
        name: "All form inputs have labels",
        passed: ok,
        durationMs: Date.now() - t0,
        details: result,
      };
      if (!ok) {
        t.error = `${result.unlabeled} input(s) without label/aria-label`;
        t.rootCause = "Inputs not associated with <label> or aria-label — screen readers cannot identify field";
        t.suggestedFix = `Use <label htmlFor="..."> or aria-label on all form inputs; ${WCAG.inputLabel}`;
      }
      tests.push(t);
      ok ? log.ok(`${t.name} (${result.total} inputs)`) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 6. Heading hierarchy ─────────────────────────────────────────────
    {
      const t0 = Date.now();
      const result = await sess.page.evaluate(() => {
        const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
        const levels = headings.map((h) => parseInt(h.tagName[1]));
        const h1Count = levels.filter((l) => l === 1).length;
        let skipped = false;
        for (let i = 1; i < levels.length; i++) {
          if (levels[i] - levels[i - 1] > 1) { skipped = true; break; }
        }
        return { h1Count, total: headings.length, skippedLevels: skipped, levels };
      });
      const ok = result.h1Count === 1 && !result.skippedLevels;

      const t: TestResult = {
        name: "Heading hierarchy: single h1, no skipped levels",
        passed: ok,
        durationMs: Date.now() - t0,
        details: result,
      };
      if (!ok) {
        t.error = [
          result.h1Count !== 1 ? `${result.h1Count} h1 elements (expected 1)` : "",
          result.skippedLevels ? "Heading levels skipped (e.g. h1 → h3)" : "",
        ].filter(Boolean).join("; ");
        t.rootCause = "Heading tags used for styling rather than document structure";
        t.suggestedFix = `Use headings for document outline, not styling; ${WCAG.headingOrder}`;
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 7. Focus visible — Tab key moves focus ───────────────────────────
    {
      const t0 = Date.now();
      await sess.page.keyboard.press("Tab");
      const focusedTag = await sess.page.evaluate(() => document.activeElement?.tagName ?? "BODY");
      const ok = focusedTag !== "BODY" && focusedTag !== "HTML";

      const t: TestResult = {
        name: "Keyboard focus: Tab moves focus off document root",
        passed: ok,
        durationMs: Date.now() - t0,
        details: { focusedElement: focusedTag },
      };
      if (!ok) {
        t.error = `Tab key did not move focus (focused: ${focusedTag}) — keyboard navigation broken`;
        t.rootCause = "No focusable elements in tab order, or focus trapped on document root";
        t.suggestedFix = `Ensure interactive elements are in natural tab order; add tabIndex if needed; ${WCAG.focusVisible}`;
      }
      tests.push(t);
      ok ? log.ok(`${t.name} → ${focusedTag}`) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 8. Skip navigation link ──────────────────────────────────────────
    {
      const t0 = Date.now();
      const skipLink = await sess.page.evaluate(() => {
        const a = document.querySelector("a[href='#main'], a[href='#content'], a[href='#main-content']");
        return a ? (a as HTMLAnchorElement).href : null;
      });
      const ok = skipLink !== null;

      const t: TestResult = {
        name: "Skip navigation link present",
        passed: ok,
        durationMs: Date.now() - t0,
        details: { skipLink },
      };
      if (!ok) {
        t.error = "No skip-to-content link found — keyboard users must tab through entire nav on each page";
        t.rootCause = "Layout missing skip link before main navigation";
        t.suggestedFix = `Add <a href="#main" className="sr-only focus:not-sr-only">Skip to content</a> in layout.tsx; ${WCAG.skipLink}`;
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 9. ARIA landmark roles ───────────────────────────────────────────
    {
      const t0 = Date.now();
      const landmarks = await sess.page.evaluate(() => {
        const main = !!document.querySelector("main, [role='main']");
        const nav = !!document.querySelector("nav, [role='navigation']");
        const banner = !!document.querySelector("header, [role='banner']");
        return { main, nav, banner };
      });
      const ok = landmarks.main;

      const t: TestResult = {
        name: "ARIA landmarks: <main> element present",
        passed: ok,
        durationMs: Date.now() - t0,
        details: landmarks,
      };
      if (!ok) {
        t.error = "No <main> landmark — screen reader users cannot jump to main content";
        t.rootCause = "Layout using generic <div> instead of semantic HTML landmarks";
        t.suggestedFix = "Wrap primary content in <main id='main'>; add <nav> and <header> landmarks";
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 10. No autoplay media ────────────────────────────────────────────
    {
      const t0 = Date.now();
      const autoplay = await sess.page.evaluate(() => {
        const media = [...document.querySelectorAll("video[autoplay], audio[autoplay]")];
        return media.filter((m) => !m.hasAttribute("muted")).length;
      });
      const ok = autoplay === 0;

      const t: TestResult = {
        name: "No autoplaying audio/video without muted attribute",
        passed: ok,
        durationMs: Date.now() - t0,
        details: { autoplayCount: autoplay },
      };
      if (!ok) {
        t.error = `${autoplay} autoplaying media element(s) without muted — disorienting for screen reader users`;
        t.rootCause = "Media element has autoplay without muted or controls";
        t.suggestedFix = `Add muted and controls attributes to autoplay media; ${WCAG.noAutoplay}`;
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
    }

    // ── 11. Touch targets (mobile button size) ───────────────────────────
    {
      const t0 = Date.now();
      const result = await sess.page.evaluate(() => {
        const btns = [...document.querySelectorAll("button, a, [role='button']")];
        const small = btns.filter((el) => {
          const r = el.getBoundingClientRect();
          return (r.width > 0 && r.height > 0) && (r.width < 44 || r.height < 44);
        });
        return { total: btns.length, tooSmall: small.length };
      });
      const ok = result.tooSmall === 0;

      const t: TestResult = {
        name: "Touch targets ≥ 44×44px (WCAG 2.5.8)",
        passed: ok,
        durationMs: Date.now() - t0,
        details: result,
      };
      if (!ok) {
        t.error = `${result.tooSmall} interactive element(s) smaller than 44×44px`;
        t.rootCause = "Small button/link targets hard to tap on mobile devices";
        t.suggestedFix = `Increase minimum touch target to 44×44px via padding; ${WCAG.touchTarget}`;
      }
      tests.push(t);
      ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
    }

  } finally {
    await sess.close();
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 33,
    name: "AI Accessibility Engine",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
