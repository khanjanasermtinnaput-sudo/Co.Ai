"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import {
  UserRound,
  Palette,
  KeyRound,
  CreditCard,
  Check,
  Moon,
  Sun,
  ShieldCheck,
  LogOut,
  Activity,
  BarChart3,
  TerminalSquare,
  Terminal,
  Copy,
  RefreshCw,
  Trash2,
  Monitor,
  Zap,
  Download,
  BookOpen,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { getSupabase } from "@/lib/supabase/client";
import { keysEnabled, loadKeys, saveKey, deleteKey } from "@/lib/keys";
import { isAppError } from "@/lib/errors/api-error";
import { showAppErrorToast, showErrorToast } from "@/components/error/error-toast";
import { planFor, byokBonusLabel, tierAtLeast } from "@/lib/plans";
import { usePlan } from "@/hooks/use-plan";
import { PricingTable } from "@/components/billing/pricing-table";
import { UsageDashboard } from "@/components/billing/usage-dashboard";
import { useMounted } from "@/hooks/use-mounted";
import { useDiagnosticsStore } from "@/store/diagnostics-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import { ProviderStatusPanel } from "@/components/diagnostics/provider-status-panel";
import {
  SystemDiagnosticsPanel,
  ErrorLogPanel,
  DebugLogsPanel,
} from "@/components/diagnostics/system-diagnostics";
import { AuthDebugPanel } from "@/components/diagnostics/auth-debug-panel";

const PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", hint: "One key powers every agent (recommended)" },
  { id: "gemini", label: "Google Gemini", hint: "Used for planning" },
  { id: "deepseek", label: "DeepSeek", hint: "Used for coding" },
  { id: "qwen", label: "Qwen (DashScope)", hint: "Used for review" },
  { id: "llama", label: "Groq · Llama", hint: "Used for validation" },
] as const;

