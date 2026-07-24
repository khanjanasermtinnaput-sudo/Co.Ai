// Throwaway load-test harness for Co.AI multi-agent stress test (Phase D).
// Runs against a locally-started tmap-v2 server in MOCK mode (no provider keys).
// Measures framework/orchestration overhead + concurrency + failure handling.
// NOTE: latency reflects orchestration + mock providers, NOT real LLM latency.
//
// Usage: node loadtest.mjs <baseUrl> <token>
import process from 'node:process';

const BASE = process.argv[2] || 'http://localhost:8799';
const TOKEN = process.argv[3];
if (!TOKEN) { console.error('need token'); process.exit(1); }

// Endpoints exercising the named multi-agent systems.
const ENDPOINTS = {
  run:        { path: '/v1/run',        body: () => ({ task: 'Build a small REST API with one GET /health route', mode: 'normal' }) },     // TMAP / Voting / Memory / DARS
  chat:       { path: '/v1/chat',       body: () => ({ message: 'Help me plan a todo app' }) },                                            // RAA / DARS
  orchestrate:{ path: '/v1/orchestrate',body: () => ({ message: 'Summarize the benefits of unit testing' }) },                            // Chief Agent / DARS
  titan:      { path: '/v1/titan',      body: () => ({ message: 'Design a URL shortener' }) },                                            // Titan Mode / DARS
  analyze:    { path: '/v1/analyze',    body: () => ({ brief: 'A SaaS dashboard for tracking API usage' }) },                            // Analyzer / DARS
  debug:      { path: '/v1/debug',      body: () => ({ error: 'TypeError: cannot read property x of undefined', code: 'const a={};a.x.y', context: '' }) }, // Debugger / DARS
};

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// When ROTATE_IP is set, send a unique X-Forwarded-For per request so the
// per-IP rate limiter (120/min/IP) does not cap the raw-pipeline measurement.
const ROTATE_IP = process.env.ROTATE_IP === '1';
function randomIp() {
  return `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 254 + 1) | 0}`;
}

// Read an SSE stream to completion; classify success/failure from events.
async function oneRequest(ep) {
  const t0 = performance.now();
  let ok = false, status = 0, sawDone = false, sawError = false, mockSeen = false, failover = false, errText = '';
  try {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
    if (ROTATE_IP) headers['X-Forwarded-For'] = randomIp();
    const res = await fetch(BASE + ep.path, {
      method: 'POST',
      headers,
      body: JSON.stringify(ep.body()),
    });
    status = res.status;
    if (!res.ok || !res.body) {
      errText = await res.text().catch(() => '');
      return { ms: performance.now() - t0, ok: false, status, sawDone, sawError, mockSeen, failover, errText };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, nl); buf = buf.slice(nl + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.kind === 'done') sawDone = true;
          if (ev.kind === 'error') { sawError = true; errText = ev.text || ''; }
          if (typeof ev.text === 'string') {
            if (/mock mode|mock\b/i.test(ev.text)) mockSeen = true;
            if (/switch|failover|degrad|เปลี่ยน/i.test(ev.text)) failover = true;
          }
        } catch { /* ignore non-JSON frames */ }
      }
    }
    ok = sawDone && !sawError;
  } catch (e) {
    errText = String(e?.message || e);
  }
  return { ms: performance.now() - t0, ok, status, sawDone, sawError, mockSeen, failover, errText };
}

// Run N requests across a fixed concurrency pool against one endpoint.
async function tier(ep, n, concurrency) {
  const results = [];
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= n) break;
      results.push(await oneRequest(ep));
    }
  }
  const t0 = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker));
  const wall = performance.now() - t0;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const okCount = results.filter((r) => r.ok).length;
  const mockCount = results.filter((r) => r.mockSeen).length;
  const failoverCount = results.filter((r) => r.failover).length;
  return {
    n, concurrency,
    wallMs: Math.round(wall),
    throughput: +(n / (wall / 1000)).toFixed(2),
    okCount,
    failCount: n - okCount,
    failRate: +(((n - okCount) / n) * 100).toFixed(1),
    p50: Math.round(pct(lat, 50)),
    p95: Math.round(pct(lat, 95)),
    p99: Math.round(pct(lat, 99)),
    max: Math.round(lat[lat.length - 1] || 0),
    mockCount,
    failoverCount,
    sampleErr: results.find((r) => !r.ok)?.errText?.slice(0, 120) || '',
  };
}

async function metrics() {
  try {
    const r = await fetch(BASE + '/v1/metrics', { headers: { Authorization: `Bearer ${TOKEN}` } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const TIERS = [
  { n: 10, c: 5 },
  { n: 50, c: 10 },
  { n: 100, c: 20 },
  { n: 500, c: 40 },
];

const targetEp = process.argv[4] || 'run';
const ep = ENDPOINTS[targetEp];
if (!ep) { console.error('unknown endpoint', targetEp); process.exit(1); }

const out = { endpoint: targetEp, path: ep.path, tiers: [] };
out.metricsBefore = await metrics();
for (const t of TIERS) {
  const r = await tier(ep, t.n, t.c);
  out.tiers.push(r);
  console.error(`[${targetEp}] n=${t.n} c=${t.c} -> ok=${r.okCount}/${t.n} thr=${r.throughput}/s p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms fail=${r.failRate}% mock=${r.mockCount} failover=${r.failoverCount}`);
}
out.metricsAfter = await metrics();
console.log(JSON.stringify(out));
