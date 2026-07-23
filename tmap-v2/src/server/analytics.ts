// Analytics platform — event ingestion, daily rollups, DAU/MAU, feature usage
// funnels, cost analytics, and provider performance. Events stored in Redis
// (time-series) with daily snapshots persisted to file-store.

import { getRedis, isRedisAvailable } from './redis.js';
import { fsPut, fsList } from './file-store.js';
import { logger } from './logger.js';
import type { AnalyticsEvent, AnalyticsSummary } from '../types.js';

export type { AnalyticsEvent, AnalyticsSummary };

const EVENT_TTL_DAYS = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 30);
const MAX_EVENTS_PER_DAY = 100_000;

// ── Event ingestion ───────────────────────────────────────────────────────────

function dayKey(ts: string): string {
  return ts.slice(0, 10); // YYYY-MM-DD
}

function redisEventKey(day: string, eventType: string): string {
  return `cgntx:analytics:events:${day}:${eventType}`;
}

function redisCounterKey(day: string, metric: string): string {
  return `cgntx:analytics:cnt:${day}:${metric}`;
}

function redisSetKey(day: string, set: string): string {
  return `cgntx:analytics:set:${day}:${set}`;
}

export async function trackEvent(event: AnalyticsEvent): Promise<void> {
  const day = dayKey(event.ts);

  // Store in file-store as fallback always
  const fileKey = `${day}_${event.eventType}_${Date.now()}`;
  fsPut('analytics_events', fileKey, event);

  // Also push to Redis for fast aggregation
  if (await isRedisAvailable()) {
    const redis = getRedis();
    const key   = redisEventKey(day, event.eventType);
    const ttl   = EVENT_TTL_DAYS * 86_400;
    try {
      await redis.lpush(key, JSON.stringify(event));
      await redis.ltrim(key, 0, MAX_EVENTS_PER_DAY - 1);
      await redis.expire(key, ttl);

      // Track unique users (DAU)
      if (event.userId) {
        await redis.sadd(redisSetKey(day, 'dau'), event.userId);
        await redis.expire(redisSetKey(day, 'dau'), ttl);
      }

      // Increment feature counter
      await redis.hincrby(redisCounterKey(day, 'features'), event.eventType, 1);
      await redis.expire(redisCounterKey(day, 'features'), ttl);

      // Track cost/tokens if present
      if (typeof event.properties['tokens'] === 'number') {
        await redis.hincrbyfloat(redisCounterKey(day, 'tokens'), 'total', event.properties['tokens'] as number);
        await redis.expire(redisCounterKey(day, 'tokens'), ttl);
      }
      if (typeof event.properties['costUsd'] === 'number') {
        await redis.hincrbyfloat(redisCounterKey(day, 'cost'), 'total', event.properties['costUsd'] as number);
        await redis.expire(redisCounterKey(day, 'cost'), ttl);
      }
    } catch (e) {
      logger.warn('analytics_redis_error', { error: (e as Error).message });
    }
  }
}

// ── Daily summary ──────────────────────────────────────────────────────────────

export async function getDailySummary(date: string): Promise<AnalyticsSummary> {
  if (await isRedisAvailable()) {
    return buildSummaryFromRedis(date);
  }
  return buildSummaryFromFiles(date);
}

async function buildSummaryFromRedis(date: string): Promise<AnalyticsSummary> {
  const redis  = getRedis();
  const dauKey = redisSetKey(date, 'dau');
  const [dauCount, featureCounts, tokenHash, costHash] = await Promise.all([
    redis.scard(dauKey),
    redis.hgetall(redisCounterKey(date, 'features')),
    redis.hgetall(redisCounterKey(date, 'tokens')),
    redis.hgetall(redisCounterKey(date, 'cost')),
  ]);

  const topFeatures = Object.entries(featureCounts ?? {})
    .map(([feature, cnt]) => ({ feature, count: Number(cnt) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalSessions = topFeatures.reduce((s, f) => s + f.count, 0);

  return {
    period: 'day',
    from:   `${date}T00:00:00Z`,
    to:     `${date}T23:59:59Z`,
    activeUsers:       dauCount,
    totalSessions,
    totalTokens:       Number(tokenHash?.['total'] ?? 0),
    totalCostUsd:      Number(costHash?.['total']  ?? 0),
    topFeatures,
    providerBreakdown: [],
  };
}

function buildSummaryFromFiles(date: string): AnalyticsSummary {
  const events = fsList<AnalyticsEvent>('analytics_events', (e) => dayKey(e.ts) === date);
  const userSet = new Set<string>();
  const featureMap: Record<string, number> = {};
  let totalTokens = 0;
  let totalCost   = 0;

  for (const e of events) {
    if (e.userId) userSet.add(e.userId);
    featureMap[e.eventType] = (featureMap[e.eventType] ?? 0) + 1;
    totalTokens += (e.properties['tokens'] as number) ?? 0;
    totalCost   += (e.properties['costUsd'] as number) ?? 0;
  }

  const topFeatures = Object.entries(featureMap)
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    period: 'day',
    from:   `${date}T00:00:00Z`,
    to:     `${date}T23:59:59Z`,
    activeUsers:       userSet.size,
    totalSessions:     events.length,
    totalTokens:       Math.round(totalTokens),
    totalCostUsd:      Math.round(totalCost * 1e6) / 1e6,
    topFeatures,
    providerBreakdown: [],
  };
}

// ── Range summary ─────────────────────────────────────────────────────────────

export async function getRangeSummary(
  from: string,
  to: string,
  _period: AnalyticsSummary['period'] = 'day',
): Promise<AnalyticsSummary[]> {
  const days = dateDaysInRange(from, to);
  return Promise.all(days.map((d) => getDailySummary(d)));
}

function dateDaysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  let current = new Date(from);
  const end   = new Date(to);
  while (current <= end && days.length < 90) {
    days.push(current.toISOString().slice(0, 10));
    current = new Date(current.getTime() + 86_400_000);
  }
  return days;
}

// ── Feature usage breakdown ────────────────────────────────────────────────────

export async function getFeatureUsage(date: string): Promise<Array<{ feature: string; count: number; pct: number }>> {
  const summary = await getDailySummary(date);
  const total   = summary.topFeatures.reduce((s, f) => s + f.count, 0);
  return summary.topFeatures.map((f) => ({
    feature: f.feature,
    count:   f.count,
    pct:     total > 0 ? Math.round(f.count / total * 1000) / 10 : 0,
  }));
}

// ── Retention helpers ──────────────────────────────────────────────────────────

export async function getMAU(month: string): Promise<number> {
  const year = month.slice(0, 4);
  const mo   = month.slice(5, 7);
  const prefix = `${year}-${mo}`;
  const events = fsList<AnalyticsEvent>('analytics_events', (e) => e.ts.startsWith(prefix) && Boolean(e.userId));
  return new Set(events.map((e) => e.userId)).size;
}
