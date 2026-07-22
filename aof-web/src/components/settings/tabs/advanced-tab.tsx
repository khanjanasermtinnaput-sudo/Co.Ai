"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Copy,
  Download,
  Lock,
  LogOut,
  Monitor,
  RefreshCw,
  Terminal,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { usePlan } from "@/hooks/use-plan";
import { useUIStore } from "@/store/ui-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export function AdvancedTab() {
  const { can } = usePlan();
  const isAdvanced = can("cli");

  return (
    <div className="space-y-4">
      <DeveloperModeCard />
      <CliSection isAdvanced={isAdvanced} />
    </div>
  );
}

/** The one app-wide Developer Mode switch (ui-store is the single source of
 *  truth). Turning it on reveals the Diagnostics tab, dev-only CoCode panels,
 *  raw error details and backend/model internals. */
function DeveloperModeCard() {
  const developerMode = useUIStore((s) => s.developerMode);
  const setDeveloperMode = useUIStore((s) => s.setDeveloperMode);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalSquare className="size-4 text-primary" /> Developer Mode
        </CardTitle>
        <CardDescription>
          Shows technical surfaces across Co.AI: the Diagnostics tab, developer
          panels in CoCode, raw error details (HTTP status, provider response,
          stack) and backend/model internals on messages.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Show developer tooling</p>
          <p className="text-xs text-muted-foreground">
            Secrets are always redacted before display.
          </p>
        </div>
        <Switch checked={developerMode} onCheckedChange={setDeveloperMode} />
      </CardContent>
    </Card>
  );
}

interface TokenInfo {
  id: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface DeviceInfo {
  id: string;
  name: string;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string;
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("not-configured");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("not-signed-in");
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Prefer the human-readable message (e.g. backend-not-configured guidance)
    // over the machine-readable error code.
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function CliSection({ isAdvanced }: { isAdvanced: boolean }) {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null | undefined>(undefined);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const loadToken = useCallback(async () => {
    try {
      const data = await apiFetch("/api/cli/token");
      setTokenInfo(data.token ?? null);
    } catch {
      setTokenInfo(null);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const data = await apiFetch("/api/cli/devices");
      setDevices(data.devices ?? []);
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdvanced) return;
    loadToken();
    loadDevices();
  }, [isAdvanced, loadToken, loadDevices]);

  const generate = async () => {
    setBusy(true);
    try {
      const data = await apiFetch("/api/cli/token", { method: "POST" });
      setRawToken(data.raw);
      await loadToken();
      toast.success("Token generated — copy it now, it won't be shown again");
    } catch (err) {
      toast.error("Failed to generate token", { description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/cli/token", { method: "DELETE" });
      setTokenInfo(null);
      setRawToken(null);
      setDevices([]);
      toast.success("Token revoked — all CLI sessions ended");
    } catch (err) {
      toast.error("Failed to revoke token", { description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const data = await apiFetch("/api/cli/token", { method: "PATCH" });
      setRawToken(data.raw);
      await loadToken();
      setDevices([]);
      toast.success("Token regenerated — copy it now");
    } catch (err) {
      toast.error("Failed to regenerate token", { description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/cli/devices", { method: "DELETE" });
      setDevices([]);
      toast.success("All CLI sessions logged out");
    } catch (err) {
      toast.error("Failed to logout sessions", { description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
  };

  if (!isAdvanced) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" /> CoCode CLI
          </CardTitle>
          <CardDescription>
            AI-powered terminal coding agent — reads your repo, writes code, commits changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/30 py-8 text-center">
            <Lock className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Advanced subscription required</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Upgrade to Advanced to access CoCode CLI
              </p>
            </div>
            <Button variant="default" onClick={() => toast("Upgrade coming soon — check Billing tab")}>
              Upgrade to Advanced
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Status + Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" /> CoCode CLI
          </CardTitle>
          <CardDescription>
            Personal access token for the <code className="text-xs text-primary">coai</code> CLI.
            Each token grants full CLI access tied to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status</span>
            </div>
            <Badge variant={tokenInfo ? "default" : "muted"}>
              {tokenInfo ? "Active" : tokenInfo === null ? "No token" : "Loading…"}
            </Badge>
          </div>

          {tokenInfo && !rawToken && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">CLI Token</p>
              <p className="mt-0.5 font-mono text-sm text-foreground">
                {tokenInfo.prefix}••••••••••••••••••••••••••••••••••••••••••••••••
              </p>
              {tokenInfo.lastUsedAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last used {new Date(tokenInfo.lastUsedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          )}

          {rawToken && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
              <p className="text-xs font-medium text-primary">
                Copy this token now — it won&apos;t be shown again
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">
                  {rawToken}
                </code>
                <Button size="icon" variant="ghost" onClick={() => copy(rawToken)} className="shrink-0">
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!tokenInfo && !rawToken && (
              <Button onClick={generate} disabled={busy} className="gap-2">
                <Terminal className="size-4" />
                {busy ? "Generating…" : "Generate Token"}
              </Button>
            )}
            {tokenInfo && (
              <>
                {rawToken && (
                  <Button variant="secondary" onClick={() => copy(rawToken)} className="gap-2">
                    <Copy className="size-4" /> Copy Token
                  </Button>
                )}
                <Button variant="secondary" onClick={regenerate} disabled={busy} className="gap-2">
                  <RefreshCw className="size-4" /> {busy ? "…" : "Regenerate"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={revoke}
                  disabled={busy}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" /> Revoke Token
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Devices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="size-4 text-primary" /> Active Devices
          </CardTitle>
          <CardDescription>
            Terminal sessions currently authenticated with your CLI token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {devicesLoading ? (
            <p className="text-sm text-muted-foreground">Loading sessions…</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active CLI sessions.</p>
          ) : (
            <div className="space-y-2">
              {devices.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.ip ?? "unknown IP"} · last active{" "}
                      {new Date(d.lastActiveAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {devices.length > 0 && (
            <Button
              variant="ghost"
              onClick={logoutAll}
              disabled={busy}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <LogOut className="size-4" /> Logout All CLI Sessions
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Download CLI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-4 text-primary" /> Download CLI
          </CardTitle>
          <CardDescription>
            Install the <code className="text-xs text-primary">coai</code> command globally.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["Windows", "macOS", "Linux"] as const).map((os) => (
            <div key={os} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium">{os}</span>
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                  npm install -g coagentix-cli
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => copy("npm install -g coagentix-cli")}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <div className="mt-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">Then verify:</p>
            <code className="font-mono text-xs">coai --version</code>
            <p className="mt-1 text-xs text-muted-foreground">And login:</p>
            <code className="font-mono text-xs">coai login</code>
          </div>
        </CardContent>
      </Card>

      {/* Documentation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" /> Documentation
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { label: "Quick Start Guide", desc: "Install, login and run your first task" },
            { label: "All Commands", desc: "coai review, fix, generate, refactor, commit…" },
            { label: "Titan Mode", desc: "Multi-agent deep architecture mode" },
            { label: "Repository Scanning", desc: "How coai reads and indexes your project" },
          ].map((doc) => (
            <button
              key={doc.label}
              type="button"
              onClick={() => toast("Documentation coming soon")}
              className="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <span className="text-sm font-medium">{doc.label}</span>
              <span className="text-xs text-muted-foreground">{doc.desc}</span>
            </button>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
