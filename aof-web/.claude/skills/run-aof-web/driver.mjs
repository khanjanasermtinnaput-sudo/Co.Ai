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

const BASE = process.env.AOF_WEB_BASE_URL ?? "http://localhost:3000";
const ROUTES = ["/", "/chat", "/code", "/projects", "/settings", "/login"];

async function withPage(fn) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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