export function SettingsView({ defaultTab = "account" }: { defaultTab?: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-6 lg:py-9">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Manage your account, appearance and AI provider keys.
      </p>

      <Tabs defaultValue={defaultTab} className="mt-6">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="account">
            <UserRound className="size-4" /> Account
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="size-4" /> Appearance
          </TabsTrigger>
          <TabsTrigger value="keys">
            <KeyRound className="size-4" /> API Keys
          </TabsTrigger>
          <TabsTrigger value="usage">
            <BarChart3 className="size-4" /> Usage
          </TabsTrigger>
          <TabsTrigger value="diagnostics">
            <Activity className="size-4" /> Diagnostics
          </TabsTrigger>
          <TabsTrigger value="billing">
            <CreditCard className="size-4" /> Billing
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Zap className="size-4" /> Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="keys">
          <KeysTab />
        </TabsContent>
        <TabsContent value="usage">
          <UsageDashboard />
        </TabsContent>
        <TabsContent value="diagnostics">
          <DiagnosticsTab />
        </TabsContent>
        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>
        <TabsContent value="advanced">
          <AdvancedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountTab() {
  const { user, configured, signOut } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const deleteAllConversations = useChatStore((s) => s.deleteAllConversations);
  const deleteAllProjects = useProjectStore((s) => s.deleteAllProjects);
  const [confirmDeleteChats, setConfirmDeleteChats] = useState(false);
  const [confirmDeleteProjects, setConfirmDeleteProjects] = useState(false);

  // Keep the form in sync with the signed-in user.
  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  const email = user?.email ?? "you@aof.ai";

  const save = async () => {
    setSaving(true);
    const supabase = getSupabase();
    if (configured && supabase) {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name },
      });
      setSaving(false);
      if (error) {
        toast.error("Couldn't save profile", { description: error.message });
        return;
      }
      toast.success("Profile saved");
      return;
    }
    setSaving(false);
    toast.success("Profile saved");
  };

  const handleLogout = async () => {
    await signOut();
    if (configured) router.replace("/login");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear across Co.AI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} disabled readOnly />
            {configured && (
              <p className="text-xs text-muted-foreground">
                Your email comes from your Google account and can&apos;t be changed here.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={handleLogout} className="gap-2">
              <LogOut className="size-4" /> Log out
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Irreversible actions — CoChat and CoCode are cleared independently.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Delete all CoChat history</p>
              <p className="text-sm text-muted-foreground">Every chat, message, and CoChat memory. Cannot be undone.</p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmDeleteChats(true)}>
              Delete all chats
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Delete all CoCode projects</p>
              <p className="text-sm text-muted-foreground">Every project and CoCode build memory. Cannot be undone.</p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmDeleteProjects(true)}>
              Delete all projects
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Delete your account and all data.</p>
            <Button variant="destructive" onClick={() => toast("Contact support to delete your account")}>
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDeleteChats}
        onOpenChange={setConfirmDeleteChats}
        title="Delete all CoChat history?"
        description="This permanently deletes every CoChat conversation, message, and CoChat memory. CoCode is not affected. This cannot be undone."
        confirmLabel="Delete all chats"
        onConfirm={() => {
          deleteAllConversations().catch(() => {});
        }}
      />
      <ConfirmDialog
        open={confirmDeleteProjects}
        onOpenChange={setConfirmDeleteProjects}
        title="Delete all CoCode projects?"
        description="This permanently deletes every CoCode project and CoCode build memory. CoChat is not affected. This cannot be undone."
        confirmLabel="Delete all projects"
        onConfirm={() => {
          deleteAllProjects().catch(() => {});
        }}
      />
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? theme ?? "dark" : "dark";
  const [reduceMotion, setReduceMotion] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Monochrome by design — surfaces adapt, colour is kept for status only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <ThemeOption
              icon={Moon}
              label="Dark"
              active={current === "dark"}
              onClick={() => setTheme("dark")}
              preview="bg-[#131519]"
            />
            <ThemeOption
              icon={Sun}
              label="Light"
              active={current === "light"}
              onClick={() => setTheme("light")}
              preview="bg-[#e6e7ea]"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Palette</CardTitle>
          <CardDescription>Black &amp; white, with colour reserved for status.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <span className="size-9 rounded-full bg-primary shadow-neo-sm" />
          <div>
            <p className="text-sm font-medium">Monochrome</p>
            <p className="text-xs text-muted-foreground">Neomorphism + glass</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="size-3.5 rounded-full bg-success" title="Success" />
            <span className="size-3.5 rounded-full bg-warning" title="Warning" />
            <span className="size-3.5 rounded-full bg-destructive" title="Error" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm font-medium">Reduce motion</p>
            <p className="text-xs text-muted-foreground">Minimize animations and transitions.</p>
          </div>
          <Switch checked={reduceMotion} onCheckedChange={setReduceMotion} />
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeOption({
  icon: Icon,
  label,
  active,
  onClick,
  preview,
}: {
  icon: typeof Moon;
  label: string;
  active: boolean;
  onClick: () => void;
  preview: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
        active ? "border-primary/50 bg-primary/10 shadow-glow-sm" : "border-border hover:border-primary/30",
      )}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-lg border border-foreground/10", preview)}>
        <Icon className="size-4 text-primary" />
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {active && <Check className="size-4 text-primary" />}
    </button>
  );
}

