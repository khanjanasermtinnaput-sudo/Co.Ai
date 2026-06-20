"use client";

// ── System Diagnostics Panel ──────────────────────────────────────────────────
// Full system health check with structured error codes for every failure.
// Shown in Settings → Diagnostics. Checks auth, database, AI providers,
// conversations, and storage — reports ✅ Healthy or ❌ CODE · Reason.

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import {
  Activity,
  RefreshCw,
  Shield,
  Database,
  Bot,
  MessageSquare,
  HardDrive,
  Copy,
  Check,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/lib/supabase/client";
import { useDiagnosticsStore } from "@/store/diagnostics-store";
import { logClientError, type ErrorLogEntry, formatDiagnosticsReport, clearErrorLog, subscribeErrorLog } from "@/lib/errors/logger";
import { findByCode } from "@/lib/errors/error-codes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ── Check result type ─────────────────────────────────────────────────────────

type CheckStatus = "pass" | "fail" | "warn" | "pending";

interface CheckResult {
  label: string;
  status: CheckStatus;
  errorCode?: string;
  detail?: string;
}

// ── Individual check runners ──────────────────────────────────────────────────

async function checkAuth(): Promise<CheckResult> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        label: "Authentication",
        status: "warn",
        errorCode: "AUTH-401",
        detail: "Supabase not configured — running in demo mode.",
      };
    }
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return { label: "Authentication", status: "fail", errorCode: "AUTH-401", detail: error.message };
    }
    if (!data.session) {
      return {
        label: "Authentication",
        status: "warn",
        errorCode: "AUTH-401",
        detail: "No active session — sign in to use account features.",
      };
    }
    return { label: "Authentication", status: "pass", detail: data.session.user.email ?? "Signed in" };
  } catch (e) {
    return { label: "Authentication", status: "fail", errorCode: "AUTH-401", detail: String(e) };
  }
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        label: "Database",
        status: "warn",
        errorCode: "DB-500",
        detail: "Not configured — running in demo mode.",
      };
    }
    const { error } = await supabase.from("conversations").select("id").limit(1);
    if (error) {
      return { label: "Database", status: "fail", errorCode: "DB-500", detail: error.message };
    }
    return { label: "Database", status: "pass", detail: "Supabase reachable" };
  } catch (e) {
    return { label: "Database", status: "fail", errorCode: "DB-500", detail: String(e) };
  }
}

async function checkConversations(): Promise<CheckResult> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { label: "Conversations", status: "warn", detail: "Demo mode — no persistence." };
    }
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .limit(5)
      .order("created_at", { ascending: false });
    if (error) {
      return { label: "Conversations", status: "fail", errorCode: "DB-500", detail: error.message };
    }
    return { label: "Conversations", status: "pass", detail: `${data?.length ?? 0} recent found` };
  } catch (e) {
    return { label: "Conversations", status: "fail", errorCode: "DB-500", detail: String(e) };
  }
}

async function checkAiProviders(): Promise<CheckResult> {
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return {
        label: "AI Providers",
        status: "fail",
        errorCode: "API-500",
        detail: `Health endpoint returned ${res.status}`,
      };
    }
    const json = await res.json() as { status?: string; anyConnected?: boolean };
    if (!json.anyConnected) {
      return {
        label: "AI Providers",
        status: "fail",
        errorCode: "AI-001",
        detail: "No AI providers are reachable.",
      };
    }
    const s = json.status ?? "UNKNOWN";
    return {
      label: "AI Providers",
      status: s === "OPERATIONAL" ? "pass" : "warn",
      detail: `System: ${s}`,
    };
  } catch (e) {
    return { label: "AI Providers", status: "fail", errorCode: "API-500", detail: String(e) };
  }
}

async function checkApiKeys(): Promise<CheckResult> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { label: "API Keys", status: "warn", detail: "Not signed in — using server keys." };
    }
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      return { label: "API Keys", status: "warn", detail: "Sign in to manage your own keys." };
    }
    const { data, error } = await supabase.from("provider_keys").select("provider").limit(10);
    if (error) {
      return { label: "API Keys", status: "warn", detail: "Could not read key list." };
    }
    const count = data?.length ?? 0;
    return {
      label: "API Keys",
      status: count > 0 ? "pass" : "warn",
      detail: count > 0 ? `${count} key(s) on file` : "No BYOK keys saved",
    };
  } catch (e) {
    return { label: "API Keys", status: "warn", detail: String(e) };
  }
}

async function checkStorage(): Promise<CheckResult> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { label: "Storage", status: "warn", detail: "Demo mode — uploads disabled." };
    }
    const { data } = await supabase.storage.listBuckets();
    return {
      label: "Storage",
      status: "pass",
      detail: data && data.length > 0 ? `${data.length} bucket(s)` : "Configured",
    };
  } catch {
    return { label: "Storage", status: "warn", detail: "Could not list buckets." };
  }
}

