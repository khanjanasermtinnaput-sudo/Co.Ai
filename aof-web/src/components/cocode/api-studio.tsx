"use client";

// ── API Studio (Phase 38) ─────────────────────────────────────────────────────
// REST API testing with request builder, response viewer, history, and collections.
// Detects API routes from the virtual FS and auto-populates the explorer.

import { useState, useMemo, useRef } from "react";
import {
  Globe, Play, Plus, Trash2, ChevronDown, ChevronRight,
  History, Save, Copy, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestHeader { key: string; value: string; enabled: boolean }

interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: RequestHeader[];
  body: string;
  contentType: "application/json" | "application/x-www-form-urlencoded" | "text/plain" | "none";
}

interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  size: number;
}

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-emerald-400",
  POST: "text-amber-400",
  PUT: "text-blue-400",
  PATCH: "text-purple-400",
  DELETE: "text-red-400",
};

function newRequest(overrides?: Partial<ApiRequest>): ApiRequest {
  return {
    id: `req_${Date.now()}`,
    name: "New Request",
    method: "GET",
    url: "http://localhost:3000/api/",
    headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
    body: "",
    contentType: "application/json",
    ...overrides,
  };
}

export function ApiStudio({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const [requests, setRequests] = useState<ApiRequest[]>([newRequest()]);
  const [activeId, setActiveId] = useState<string>(requests[0].id);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Array<{ req: ApiRequest; res: ApiResponse; at: number }>>([]);
  const [tab, setTab] = useState<"headers" | "body" | "response" | "history">("headers");
  const abortRef = useRef<AbortController | null>(null);

  // Detect API routes from virtual FS
  const detectedRoutes = useMemo(() => {
    return flattenFiles(fs)
      .filter((f) => f.path.includes("/api/") && f.path.includes("route"))
      .map((f) => {
        const routePath = f.path
          .replace(/^.*?\/api/, "/api")
          .replace(/\/route\.(ts|tsx|js|jsx)$/, "");
        return routePath;
      });
  }, [fs]);

  const active = requests.find((r) => r.id === activeId) ?? requests[0];

  function updateActive(patch: Partial<ApiRequest>) {
    setRequests((rs) => rs.map((r) => r.id === activeId ? { ...r, ...patch } : r));
  }

  function addRequest() {
    const req = newRequest();
    setRequests((rs) => [...rs, req]);
    setActiveId(req.id);
    setResponse(null);
  }

  function removeRequest(id: string) {
    setRequests((rs) => {
      const next = rs.filter((r) => r.id !== id);
      if (next.length === 0) { const r = newRequest(); return [r]; }
      return next;
    });
    if (activeId === id) setActiveId(requests.find((r) => r.id !== id)?.id ?? requests[0]?.id);
  }

  async function sendRequest() {
    if (!active) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setSending(true);
    setResponse(null);
    const start = Date.now();

    try {
      const headers: Record<string, string> = {};
      for (const h of active.headers.filter((h) => h.enabled && h.key)) {
        headers[h.key] = h.value;
      }

      const fetchOpts: RequestInit = {
        method: active.method,
        headers,
        signal: abortRef.current.signal,
      };
      if (active.method !== "GET" && active.method !== "DELETE" && active.body) {
        fetchOpts.body = active.body;
      }

      const res = await fetch(active.url, fetchOpts);
      const bodyText = await res.text();
      const duration = Date.now() - start;

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });

      const apiRes: ApiResponse = {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: bodyText,
        duration,
        size: new TextEncoder().encode(bodyText).length,
      };

      setResponse(apiRes);
      setHistory((h) => [{ req: { ...active }, res: apiRes, at: Date.now() }, ...h.slice(0, 49)]);
      setTab("response");
    } catch (e) {
      setResponse({
        status: 0,
        statusText: "Network Error",
        headers: {},
        body: String(e),
        duration: Date.now() - start,
        size: 0,
      });
      setTab("response");
    } finally {
      setSending(false);
    }
  }

  function prettyBody() {
    if (!response?.body) return "";
    try { return JSON.stringify(JSON.parse(response.body), null, 2); } catch { return response.body; }
  }

  const statusColor = (s: number) =>
    s >= 200 && s < 300 ? "text-emerald-400" : s >= 400 ? "text-red-400" : "text-amber-400";

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Globe className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">API Studio</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={addRequest}>
          <Plus className="size-3.5" /> New
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div className="flex w-44 shrink-0 flex-col border-r border-border/50">
          <div className="flex-1 overflow-y-auto p-1.5">
            {/* Detected routes */}
            {detectedRoutes.length > 0 && (
              <div className="mb-2">
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                  Detected Routes
                </p>
                {detectedRoutes.map((route) => (
                  <button key={route} type="button"
                    onClick={() => {
                      const req = newRequest({ url: `http://localhost:3000${route}`, name: route });
                      setRequests((rs) => [...rs, req]);
                      setActiveId(req.id);
                    }}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-white/5 hover:text-foreground">
                    <span className="text-emerald-400 font-mono">GET</span>
                    <span className="truncate">{route}</span>
                  </button>
                ))}
              </div>
            )}

            <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
              Collection
            </p>
            {requests.map((req) => (
              <div key={req.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-[11px]",
                  req.id === activeId ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
                onClick={() => { setActiveId(req.id); setResponse(null); }}>
                <span className={cn("font-mono text-[10px] font-bold shrink-0", METHOD_COLOR[req.method])}>
                  {req.method.slice(0, 3)}
                </span>
                <span className="flex-1 truncate">{req.name}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); removeRequest(req.id); }}
                  className="hidden text-muted-foreground/40 hover:text-red-400 group-hover:block">
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* URL bar */}
          <div className="flex items-center gap-2 border-b border-border/50 p-2">
            <select
              value={active?.method}
              onChange={(e) => updateActive({ method: e.target.value as HttpMethod })}
              className={cn("rounded border border-border/50 bg-background/30 px-2 py-1.5 text-[12px] font-bold outline-none", METHOD_COLOR[active?.method ?? "GET"])}>
              {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => (
                <option key={m} value={m} className="text-foreground">{m}</option>
              ))}
            </select>
            <input
              type="text"
              value={active?.url ?? ""}
              onChange={(e) => updateActive({ url: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && void sendRequest()}
              placeholder="https://api.example.com/endpoint"
              className="flex-1 rounded border border-border/50 bg-background/30 px-3 py-1.5 font-mono text-[12px] outline-none focus:border-primary/40"
            />
            <Button onClick={() => void sendRequest()} disabled={sending}>
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border/50">
            {(["headers", "body", "response", "history"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={cn(
                  "px-3 py-1.5 text-[12px] font-medium capitalize transition-colors",
                  tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}>
                {t}
                {t === "response" && response && (
                  <span className={cn("ml-1.5 text-[11px] font-bold", statusColor(response.status))}>
                    {response.status}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "headers" && (
              <div className="p-3 space-y-1.5">
                {active?.headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="checkbox" checked={h.enabled} className="accent-primary shrink-0"
                      onChange={(e) => {
                        const headers = [...(active?.headers ?? [])];
                        headers[i] = { ...headers[i], enabled: e.target.checked };
                        updateActive({ headers });
                      }} />
                    <input value={h.key} placeholder="Header" onChange={(e) => {
                      const headers = [...(active?.headers ?? [])];
                      headers[i] = { ...headers[i], key: e.target.value };
                      updateActive({ headers });
                    }} className="flex-1 rounded border border-border/40 bg-background/30 px-2 py-1 text-[12px] outline-none focus:border-primary/40" />
                    <input value={h.value} placeholder="Value" onChange={(e) => {
                      const headers = [...(active?.headers ?? [])];
                      headers[i] = { ...headers[i], value: e.target.value };
                      updateActive({ headers });
                    }} className="flex-1 rounded border border-border/40 bg-background/30 px-2 py-1 text-[12px] outline-none focus:border-primary/40" />
                    <button type="button" onClick={() => {
                      const headers = active?.headers.filter((_, j) => j !== i) ?? [];
                      updateActive({ headers });
                    }} className="text-muted-foreground/40 hover:text-red-400">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => updateActive({ headers: [...(active?.headers ?? []), { key: "", value: "", enabled: true }] })}>
                  <Plus className="size-3.5" /> Add Header
                </Button>
              </div>
            )}

            {tab === "body" && (
              <div className="flex h-full flex-col p-3">
                <select value={active?.contentType}
                  onChange={(e) => updateActive({ contentType: e.target.value as ApiRequest["contentType"] })}
                  className="mb-2 rounded border border-border/50 bg-background/30 px-2 py-1 text-[12px] outline-none">
                  <option value="none">No Body</option>
                  <option value="application/json">JSON</option>
                  <option value="application/x-www-form-urlencoded">Form URL Encoded</option>
                  <option value="text/plain">Plain Text</option>
                </select>
                {active?.contentType !== "none" && (
                  <textarea
                    value={active?.body ?? ""}
                    onChange={(e) => updateActive({ body: e.target.value })}
                    placeholder={active?.contentType === "application/json" ? '{\n  "key": "value"\n}' : "key=value&key2=value2"}
                    className="flex-1 resize-none rounded border border-border/50 bg-[#0b0b0f] p-2 font-mono text-[12px] text-slate-300 outline-none focus:border-primary/40"
                  />
                )}
              </div>
            )}

            {tab === "response" && (
              response ? (
                <div className="p-3 space-y-3">
                  <div className="flex items-center gap-3 text-[12px]">
                    <span className={cn("font-bold", statusColor(response.status))}>
                      {response.status} {response.statusText}
                    </span>
                    <span className="text-muted-foreground/60">{response.duration}ms</span>
                    <span className="text-muted-foreground/60">{response.size}B</span>
                    <button type="button" onClick={() => void navigator.clipboard.writeText(response.body)}
                      className="ml-auto text-muted-foreground hover:text-foreground">
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <pre className="overflow-auto rounded bg-[#0b0b0f] p-3 font-mono text-[11px] text-slate-300 max-h-[calc(100vh-300px)]">
                    {prettyBody()}
                  </pre>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground/50">
                  Send a request to see the response.
                </div>
              )
            )}

            {tab === "history" && (
              <div className="divide-y divide-border/30">
                {history.length === 0 && (
                  <div className="p-6 text-center text-[12px] text-muted-foreground/50">No history yet.</div>
                )}
                {history.map((h, i) => (
                  <button key={i} type="button"
                    onClick={() => { setRequests((rs) => [...rs, { ...h.req, id: `req_${Date.now()}` }]); setActiveId(`req_${Date.now()}`); setResponse(h.res); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]">
                    <span className={cn("font-mono text-[11px] font-bold", METHOD_COLOR[h.req.method])}>{h.req.method}</span>
                    <span className="flex-1 truncate text-[12px]">{h.req.url}</span>
                    <span className={cn("text-[11px] font-bold", statusColor(h.res.status))}>{h.res.status}</span>
                    <span className="text-[11px] text-muted-foreground/50">{h.res.duration}ms</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
