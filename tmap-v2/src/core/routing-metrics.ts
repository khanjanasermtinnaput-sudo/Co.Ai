// Routing Metrics — tracks routing decisions and outcomes for adaptive routing.
// Records per-role/provider/model success, failure, latency, and hallucination data.
// Persists to a JSON sidecar (.coagentix-routing-metrics.json) so the adaptive
// router can learn across restarts. The store is capped at MAX_RECORDS to bound
// disk usage; old records roll off automatically.

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Role, TaskCategory } from '../types.js';

const STORE_PATH = join(process.cwd(), '.coagentix-routing-metrics.json');
const MAX_RECORDS = 1000;

export interface RouteRecord {
  ts: number;
  role: Role;
  provider: string;
  model: string;
  category: TaskCategory;
  durationMs: number;
  success: boolean;
  hallucinationDetected: boolean;
  failureReason?: string;
}

export interface ProviderMetrics {
  key: string;           // `${role}::${provider}::${model}`
  role: string;
  provider: string;
  model: string;
  total: number;
  successes: number;
  failures: number;
  hallucinationCount: number;
  avgLatencyMs: number;
  successRate: number;   // EWMA-like: successes / total (0-1)
  hallucinationRate: number;
  score: number;         // composite 0-1 used for adaptive routing
}

export interface RoutingSnapshot {
  records: RouteRecord[];
  metrics: ProviderMetrics[];
  ts: string;
}

export class RoutingMetricsStore {
  private records: RouteRecord[] = [];
  private readonly storagePath: string | null;

  /** Pass `null` as storagePath to create an in-memory-only store (useful for tests). */
  constructor(storagePath: string | null = STORE_PATH) {
    this.storagePath = storagePath;
    if (storagePath) this.load();
  }

  record(entry: RouteRecord): void {
    this.records.push(entry);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    this.save();
  }

  getMetrics(): ProviderMetrics[] {
    type Acc = {
      role: string; provider: string; model: string;
      total: number; successes: number; failures: number;
      hallucinationCount: number; totalLatency: number;
    };
    const map = new Map<string, Acc>();

    for (const r of this.records) {
      const key = `${r.role}::${r.provider}::${r.model}`;
      const m: Acc = map.get(key) ?? {
        role: r.role, provider: r.provider, model: r.model,
        total: 0, successes: 0, failures: 0, hallucinationCount: 0, totalLatency: 0,
      };
      m.total++;
      m.totalLatency += r.durationMs;
      if (r.success) m.successes++;
      else m.failures++;
      if (r.hallucinationDetected) m.hallucinationCount++;
      map.set(key, m);
    }

    return [...map.entries()].map(([key, m]) => {
      const successRate = m.total > 0 ? m.successes / m.total : 0.5;
      const hallucinationRate = m.total > 0 ? m.hallucinationCount / m.total : 0;
      const avgLatencyMs = m.total > 0 ? m.totalLatency / m.total : 1500;
      // Composite score: 60% success, 30% hallucination-free, 10% speed inverse
      const speedScore = Math.max(0, 1 - avgLatencyMs / 10_000);
      const score = 0.6 * successRate + 0.3 * (1 - hallucinationRate) + 0.1 * speedScore;
      return {
        key,
        role: m.role,
        provider: m.provider,
        model: m.model,
        total: m.total,
        successes: m.successes,
        failures: m.failures,
        hallucinationCount: m.hallucinationCount,
        avgLatencyMs: Math.round(avgLatencyMs),
        successRate: Math.round(successRate * 100) / 100,
        hallucinationRate: Math.round(hallucinationRate * 100) / 100,
        score: Math.round(score * 1000) / 1000,
      };
    }).sort((a, b) => b.score - a.score);
  }

  /** Best provider for a given role (requires ≥5 observations). */
  getBestProvider(role: Role, _category?: TaskCategory): { provider: string; model: string } | null {
    const candidates = this.getMetrics().filter((m) => m.role === role && m.total >= 5);
    return candidates.length > 0
      ? { provider: candidates[0].provider, model: candidates[0].model }
      : null;
  }

  getProviderScore(role: string, provider: string, model: string): number {
    const key = `${role}::${provider}::${model}`;
    return this.getMetrics().find((m) => m.key === key)?.score ?? 0.5;
  }

  snapshot(): RoutingSnapshot {
    return {
      records: this.records.slice(-100),
      metrics: this.getMetrics(),
      ts: new Date().toISOString(),
    };
  }

  private save(): void {
    if (!this.storagePath) return;
    writeFile(this.storagePath, JSON.stringify({ records: this.records }, null, 2), 'utf8')
      .catch(() => { /* non-fatal — metrics loss is acceptable */ });
  }

  private load(): void {
    if (!this.storagePath) return;
    try {
      if (existsSync(this.storagePath)) {
        const raw = JSON.parse(readFileSync(this.storagePath, 'utf8')) as { records?: unknown };
        if (Array.isArray(raw.records)) {
          this.records = (raw.records as RouteRecord[]).slice(-MAX_RECORDS);
        }
      }
    } catch { /* start fresh on parse error */ }
  }
}

export const globalRoutingMetrics = new RoutingMetricsStore();
