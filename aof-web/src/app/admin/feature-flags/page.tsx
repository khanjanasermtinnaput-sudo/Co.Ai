"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Flag, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { adminApi } from "@/components/admin/admin-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface FeatureFlag {
  id: string; flag_key: string; description: string | null;
  enabled: boolean; target_plans: string[] | null; target_roles: string[] | null;
  rollout_pct: number | null; created_at: string; updated_at: string;
}

const DEFAULT_FLAGS = [
  { key: "titan-mode",           desc: "Titan architect mode" },
  { key: "coagentix-code",       desc: "Coagentix Code workspace" },
  { key: "cli-access",           desc: "CLI tool access" },
  { key: "deployments",          desc: "One-click deployments" },
  { key: "research-mode",        desc: "Deep research mode" },
  { key: "experimental-models",  desc: "Experimental AI models" },
  { key: "beta-features",        desc: "Beta features access" },
  { key: "multi-agent",          desc: "Multi-agent orchestration" },
];

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.featureFlags.list();
      setFlags(res.flags ?? []);
    } catch { toast.error("Failed to load feature flags"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleToggle(flag: FeatureFlag) {
    try {
      await adminApi.featureFlags.update(flag.flag_key, { enabled: !flag.enabled });
      toast.success(`${flag.flag_key} ${!flag.enabled ? "enabled" : "disabled"}`);
      setFlags((prev) => prev.map((f) => f.flag_key === flag.flag_key ? { ...f, enabled: !f.enabled } : f));
    } catch { toast.error("Failed to toggle flag"); }
  }

  async function handleDelete(flag: FeatureFlag) {
    if (!confirm(`Delete flag "${flag.flag_key}"?`)) return;
    try {
      await adminApi.featureFlags.delete(flag.flag_key);
      toast.success("Flag deleted");
      void load();
    } catch { toast.error("Failed to delete flag"); }
  }

  const missing = DEFAULT_FLAGS.filter((d) => !flags.find((f) => f.flag_key === d.key));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Feature Flags</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{flags.filter((f) => f.enabled).length} of {flags.length} flags enabled</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="size-3.5" />
            New Flag
          </Button>
        </div>
      </div>

      {/* Quick-create missing defaults */}
      {missing.length > 0 && !loading && (
        <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
          <p className="text-sm font-medium mb-2">Suggested Platform Flags</p>
          <p className="text-xs text-muted-foreground mb-3">These standard flags haven&apos;t been created yet.</p>
          <div className="flex flex-wrap gap-2">
            {missing.map(({ key, desc }) => (
              <button key={key} type="button"
                onClick={async () => {
                  try {
                    await adminApi.featureFlags.create({ flagKey: key, description: desc, enabled: false });
                    toast.success(`Created flag: ${key}`);
                    void load();
                  } catch { toast.error("Failed to create flag"); }
                }}
                className="rounded-lg border border-dashed border-border/50 bg-background px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
              >
                + {key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Flags list */}
      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl border border-border/50 bg-card/30 animate-pulse" />
          ))
        ) : flags.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 py-16 text-center">
            <Flag className="size-8 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No feature flags yet</p>
            <p className="text-xs text-muted-foreground mt-1">Create your first flag or use the suggested ones above</p>
          </div>
        ) : (
          flags.map((flag) => (
            <div key={flag.flag_key} className={cn(
              "flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors",
              flag.enabled ? "border-primary/20 bg-primary/5" : "border-border/50 bg-card/30"
            )}>
              <Switch
                checked={flag.enabled}
                onCheckedChange={() => handleToggle(flag)}
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-mono text-[13px] font-medium">{flag.flag_key}</p>
                  {flag.enabled && (
                    <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      ENABLED
                    </Badge>
                  )}
                  {flag.rollout_pct !== null && flag.rollout_pct < 100 && (
                    <Badge variant="outline" className="text-[9px]">{flag.rollout_pct}% rollout</Badge>
                  )}
                  {flag.target_plans && flag.target_plans.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      Plans: {flag.target_plans.join(", ")}
                    </span>
                  )}
                </div>
                {flag.description && (
                  <p className="text-[12px] text-muted-foreground mt-0.5">{flag.description}</p>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground shrink-0">
                {new Date(flag.updated_at).toLocaleDateString()}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(flag)}
                className="shrink-0 rounded p-1 text-muted-foreground/40 hover:text-red-400 transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <CreateFlagDialog onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); void load(); }} />
      )}
    </div>
  );
}

function CreateFlagDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [key, setKey] = useState("");
  const [desc, setDesc] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [rollout, setRollout] = useState<number | "">("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!key.trim() || !/^[a-z0-9\-_]+$/.test(key.trim())) {
      toast.error("Key must be lowercase letters, numbers, hyphens, underscores");
      return;
    }
    setLoading(true);
    try {
      await adminApi.featureFlags.create({
        flagKey: key.trim(),
        description: desc || undefined,
        enabled,
        rolloutPct: rollout === "" ? undefined : Number(rollout),
      });
      toast.success("Feature flag created");
      onSuccess();
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Flag className="size-4 text-primary" />
          New Feature Flag
        </h2>
        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1.5 block">Flag Key (snake-case)</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s/g, "-"))} placeholder="my-feature-flag" className="font-mono text-sm" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What does this flag control?" className="text-sm" />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Enable immediately</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Rollout % (blank = 100%)</Label>
            <Input type="number" value={rollout} onChange={(e) => setRollout(e.target.value === "" ? "" : Number(e.target.value))} placeholder="100" min={0} max={100} className="text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading}>{loading ? "Creating…" : "Create Flag"}</Button>
        </div>
      </div>
    </div>
  );
}
