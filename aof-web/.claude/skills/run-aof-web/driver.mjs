#!/usr/bin/env node
// Driver for the aof-web run skill. Node-based (no chromium-cli on this
// machine), scoped to this unit's own `playwright` devDependency.
//
// Usage (run from aof-web/):
//   node .claude/skills/run-aof-web/driver.mjs smoke [outDir]
//   node .claude/skills/run-aof-web/driver.mjs shot <route> <outfile>
//   node .claude/skills/run-aof-web/driver.mjs chat <message> <outfile>
//
// Assumes the dev server is already running on http://localhost:3000
// (see SKILL.md "Run (agent path)" for how to launch it).

import { chromium } from "playwright";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

const BASE = process.env.AOF_WEB_BASE_URL ?? "http://localhost:3000";
const ROUTES = ["/", "/chat", "/code", "/projects", "/settings", "/login"];

// Playwright hard-pins a browser revision; when only a different revision is
// cached (common on pre-provisioned machines), launch() fails asking for a
// download. Resolve a usable binary instead: explicit env override first, the
// pinned revision if present, then any chromium build in the browsers dir.
function chromiumExecutablePath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (override) return override;
  try {
    if (existsSync(chromium.executablePath())) return undefined; // pinned revision is installed
  } catch {
    /* fall through to the cache scan */
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    for (const dir of readdirSync(root)) {
      if (!/^chromium-\d+$/.test(dir)) continue;
      for (const rel of ["chrome-linux/chrome", "chrome-win/chrome.exe", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const candidate = join(root, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined; // let Playwright raise its usual install hint
}

async function withPage(fn) {
  const browser = await chromium.launch({ executablePath: chromiumExecutablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const result = await fn(page, consoleErrors);
    return { result, consoleErrors };
  } finally {
    await browser.close();
  }
}

async function cmdSmoke(outDir = ".driver-shots") {
  const fs = await import("fs");
  fs.mkdirSync(outDir, { recursive: true });
  for (const route of ROUTES) {
    const { consoleErrors } = await withPage(async (page) => {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const name = route === "/" ? "home" : route.slice(1).replace(/\//g, "_");
      await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
    });
    const status = consoleErrors.length ? `ERRORS: ${JSON.stringify(consoleErrors)}` : "ok";
    console.log(`${route} -> ${status}`);
  }
}

async function cmdShot(route, outfile) {
  const { consoleErrors } = await withPage(async (page) => {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: outfile, fullPage: true });
  });
  console.log("console errors:", JSON.stringify(consoleErrors));
}

async function cmdChat(message, outfile) {
  const { consoleErrors } = await withPage(async (page) => {
    await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
    const input = page.getByPlaceholder(/Message Co\.AI/i);
    await input.click();
    await input.fill(message);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: outfile, fullPage: true });
  });
  console.log("console errors:", JSON.stringify(consoleErrors));
}

const [, , cmd, ...args] = process.argv;
switch (cmd) {
  case "smoke":
    await cmdSmoke(...args);
    break;
  case "shot":
    if (args.length < 2) throw new Error("usage: shot <route> <outfile>");
    await cmdShot(...args);
    break;
  case "chat":
    if (args.length < 2) throw new Error("usage: chat <message> <outfile>");
    await cmdChat(...args);
    break;
  default:
    console.error("usage: driver.mjs <smoke|shot|chat> [args]");
    process.exit(1);
}
