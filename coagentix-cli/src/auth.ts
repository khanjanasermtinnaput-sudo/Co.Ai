// Auth: store CLI credentials in ~/.coai/config.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR  = join(homedir(), ".coai");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface CoaiConfig {
  jwt: string;
  userId: string;
  email: string;
  tier: string;
  apiBase: string;
  savedAt: string;
  deviceFingerprint?: string; // zero trust: hardware fingerprint at login time
  lastVerified?: string;      // zero trust: last successful server-side token check
}

export function loadConfig(): CoaiConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as CoaiConfig;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: CoaiConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, "{}", { encoding: "utf8", mode: 0o600 });
  }
}

export function isLoggedIn(): boolean {
  const cfg = loadConfig();
  return Boolean(cfg?.jwt);
}

export function requireLogin(): CoaiConfig {
  const cfg = loadConfig();
  if (!cfg?.jwt) {
    console.error("Not logged in. Run: coai login");
    process.exit(1);
  }
  return cfg;
}

export function defaultApiBase(): string {
  return process.env.COAI_API_BASE ?? "https://tmap.coagentix.com";
}
