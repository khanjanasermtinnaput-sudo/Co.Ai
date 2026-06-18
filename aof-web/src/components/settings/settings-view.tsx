"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { getSupabase } from "@/lib/supabase/client";
import { keysEnabled, loadKeys, saveKey, deleteKey } from "@/lib/keys";
import { planFor, byokBonusLabel } from "@/lib/plans";
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
import { ProviderStatusPanel } from "@/components/diagnostics/provider-status-panel";

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
      </Tabs>
    </div>
  );
}

function AccountTab() {
  const { user, configured, signOut } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

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
          <CardDescription>How you appear across Aof.</CardDescription>
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
          <CardDescription>Irreversible account actions.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Delete your account and all data.</p>
          <Button variant="destructive" onClick={() => toast("Contact support to delete your account")}>
            Delete account
          </Button>
        </CardContent>
      </Card>
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
          <CardDescription>CoAgentix looks its best in the dark.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <ThemeOption
              icon={Moon}
              label="Dark"
              active={current === "dark"}
              onClick={() => setTheme("dark")}
              preview="bg-[#0A0A0A]"
            />
            <ThemeOption
              icon={Sun}
              label="Light"
              active={current === "light"}
              onClick={() => setTheme("light")}
              preview="bg-[#f7f5f0]"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accent</CardTitle>
          <CardDescription>The signature Aof orange-gold.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <span className="size-9 rounded-full bg-primary shadow-glow" />
          <div>
            <p className="text-sm font-medium">Orange Gold</p>
            <p className="text-xs text-muted-foreground">#F59E0B</p>
          </div>
          <Badge variant="muted" className="ml-auto">
            Active
          </Badge>
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
      <span className={cn("flex size-10 items-center justify-center rounded-lg border border-white/10", preview)}>
        <Icon className="size-4 text-primary" />
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {active && <Check className="size-4 text-primary" />}
    </button>
  );
}

function KeysTab() {
  const { configured } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Load the masked previews of any keys already saved for this account.
  useEffect(() => {
    if (!keysEnabled()) {
      setLoading(false);
      return;
    }
    let active = true;
    loadKeys()
      .then((keys) => {
        if (!active) return;
        setPreviews(Object.fromEntries(keys.map((k) => [k.provider, k.preview])));
      })
      .catch(() => {
        /* not signed in yet / backend offline — just show empty inputs */
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

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
      const msg = err instanceof Error ? err.message : "unknown";
      toast.error("Couldn't save key", {
        description: msg === "not-signed-in" ? "Please sign in first." : msg,
      });
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
    } catch {
      toast.error("Couldn't remove key");
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
            to run Aof in mock mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              You&apos;re in offline demo mode — keys won&apos;t persist. Configure Supabase
              and sign in to securely store them against your account.
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
                    disabled={loading || busy[p.id]}
                  />
                  <Button variant="secondary" onClick={() => save(p.id)} disabled={loading || busy[p.id]}>
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
      <ProviderStatusPanel />

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
