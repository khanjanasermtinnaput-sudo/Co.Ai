// Structured logging for AOF Code server.
// Writes JSON lines to stderr so log aggregators can parse them easily.

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, ...fields };
  const out = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(out + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
}

export const logger = {
  info:  (msg: string, fields?: Record<string, unknown>) => log('info',  msg, fields),
  warn:  (msg: string, fields?: Record<string, unknown>) => log('warn',  msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env.AOF_DEBUG === '1') log('debug', msg, fields);
  },
};

// In-memory metrics store (resets on restart; good enough for single-instance)
interface Metrics {
  requests: number;
  errors: number;
  tmapRuns: number;
  tmapErrors: number;
  totalTokens: number;
  totalCostUsd: number;
  agentCalls: Record<string, number>;   // role -> count
  providerCalls: Record<string, number>; // provider -> count
  startedAt: string;
}

const metrics: Metrics = {
  requests: 0,
  errors: 0,
  tmapRuns: 0,
  tmapErrors: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  agentCalls: {},
  providerCalls: {},
  startedAt: new Date().toISOString(),
};

export function incRequest() { metrics.requests++; }
export function incError()   { metrics.errors++; }
export function incTmapRun() { metrics.tmapRuns++; }
export function incTmapError() { metrics.tmapErrors++; }
export function addTokens(tokens: number, costUsd: number) {
  metrics.totalTokens += tokens;
  metrics.totalCostUsd = Math.round((metrics.totalCostUsd + costUsd) * 1e8) / 1e8;
}
export function incAgentCall(role: string, provider: string) {
  metrics.agentCalls[role] = (metrics.agentCalls[role] ?? 0) + 1;
  metrics.providerCalls[provider] = (metrics.providerCalls[provider] ?? 0) + 1;
}

export function getMetrics(): Metrics & { uptimeSec: number } {
  return {
    ...metrics,
    uptimeSec: Math.floor((Date.now() - new Date(metrics.startedAt).getTime()) / 1000),
  };
}
