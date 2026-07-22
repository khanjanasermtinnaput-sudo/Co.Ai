"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { keysEnabled, loadKeys, saveKey, deleteKey } from "@/lib/keys";
import { isAppError } from "@/lib/errors/api-error";
import { showAppErrorToast, showErrorToast } from "@/components/error/error-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", hint: "One key powers every agent (recommended)" },
  { id: "gemini", label: "Google Gemini", hint: "Used for planning" },
  { id: "deepseek", label: "DeepSeek", hint: "Used for coding" },
  { id: "qwen", label: "Qwen (DashScope)", hint: "Used for review" },
  { id: "llama", label: "Groq · Llama", hint: "Used for validation" },
] as const;

export function KeysTab() {
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
            <p className="rounded-lg border border-accent-warm/30 bg-accent-warm/10 p-3 text-xs text-accent-warm">
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
