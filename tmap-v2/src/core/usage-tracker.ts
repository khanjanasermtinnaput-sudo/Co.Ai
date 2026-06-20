// Per-user usage quota enforcement — Phase 5
//
// Tracks daily and monthly: token consumption, USD cost, requests, and sandbox
// executions.  Quota limits are read from env vars (with generous defaults) and
// can be set to 0 to disable a specific limit entirely.
//
// Storage: one JSON file per user in AOF_USAGE_DIR (default .aof-server/usage/).
// On Vercel the dir is under /tmp (ephemeral) — same trade-off as the main DB.
//
// Thread safety: Node.js is single-threaded, so load/save is synchronous and
// safe.  On multi-instance deployments each instance has its own store, so
// limits are per-instance (same known limitation as the login rate limiter).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { UsageQuota, UsagePeriod, QuotaStatus } from '../types.js';

// ── Default quota (env-configurable) ──────────────────────────────────────────
export const DEFAULT_QUOTA: UsageQuota = {
  dailyTokens:       Number(process.env.AOF_DAILY_TOKEN_LIMIT    || 500_000),
  monthlyTokens:     Number(process.env.AOF_MONTHLY_TOKEN_LIMIT  || 5_000_000),
  dailyCostUsd:      Number(process.env.AOF_DAILY_COST_LIMIT     || 5.0),
  monthlyCostUsd:    Number(process.env.AOF_MONTHLY_COST_LIMIT   || 50.0),
  sandboxRunsPerDay: Number(process.env.AOF_SANDBOX_DAILY_LIMIT  || 100),
};

// ── Storage path ───────────────────────────────────────────────────────────────
const USAGE_DIR = process.env.AOF_USAGE_DIR
  ?? (process.env.VERCEL ? '/tmp/aof-usage' : join(process.cwd(), '.aof-server', 'usage'));

// ── Date helpers (UTC so limits reset at midnight UTC regardless of server TZ) ─
function dayKey():   string { return new Date().toISOString().slice(0, 10); }
function monthKey(): string { return new Date().toISOString().slice(0, 7);  }

// ── Per-user file ──────────────────────────────────────────────────────────────
interface UserUsageFile {
  byDay:   Record<string, UsagePeriod>;
  byMonth: Record<string, { tokens: number; costUsd: number; requests: number }>;
}

function emptyPeriod(): UsagePeriod {
  return { tokens: 0, costUsd: 0, requests: 0, sandboxRuns: 0 };
}

function usageFile(userId: string): string {
  // userId is a UUID (hex+dashes). Safe as a filename.
  return join(USAGE_DIR, `${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function load(userId: string): UserUsageFile {
  const path = usageFile(userId);
  if (!existsSync(path)) return { byDay: {}, byMonth: {} };
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as UserUsageFile;
  } catch {
    return { byDay: {}, byMonth: {} };
  }
}

function save(userId: string, data: UserUsageFile): void {
  const path = usageFile(userId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Record token/cost consumption after a TMAP run completes. */
export function recordUsage(
  userId: string,
  delta: { tokens: number; costUsd: number },
): void {
  const data  = load(userId);
  const day   = dayKey();
  const month = monthKey();

  const dayRec   = { ...emptyPeriod(), ...data.byDay[day] };
  dayRec.tokens   += delta.tokens;
  dayRec.costUsd   = round8(dayRec.costUsd + delta.costUsd);
  dayRec.requests += 1;
  data.byDay[day] = dayRec;

  const monRec   = { tokens: 0, costUsd: 0, requests: 0, ...data.byMonth[month] };
  monRec.tokens   += delta.tokens;
  monRec.costUsd   = round8(monRec.costUsd + delta.costUsd);
  monRec.requests += 1;
  data.byMonth[month] = monRec;

  save(userId, data);
}

/** Increment sandbox run counter for today. */
export function recordSandboxRun(userId: string): void {
  const data  = load(userId);
  const day   = dayKey();
  const dayRec = { ...emptyPeriod(), ...data.byDay[day] };
  dayRec.sandboxRuns += 1;
  data.byDay[day] = dayRec;
  save(userId, data);
}

/** Check whether the user is within all quota limits. */
export function checkQuota(
  userId: string,
  quota: UsageQuota = DEFAULT_QUOTA,
): QuotaStatus {
  const data = load(userId);
  const today    = { ...emptyPeriod(), ...data.byDay[dayKey()] };
  const thisMonth = { tokens: 0, costUsd: 0, requests: 0, ...data.byMonth[monthKey()] };

  let ok = true;
  let reason: string | undefined;

  if (quota.dailyTokens > 0 && today.tokens >= quota.dailyTokens) {
    ok = false;
    reason = `Daily token limit reached (${today.tokens.toLocaleString()} / ${quota.dailyTokens.toLocaleString()})`;
  } else if (quota.monthlyTokens > 0 && thisMonth.tokens >= quota.monthlyTokens) {
    ok = false;
    reason = `Monthly token limit reached (${thisMonth.tokens.toLocaleString()} / ${quota.monthlyTokens.toLocaleString()})`;
  } else if (quota.dailyCostUsd > 0 && today.costUsd >= quota.dailyCostUsd) {
    ok = false;
    reason = `Daily cost limit reached ($${today.costUsd.toFixed(4)} / $${quota.dailyCostUsd.toFixed(2)})`;
  } else if (quota.monthlyCostUsd > 0 && thisMonth.costUsd >= quota.monthlyCostUsd) {
    ok = false;
    reason = `Monthly cost limit reached ($${thisMonth.costUsd.toFixed(4)} / $${quota.monthlyCostUsd.toFixed(2)})`;
  }

  return { ok, reason, daily: today, monthly: thisMonth, quota };
}

/** Dedicated sandbox quota check (separate from token/cost limits). */
export function checkSandboxQuota(
  userId: string,
  quota: UsageQuota = DEFAULT_QUOTA,
): { ok: boolean; reason?: string } {
  if (quota.sandboxRunsPerDay === 0) return { ok: true };
  const data  = load(userId);
  const today = { ...emptyPeriod(), ...data.byDay[dayKey()] };
  if (today.sandboxRuns >= quota.sandboxRunsPerDay) {
    return {
      ok: false,
      reason: `Daily sandbox limit reached (${today.sandboxRuns} / ${quota.sandboxRunsPerDay} runs)`,
    };
  }
  return { ok: true };
}

/** Full usage summary for the /v1/me/usage endpoint. */
export function getUsageSummary(userId: string): {
  today: UsagePeriod;
  thisMonth: { tokens: number; costUsd: number; requests: number };
  last7Days: Array<{ date: string } & UsagePeriod>;
  quota: UsageQuota;
} {
  const data = load(userId);
  const today    = { ...emptyPeriod(), ...data.byDay[dayKey()] };
  const thisMonth = { tokens: 0, costUsd: 0, requests: 0, ...data.byMonth[monthKey()] };

  const last7Days: Array<{ date: string } & UsagePeriod> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7Days.push({ date: key, ...emptyPeriod(), ...data.byDay[key] });
  }

  return { today, thisMonth, last7Days, quota: DEFAULT_QUOTA };
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
