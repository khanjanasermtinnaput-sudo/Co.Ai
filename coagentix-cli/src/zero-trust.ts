// Zero Trust Security: device fingerprint, session anomaly detection, token revocation, audit trail

import { createHash } from "node:crypto";
import { networkInterfaces, hostname, userInfo, arch, platform } from "node:os";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { saveConfig, type CoaiConfig } from "./auth.js";
import type { CoaiApiClient } from "./api.js";

const COAI_DIR   = join(homedir(), ".coai");
const AUDIT_FILE = join(COAI_DIR, "audit.log");

// ── Device Fingerprint ─────────────────────────────────────────────────────────

export function generateDeviceFingerprint(): string {
  const nets = networkInterfaces();
  const macs = Object.values(nets)
    .flat()
    .filter((n): n is NonNullable<typeof n> => !!n && !n.internal)
    .map((n) => (n as { mac?: string }).mac ?? "")
    .filter((m) => m && m !== "00:00:00:00:00:00")
    .sort()
    .join(",");

  const raw = [hostname(), platform(), arch(), userInfo().username, macs].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

// ── Audit Trail ────────────────────────────────────────────────────────────────

export interface AuditEvent {
  ts: string;
  userId: string;
  action: string;
  result: "ok" | "denied" | "error";
  device?: string;
  details?: Record<string, unknown>;
}

export function recordAudit(event: AuditEvent): void {
  try {
    mkdirSync(COAI_DIR, { recursive: true, mode: 0o700 });
    appendFileSync(AUDIT_FILE, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch {
    // Audit failure must never crash the CLI
  }
}

// ── Session Anomaly Detection ──────────────────────────────────────────────────

export function detectSessionAnomaly(cfg: CoaiConfig): { anomaly: boolean; reason?: string } {
  if (cfg.deviceFingerprint) {
    const current = generateDeviceFingerprint();
    if (current !== cfg.deviceFingerprint) {
      return {
        anomaly: true,
        reason: `Device fingerprint mismatch — possible session hijack. Run: coai login`,
      };
    }
  }

  const ageDays = (Date.now() - new Date(cfg.savedAt).getTime()) / 86_400_000;
  if (ageDays > 30) {
    return {
      anomaly: true,
      reason: `Session is ${Math.floor(ageDays)} days old — please re-authenticate: coai login`,
    };
  }

  return { anomaly: false };
}

// ── Rate Limiter ───────────────────────────────────────────────────────────────

const _timestamps: number[] = [];
const WINDOW_MS   = 60_000;
const MAX_PER_MIN = 30;

export function checkRateLimit(): { allowed: boolean; remaining: number } {
  const now = Date.now();
  while (_timestamps.length && _timestamps[0]! < now - WINDOW_MS) _timestamps.shift();
  if (_timestamps.length >= MAX_PER_MIN) return { allowed: false, remaining: 0 };
  _timestamps.push(now);
  return { allowed: true, remaining: MAX_PER_MIN - _timestamps.length };
}

// ── Token Revocation Check ─────────────────────────────────────────────────────

const REVERIFY_MS = 5 * 60_000; // re-verify every 5 minutes

export async function verifyTokenIfStale(
  api: CoaiApiClient,
  cfg: CoaiConfig,
): Promise<{ valid: boolean; reason?: string }> {
  const lastVerified = cfg.lastVerified ? new Date(cfg.lastVerified).getTime() : 0;
  if (Date.now() - lastVerified < REVERIFY_MS) return { valid: true };

  try {
    await api.getStatus();
    saveConfig({ ...cfg, lastVerified: new Date().toISOString() });
    return { valid: true };
  } catch (err: unknown) {
    const msg = String(err).toLowerCase();
    if (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("unauthorized") ||
      msg.includes("revoked") ||
      msg.includes("forbidden")
    ) {
      return { valid: false, reason: "Token has been revoked or expired. Run: coai login" };
    }
    // Network error — fail open to avoid blocking offline use
    return { valid: true };
  }
}

// ── Zero Trust Session Guard ───────────────────────────────────────────────────

export async function enforceZeroTrust(
  api: CoaiApiClient,
  cfg: CoaiConfig,
  action: string,
): Promise<void> {
  const device = generateDeviceFingerprint();

  // 1. Rate limiting
  const { allowed } = checkRateLimit();
  if (!allowed) {
    recordAudit({
      ts: new Date().toISOString(),
      userId: cfg.userId,
      action,
      result: "denied",
      device,
      details: { reason: "rate_limited" },
    });
    console.error("Rate limit exceeded (30 commands/min). Slow down.");
    process.exit(1);
  }

  // 2. Session anomaly detection
  const { anomaly, reason } = detectSessionAnomaly(cfg);
  if (anomaly) {
    recordAudit({
      ts: new Date().toISOString(),
      userId: cfg.userId,
      action,
      result: "denied",
      device,
      details: { reason },
    });
    console.error(`Security alert: ${reason}`);
    process.exit(1);
  }

  // 3. Server-side token revocation check (every 5 min)
  const { valid, reason: revokeReason } = await verifyTokenIfStale(api, cfg);
  if (!valid) {
    recordAudit({
      ts: new Date().toISOString(),
      userId: cfg.userId,
      action,
      result: "denied",
      device,
      details: { reason: revokeReason },
    });
    console.error(revokeReason);
    process.exit(1);
  }

  // 4. Record successful access
  recordAudit({ ts: new Date().toISOString(), userId: cfg.userId, action, result: "ok", device });
}
