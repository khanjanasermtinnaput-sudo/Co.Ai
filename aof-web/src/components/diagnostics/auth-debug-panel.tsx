"use client";

// ── Auth Debug Panel ──────────────────────────────────────────────────────────
// Traces the full auth chain from browser session → token → /api/auth/check
// → /api/keys. Shown in Settings → Diagnostics when the user runs the check.
// Used to diagnose AUTH-401 failures without needing server logs.

import { useState, useCallback } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = "pass" | "fail" | "warn" | "pending" | "idle";

interface AuthStep {
  label: string;
  status: StepStatus;
  detail?: string;
}

interface AuthCheckResult {
  authenticated?: boolean;
  failedStage?: string;
  reason?: string;
  userId?: string;
  email?: string;
  emailConfirmed?: boolean;
  provider?: string;
  lastSignIn?: string;
  tokenPrefix?: string;
  serverConfig?: {
    supabaseUrl?: string | null;
    hasServiceKey?: boolean;
    adminConfigured?: boolean;
  };
}

// ── Status icon ───────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "pass") return <CheckCircle2 className="size-4 shrink-0 text-green-500" />;
  if (status === "fail") return <XCircle className="size-4 shrink-0 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="size-4 shrink-0 text-yellow-500" />;
  if (status === "pending") return <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />;
  return <div className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />;
}

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({ step }: { step: AuthStep }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <StepIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{step.label}</p>
        {step.detail && (
          <p className={cn(
            "mt-0.5 font-mono text-xs",
            step.status === "fail" ? "text-destructive" : "text-muted-foreground",
          )}>
            {step.detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AuthDebugPanel() {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AuthStep[]>([]);
  const [keysResult, setKeysResult] = useState<string | null>(null);

  const update = useCallback((index: number, patch: Partial<AuthStep>) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }, []);

  const runCheck = useCallback(async () => {
    setRunning(true);
    setKeysResult(null);

    const initialSteps: AuthStep[] = [
      { label: "Supabase client configured", status: "pending" },
      { label: "Active session in browser", status: "pending" },
      { label: "Access token exists & not expired", status: "pending" },
      { label: "Server validates token (/api/auth/check)", status: "pending" },
      { label: "Can read /api/keys (end-to-end)", status: "pending" },
    ];
    setSteps(initialSteps);

    // ── Step 0: supabase client ───────────────────────────────────────────────
    const supabase = getSupabase();
    if (!supabase) {
      setSteps((prev) => {
        const s = [...prev];
        s[0] = { ...s[0], status: "fail", detail: "Supabase env vars not set" };
        for (let i = 1; i < s.length; i++) s[i] = { ...s[i], status: "fail", detail: "Blocked by previous step" };
        return s;
      });
      setRunning(false);
      return;
    }
    update(0, { status: "pass", detail: "Client created" });

    // ── Step 1: session ───────────────────────────────────────────────────────
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      update(1, { status: "fail", detail: "No session in localStorage — not signed in" });
      setSteps((prev) => {
        const s = [...prev];
        for (let i = 2; i < s.length; i++) s[i] = { ...s[i], status: "fail", detail: "Blocked by previous step" };
        return s;
      });
      setRunning(false);
      return;
    }
    const session = sessionData.session;
    update(1, { status: "pass", detail: `Signed in as ${session.user.email}` });

    // ── Step 2: token expiry ──────────────────────────────────────────────────
    const expiresAtMs = (session.expires_at ?? 0) * 1000;
    const msUntilExpiry = expiresAtMs - Date.now();
    const expiresLabel = expiresAtMs > 0
      ? `Expires in ${Math.round(msUntilExpiry / 1000)}s (${new Date(expiresAtMs).toLocaleTimeString()})`
      : "No expiry info";

    let accessToken = session.access_token;
    if (msUntilExpiry <= 60_000) {
      update(2, { status: "pending", detail: "Token near expiry — refreshing…" });
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !refreshed.session) {
        update(2, { status: "fail", detail: `Refresh failed: ${refreshErr?.message ?? "no session returned"}` });
        setSteps((prev) => {
          const s = [...prev];
          for (let i = 3; i < s.length; i++) s[i] = { ...s[i], status: "fail", detail: "Blocked by previous step" };
          return s;
        });
        setRunning(false);
        return;
      }
      accessToken = refreshed.session.access_token;
      update(2, { status: "pass", detail: `Refreshed — ${expiresLabel}` });
    } else {
      update(2, { status: "pass", detail: `${expiresLabel} · prefix ${accessToken.slice(0, 12)}…` });
    }

    // ── Step 3: server validates token ────────────────────────────────────────
    let checkResult: AuthCheckResult = {};
    try {
      const res = await fetch("/api/auth/check", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      checkResult = (await res.json()) as AuthCheckResult;
      if (checkResult.authenticated) {
        update(3, {
          status: "pass",
          detail: `User ${checkResult.userId?.slice(0, 8)}… · ${checkResult.email}`,
        });
      } else {
        update(3, {
          status: "fail",
          detail: `Stage: ${checkResult.failedStage} — ${checkResult.reason}`,
        });
        setSteps((prev) => {
          const s = [...prev];
          s[4] = { ...s[4], status: "fail", detail: "Blocked by previous step" };
          return s;
        });
        setRunning(false);
        return;
      }
    } catch (e) {
      update(3, { status: "fail", detail: `Network error: ${String(e)}` });
      update(4, { status: "fail", detail: "Blocked by previous step" });
      setRunning(false);
      return;
    }

    // ── Step 4: end-to-end /api/keys ─────────────────────────────────────────
    try {
      const res = await fetch("/api/keys", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json = (await res.json()) as { keys?: unknown[] };
        const count = json.keys?.length ?? 0;
        update(4, { status: "pass", detail: `${count} key(s) on file` });
        setKeysResult(`${count} key(s) returned`);
      } else {
        const text = await res.text().catch(() => "(unreadable)");
        update(4, { status: "fail", detail: `HTTP ${res.status}: ${text.slice(0, 120)}` });
      }
    } catch (e) {
      update(4, { status: "fail", detail: `Network error: ${String(e)}` });
    }

    setRunning(false);
  }, [update]);

  const overallStatus = steps.length === 0
    ? null
    : steps.every((s) => s.status === "pass") ? "pass"
    : steps.some((s) => s.status === "fail") ? "fail"
    : "warn";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> Auth Chain Debug
            </CardTitle>
            <CardDescription>
              Traces every step from browser session → access token → server
              validation → API access. Run this when API key saves fail with AUTH-401.
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={runCheck}
            disabled={running}
            className="shrink-0 gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
            {running ? "Checking…" : "Run Auth Check"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Press <span className="font-medium text-foreground">Run Auth Check</span> to trace the auth chain.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {steps.map((s, i) => (
              <StepRow key={i} step={s} />
            ))}
          </div>
        )}

        {overallStatus === "pass" && keysResult && (
          <div className="mt-3 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2.5">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              Auth chain fully operational — {keysResult}
            </p>
          </div>
        )}
        {overallStatus === "fail" && (
          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <p className="text-sm font-medium text-destructive">
              Auth chain broken — see the failed step above for the root cause.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