function KeysTab() {
  const { configured, user } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Load the masked previews of any keys already saved for this account.
  // Depends only on `user` (not authLoading) so that a slow/stalled Supabase
  // getSession() call can never permanently disable the form.
  useEffect(() => {
    if (!keysEnabled() || !user) {
      setLoading(false);
      return;
    }
    let active = true;
    loadKeys()
      .then((keys) => {
        if (!active) return;
        setPreviews(Object.fromEntries(keys.map((k) => [k.provider, k.preview])));
      })
      .catch((err) => {
        if (!active) return;
        console.warn("[KeysTab] loadKeys failed:", err instanceof Error ? err.message : String(err));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user]);

  const save = async (id: string) => {
    const value = drafts[id] ?? "";
    if (value.length < 8) {
      toast.error("That key looks too short");
      return;
    }
    if (!keysEnabled()) {
      toast.error("Sign in to save your keys", {
        description: "Key storage needs a Supabase-backed account.",
      });
      return;
    }
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const preview = await saveKey(id, value.trim());
      setPreviews((p) => ({ ...p, [id]: preview }));
      setDrafts((d) => ({ ...d, [id]: "" }));
      toast.success(`${id} key saved`, { description: "Encrypted at rest — tied to your account." });
    } catch (err) {
      if (isAppError(err)) {
        showAppErrorToast(err, {
          actionLabel: err.errorCode === "AUTH-401" ? "Sign In" : undefined,
          onAction: err.errorCode === "AUTH-401" ? () => { window.location.href = "/login"; } : undefined,
        });
      } else {
        const msg = err instanceof Error ? err.message : "unknown";
        if (msg === "not-signed-in") {
          showErrorToast("AUTH-401", { actionLabel: "Sign In", onAction: () => { window.location.href = "/login"; } });
        } else {
          toast.error("Couldn't save key", { description: msg });
        }
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const remove = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await deleteKey(id);
      setPreviews((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      toast.success(`${id} key removed`);
    } catch (err) {
      if (isAppError(err)) {
        showAppErrorToast(err);
      } else {
        showErrorToast("DB_500", { message: "Couldn't remove key." });
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> AI provider keys
          </CardTitle>
          <CardDescription>
            Bring your own keys. They&apos;re encrypted at rest and tied to your account —
            we never show them again or send them back to the browser. Leave everything blank
            to run Co.AI in mock mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              You&apos;re in offline demo mode — keys won&apos;t persist. Configure Supabase
              and sign in to securely store them against your account.
            </p>
          )}
          {configured && !user && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              Sign in to save your AI provider keys — they&apos;re encrypted and tied to your account.
            </p>
          )}
          {PROVIDERS.map((p, i) => {
            const saved = previews[p.id];
            return (
              <div key={p.id}>
                {i > 0 && <Separator className="mb-4" />}
                <div className="flex items-center justify-between">
                  <Label htmlFor={p.id} className="text-sm">
                    {p.label}
                  </Label>
                  <span className="text-xs text-muted-foreground">{p.hint}</span>
                </div>
                {saved && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
                    <Check className="size-3.5" /> Saved · {saved}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <Input
                    id={p.id}
                    type="password"
                    placeholder={saved ? "Enter a new key to replace…" : "sk-…"}
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts((k) => ({ ...k, [p.id]: e.target.value }))}
                    disabled={loading || busy[p.id] || (!user && configured)}
                  />
                  <Button variant="secondary" onClick={() => save(p.id)} disabled={loading || busy[p.id] || (!user && configured)}>
                    {busy[p.id] ? "…" : saved ? "Replace" : "Save"}
                  </Button>
                  {saved && (
                    <Button
                      variant="ghost"
                      onClick={() => remove(p.id)}
                      disabled={busy[p.id]}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function DiagnosticsTab() {
  const developerMode = useDiagnosticsStore((s) => s.developerMode);
  const setDeveloperMode = useDiagnosticsStore((s) => s.setDeveloperMode);

  return (
    <div className="space-y-4">
      {/* Full system health with error codes */}
      <SystemDiagnosticsPanel />

      {/* Step-by-step auth chain debug — diagnoses AUTH-401 root cause */}
      <AuthDebugPanel />

      {/* AI provider health */}
      <ProviderStatusPanel />

      {/* Developer Mode toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalSquare className="size-4 text-primary" /> Developer Mode
          </CardTitle>
          <CardDescription>
            Reveal raw diagnostics on error panels — HTTP status, provider response, stack trace
            and request metadata. Helpful when debugging a provider failure.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Show raw error diagnostics</p>
            <p className="text-xs text-muted-foreground">
              Secrets are always redacted before display.
            </p>
          </div>
          <Switch checked={developerMode} onCheckedChange={setDeveloperMode} />
        </CardContent>
      </Card>

      {/* Debug log category toggles */}
      <DebugLogsPanel />

      {/* In-session error log */}
      <ErrorLogPanel />
    </div>
  );
}

function BillingTab() {
  const { tier } = useAuth();
  const plan = planFor(tier);
  const displayTier = tier === "GUEST" ? "Guest" : plan.name;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-primary" /> Your plan
          </CardTitle>
          <CardDescription>
            You&apos;re on the <span className="font-medium text-foreground">{displayTier}</span> plan.
            Bring your own API key on any plan for a bigger quota (BYOK bonus).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">
            {plan.limits.dailyMessages === Infinity
              ? "Unlimited messages/day"
              : `${plan.limits.dailyMessages} messages/day`}
          </Badge>
          <Badge variant="muted">
            {plan.limits.maxProjects === Infinity
              ? "Unlimited projects"
              : `${plan.limits.maxProjects} projects`}
          </Badge>
          {plan.byokMultiplier > 1 && (
            <Badge variant="default" className="gap-1">
              <KeyRound className="size-3" /> BYOK {byokBonusLabel(tier)} quota
            </Badge>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Plans</h2>
        <PricingTable />
      </div>
    </div>
  );
}

// ── Advanced Features Tab ─────────────────────────────────────────────────────

function AdvancedTab() {
  const { can } = usePlan();
  const isAdvanced = can("cli");

  return (
    <div className="space-y-4">
      <CliSection isAdvanced={isAdvanced} />
    </div>
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