// ── Status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "pass") return <span className="text-base">✅</span>;
  if (status === "fail") return <span className="text-base">❌</span>;
  if (status === "warn") return <span className="text-base">⚠️</span>;
  return (
    <RefreshCw className="size-4 animate-spin text-muted-foreground" />
  );
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ result }: { result: CheckResult }) {
  const entry = result.errorCode ? findByCode(result.errorCode) : null;
  const badgeVariant: "success" | "warning" | "muted" =
    result.status === "pass" ? "success" : result.status === "fail" ? "warning" : "muted";
  const badgeLabel =
    result.status === "pass" ? "Healthy" : result.status === "fail" ? "Failed" : result.status === "warn" ? "Warning" : "Checking…";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card/40 px-3 py-2.5">
      <StatusIcon status={result.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{result.label}</span>
          {result.errorCode && result.status === "fail" && (
            <span className="font-mono text-[11px] font-semibold text-destructive">
              {result.errorCode}
            </span>
          )}
        </div>
        {result.detail && (
          <p className="mt-0.5 text-xs text-muted-foreground">{result.detail}</p>
        )}
        {entry && result.status === "fail" && (
          <p className="mt-1 text-xs text-primary/80">Fix: {entry.solution}</p>
        )}
      </div>
      <Badge variant={badgeVariant} className="shrink-0 text-[10px]">
        {badgeLabel}
      </Badge>
    </div>
  );
}

// ── System Diagnostics card ───────────────────────────────────────────────────

const CHECKS: Array<{
  icon: React.ElementType<React.SVGProps<SVGSVGElement>>;
  label: string;
  run: () => Promise<CheckResult>;
}> = [
  { icon: Shield, label: "Authentication", run: checkAuth },
  { icon: Database, label: "Database", run: checkDatabase },
  { icon: Bot, label: "AI Providers", run: checkAiProviders },
  { icon: MessageSquare, label: "Conversations", run: checkConversations },
  { icon: Shield, label: "API Keys", run: checkApiKeys },
  { icon: HardDrive, label: "Storage", run: checkStorage },
];

export function SystemDiagnosticsPanel() {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResults(CHECKS.map((c) => ({ label: c.label, status: "pending" as const })));
    const settled = await Promise.allSettled(CHECKS.map((c) => c.run()));
    setResults(
      settled.map((r, i): CheckResult =>
        r.status === "fulfilled"
          ? r.value
          : { label: CHECKS[i].label, status: "fail", detail: String((r as { reason: unknown }).reason) },
      ),
    );
    setRunning(false);
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-primary" /> System Health
            </CardTitle>
            <CardDescription>
              Full system check: auth, database, AI providers, storage and more.
              Every failure shows an error code and fix.
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={run}
            disabled={running}
            className="shrink-0 gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
            {running ? "Checking…" : "Run Checks"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Press <span className="font-medium text-foreground">Run Checks</span> to see system status.
          </p>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <CheckRow key={r.label} result={r} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Error Log Panel ───────────────────────────────────────────────────────────

export function ErrorLogPanel() {
  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);
  const [selected, setSelected] = useState<ErrorLogEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const clearErrors = useDiagnosticsStore((s: { clearErrors: () => void }) => s.clearErrors);

  useEffect(() => {
    return subscribeErrorLog(setEntries);
  }, []);

  const copy = async (entry: ErrorLogEntry) => {
    try {
      await navigator.clipboard.writeText(formatDiagnosticsReport(entry));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleClear = () => {
    clearErrorLog();
    setEntries([]);
    setSelected(null);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" /> Error Log
            </CardTitle>
            <CardDescription>
              Last 100 application errors this session. Secrets are never logged.
            </CardDescription>
          </div>
          {entries.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="shrink-0 text-muted-foreground">
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No errors recorded this session.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(selected?.id === e.id ? null : e)}
                onKeyDown={(ev: React.KeyboardEvent) => ev.key === "Enter" && setSelected(selected?.id === e.id ? null : e)}
                className="cursor-pointer rounded-xl border border-border bg-card/40 px-3 py-2.5 transition-colors hover:border-destructive/30 hover:bg-destructive/5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-destructive">
                    {e.errorCode}
                  </span>
                  <span className="flex-1 truncate text-xs text-foreground">{e.title}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {selected?.id === e.id && (
                  <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                    <p className="text-xs text-muted-foreground">{e.message}</p>
                    <p className="text-xs text-muted-foreground">Route: {e.route}</p>
                    {e.stack && (
                      <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background/60 p-2 text-[10px] text-foreground/70">
                        {e.stack}
                      </pre>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(ev: React.MouseEvent) => { ev.stopPropagation(); void copy(e); }}
                      className="h-7 gap-1.5 text-xs"
                    >
                      {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
                      Copy Diagnostics
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Debug Log Toggles ─────────────────────────────────────────────────────────

export function DebugLogsPanel() {
  const { debugLogs, apiLogs, authLogs, setDebugLogs, setApiLogs, setAuthLogs } =
    useDiagnosticsStore() as {
      debugLogs: boolean; apiLogs: boolean; authLogs: boolean;
      setDebugLogs: (v: boolean) => void; setApiLogs: (v: boolean) => void; setAuthLogs: (v: boolean) => void;
    };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4 text-primary" /> Developer Logging
        </CardTitle>
        <CardDescription>
          Enable verbose console logs per category. Secrets are always redacted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <LogToggle
          label="Debug Logs"
          description="Verbose application events and state changes."
          value={debugLogs}
          onChange={setDebugLogs}
        />
        <Separator />
        <LogToggle
          label="API Logs"
          description="Request/response details for every API call."
          value={apiLogs}
          onChange={setApiLogs}
        />
        <Separator />
        <LogToggle
          label="Auth Logs"
          description="Session creation, refresh and expiry events."
          value={authLogs}
          onChange={setAuthLogs}
        />
      </CardContent>
    </Card>
  );
}

function LogToggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
