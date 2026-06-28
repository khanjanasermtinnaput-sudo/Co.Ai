import { chromium, type Browser, type BrowserContext, type Page, type ConsoleMessage } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: config.headless });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export interface PageSession {
  page: Page;
  ctx: BrowserContext;
  errors: string[];
  failedRequests: Array<{ url: string; status: number }>;
  close: () => Promise<void>;
}

/** Open a fresh browser context+page with console/network listeners attached. */
export async function openPage(opts: {
  viewport?: { width: number; height: number };
  token?: string;
} = {}): Promise<PageSession> {
  const br = await getBrowser();
  const ctx = await br.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    extraHTTPHeaders: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
  });

  const page = await ctx.newPage();
  const errors: string[] = [];
  const failedRequests: Array<{ url: string; status: number }> = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err: Error) => errors.push(`PAGE ERROR: ${err.message}`));
  page.on("response", (resp) => {
    if (resp.status() >= 400 && !resp.url().includes("favicon")) {
      failedRequests.push({ url: resp.url(), status: resp.status() });
    }
  });

  return {
    page,
    ctx,
    errors,
    failedRequests,
    close: async () => { await ctx.close(); },
  };
}

/** Take a screenshot to the run's screenshot dir. Returns absolute path. */
export async function screenshot(
  page: Page,
  runDir: string,
  name: string,
): Promise<string | undefined> {
  if (!config.screenshots) return undefined;
  const dir = resolve(runDir, "screenshots");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${name}-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}

/** Navigate and wait for networkidle. Returns load time in ms. */
export async function navigate(page: Page, url: string, timeoutMs: number): Promise<number> {
  const start = Date.now();
  await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  return Date.now() - start;
}
