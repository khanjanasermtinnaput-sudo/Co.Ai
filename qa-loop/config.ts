import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env from the qa-loop directory (not dotenv package — avoids dep)
const envPath = resolve(import.meta.dirname ?? ".", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? "");
  return isNaN(v) ? fallback : v;
}

export const config = {
  baseUrl: env("QA_BASE_URL", "https://aof-web.vercel.app"),
  backendUrl: env("QA_BACKEND_URL", "https://aof-code.onrender.com"),
  testEmail: env("QA_TEST_EMAIL"),
  testPassword: env("QA_TEST_PASSWORD"),
  supabaseUrl: env("QA_SUPABASE_URL", "https://xuupsckszsujfnrzodtw.supabase.co"),
  supabaseAnonKey: env("QA_SUPABASE_ANON_KEY"),
  headless: env("QA_HEADLESS", "true") !== "false",
  screenshots: env("QA_SCREENSHOTS", "true") !== "false",
  timeoutMs: envInt("QA_TIMEOUT_MS", 30_000),
  maxStressUsers: Math.min(envInt("QA_MAX_STRESS_USERS", 100), 1000),
  reportDir: env("QA_REPORT_DIR", "./reports"),
  loopIntervalMs: envInt("QA_LOOP_INTERVAL_MS", 60_000),
  phases: env("QA_PHASES")
    ? env("QA_PHASES").split(",").map(Number).filter((n) => !isNaN(n))
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
};

export type Config = typeof config;
