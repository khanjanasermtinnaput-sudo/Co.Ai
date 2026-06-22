// Per-user usage quota enforcement — Round 2 #3.
//
// Tracks daily and monthly: token consumption, USD cost, requests, and sandbox
// executions. Quota limits are read from env vars (with generous defaults) and
// can be set to 0 to disable a specific limit entirely.
//
// Storage: Redis hashes (atomic HINCRBY / HINCRBYFLOAT), so counters are shared
// ACROSS instances — fixing the previous per-instance JSON files under /tmp that
// were lost on every cold start and let users exceed limits by hitting different
// serverless instances. When Redis is not configured, getRedis() returns an
// in-memory mock (single-instance) for local dev.
//
// Atomicity: HINCRBY/HINCRBYFLOAT are atomic server-side operations, so concurrent
// requests accumulate correctly with no read-modify-write races.

import { getRedis } from '../server/redis.js';
import type { UsageQuota, UsagePeriod, QuotaStatus } from '../types.js';

// ── Default quota (env-configurable) ──────────────────────────────────────────
export const DEFAULT_QUOTA: UsageQuota = {
  dailyTokens:       Number(process.env.AOF_DAILY_TOKEN_LIMIT    || 500_000),
  monthlyTokens:     Number(process.env.AOF_MONTHLY_TOKEN_LIMIT  || 5_000_000),
  dailyCostUsd:      Number(process.env.AOF_DAILY_COST_LIMIT     || 5.0),
  monthlyCostUsd:    Number(process.env.AOF_MONTHLY_COST_LIMIT   || 50.0),
  sandboxRunsPerDay: Number(process.env.AOF_SANDBOX_DAILY_LIMIT  || 100),
};

// ── Keys & TTLs ──────────────────────────────────────────────────────────────
// Date keys use UTC so limits reset at midnight UTC regardless of server TZ.
function dayKey():   string { return new Date().toISOString().slice(0, 10); }
function monthKey(): string { return new Date().toISOString().slice(0, 7);  }

function sanitize(userId: string): string { return userId.replace(/[^a-zA-Z0-9_-]/g, '_'); }
function dayHashKey(userId: string, d: string):   string { return `cgntx:usage:d:${sanitize(userId)}:${d}`; }
function monthHashKey(userId: string, m: string): string { return `cgntx:usage:m:${sanitize(userId)}:${m}`; }

const DAY_TTL_SEC   = 60 * 60 * 24 * 2;   // keep daily counters ~2 days
const MONTH_TTL_SEC = 60 * 60 * 24 * 35;  // keep monthly counters ~35 days

// ── Helpers ──────────────────────────────────────────────────────────────────
function emptyPeriod(): UsagePeriod {
  return { tokens: 0, costUsd: 0, requests: 0, sandboxRuns: 0 };
}

function parsePeriod(h: Record<string, string> | null): UsagePeriod {
  return {
    tokens:      Number(h?.tokens ?? 0),
    costUsd:     round8(Number(h?.costUsd ?? 0)),
    requests:    Number(h?.requests ?? 0),
    sandboxRuns: Number(h?.sandboxRuns ?? 0),
  };
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Record token/cost consumption after a run completes. Atomic + cross-instance. */
export async function recordUsage(
  userId: string,
  delta: { tokens: number; costUsd: number },
): Promise<void> {
  const redis = getRedis();
  const dk = dayHashKey(userId, dayKey());
  const mk = monthHashKey(userId, monthKey());

  await redis.hincrby(dk, 'tokens', Math.max(0, Math.round(delta.tokens)));
  await redis.hincrbyfloat(dk, 'costUsd', Math.max(0, delta.costUsd));
  await redis.hincrby(dk, 'requests', 1);
  await redis.expire(dk, DAY_TTL_SEC);

  await redis.hincrby(mk, 'tokens', Math.max(0, Math.round(delta.tokens)));
  await redis.hincrbyfloat(mk, 'costUsd', Math.max(0, delta.costUsd));
  await redis.hincrby(mk, 'requests', 1);
  await redis.expire(mk, MONTH_TTL_SEC);
}

/** Increment sandbox run counter for today. Atomic + cross-instance. */
export async function recordSandboxRun(userId: string): Promise<void> {
  const redis = getRedis();
  const dk = dayHashKey(userId, dayKey());
  await redis.hincrby(dk, 'sandboxRuns', 1);
  await redis.expire(dk, DAY_TTL_SEC);
}

/** Check whether the user is within all quota limits. */
export async function checkQuota(
  userId: string,
  quota: UsageQuota = DEFAULT_QUOTA,
): Promise<QuotaStatus> {
  const redis = getRedis();
  const today     = parsePeriod(await redis.hgetall(dayHashKey(userId, dayKey())));
  const thisMonth = parsePeriod(await redis.hgetall(monthHashKey(userId, monthKey())));

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
export async function checkSandboxQuota(
  userId: string,
  quota: UsageQuota = DEFAULT_QUOTA,
): Promise<{ ok: boolean; reason?: string }> {
  if (quota.sandboxRunsPerDay === 0) return { ok: true };
  const redis = getRedis();
  const today = parsePeriod(await redis.hgetall(dayHashKey(userId, dayKey())));
  if (today.sandboxRuns >= quota.sandboxRunsPerDay) {
    return {
      ok: false,
      reason: `Daily sandbox limit reached (${today.sandboxRuns} / ${quota.sandboxRunsPerDay} runs)`,
    };
  }
  return { ok: true };
}

/** Full usage summary for the /v1/me/usage endpoint. */
export async function getUsageSummary(userId: string): Promise<{
  today: UsagePeriod;
  thisMonth: { tokens: number; costUsd: number; requests: number };
  last7Days: Array<{ date: string } & UsagePeriod>;
  quota: UsageQuota;
}> {
  const redis = getRedis();
  const today     = parsePeriod(await redis.hgetall(dayHashKey(userId, dayKey())));
  const thisMonth = parsePeriod(await redis.hgetall(monthHashKey(userId, monthKey())));

  const last7Days: Array<{ date: string } & UsagePeriod> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7Days.push({ date: key, ...(i === 0 ? today : parsePeriod(await redis.hgetall(dayHashKey(userId, key)))) });
  }

  return { today, thisMonth, last7Days, quota: DEFAULT_QUOTA };
}
