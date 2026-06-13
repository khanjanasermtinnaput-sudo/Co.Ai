"use client";

import { useState } from "react";
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
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/use-mounted";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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
        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountTab() {
  const [name, setName] = useState("Aof User");
  const [email, setEmail] = useState("you@aof.ai");
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
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => toast.success("Profile saved")}>Save changes</Button>
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
          <Button variant="destructive" onClick={() => toast("This is a demo — nothing deleted")}>
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
          <CardDescription>Aof looks its best in the dark.</CardDescription>
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
  const [keys, setKeys] = useState<Record<string, string>>({});
  const save = (id: string) => {
    if (!keys[id] || keys[id].length < 8) {
      toast.error("That key looks too short");
      return;
    }
    toast.success(`${id} key saved`, { description: "Stored securely (demo)" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> AI provider keys
          </CardTitle>
          <CardDescription>
            Bring your own keys. They&apos;re encrypted at rest and never leave your account.
            Leave everything blank to run Aof in mock mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PROVIDERS.map((p, i) => (
            <div key={p.id}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex items-center justify-between">
                <Label htmlFor={p.id} className="text-sm">
                  {p.label}
                </Label>
                <span className="text-xs text-muted-foreground">{p.hint}</span>
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  id={p.id}
                  type="password"
                  placeholder="sk-…"
                  value={keys[p.id] ?? ""}
                  onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                />
                <Button variant="secondary" onClick={() => save(p.id)}>
                  Save
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function BillingTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="relative overflow-hidden">
        <CardHeader>
          <Badge variant="muted" className="w-fit">
            Current
          </Badge>
          <CardTitle className="mt-1">Free</CardTitle>
          <CardDescription>Everything you need to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">
            $0<span className="text-base font-normal text-muted-foreground">/mo</span>
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {["Chat with Aof (Lite & Normal)", "Aof Code Lite & 1.0", "Up to 5 projects"].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check className="size-4 text-success" /> {f}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-primary/30 shadow-glow">
        <CardHeader>
          <Badge variant="default" className="w-fit gap-1">
            <Sparkles className="size-3" /> Recommended
          </Badge>
          <CardTitle className="mt-1">Pro</CardTitle>
          <CardDescription>For builders who ship every day.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">
            $20<span className="text-base font-normal text-muted-foreground">/mo</span>
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {["Everything in Free", "Aof Code Pro & Titan", "Unlimited projects", "Priority compute"].map(
              (f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check className="size-4 text-success" /> {f}
                </li>
              ),
            )}
          </ul>
          <Button className="mt-5 w-full" onClick={() => toast("Upgrade flow is a demo")}>
            Upgrade to Pro
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
