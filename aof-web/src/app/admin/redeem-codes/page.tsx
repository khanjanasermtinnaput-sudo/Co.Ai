"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Ticket, Plus, RefreshCw, Copy, ToggleLeft, ToggleRight, Trash2, Eye } from "lucide-react";
import { adminApi } from "@/components/admin/admin-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface RedeemCode {
  id: string; code: string; description: string | null; plan: string;
  duration_days: number | null; max_uses: number | null; use_count: number;
  single_use_per_user: boolean; created_at: string;
  expires_at: string | null; disabled_at: string | null;
}

const PLAN_BADGE: Record<string, string> = {
  FREE: "bg-muted/50 text-muted-foreground", LITE: "bg-blue-500/10 text-blue-400",
  PRO: "bg-violet-500/10 text-violet-400", ADVANCED: "bg-amber-500/10 text-amber-400",
};

export default function RedeemCodesPage() {
  const [codes, setCodes] = useState<RedeemCode[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { active: String(activeOnly) };
      if (search) params.search = search;
      const res = await adminApi.redeemCodes.list(params);
      setCodes(res.codes ?? []);
      setTotal(res.total ?? 0);
    } catch { toast.error("Failed to load codes"); }
    finally { setLoading(false); }
  }, [activeOnly, search]);

  useEffect(() => { void load(); }, [load]);

  async function handleToggle(code: RedeemCode) {
    try {
      await adminApi.redeemCodes.update(code.id, { disabled: !code.disabled_at });
      toast.success(code.disabled_at ? "Code enabled" : "Code disabled");
      void load();
    } catch { toast.error("Failed to update code"); }
  }

  async function handleDelete(code: RedeemCode) {
    if (!confirm(`Delete code ${code.code}? This cannot be undone.`)) return;
    try {
      await adminApi.redeemCodes.delete(code.id);
      toast.success("Code deleted");
      void load();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Redeem Codes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} codes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="size-3.5" />
            Create Code
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Search codes…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-64 h-9 text-sm" />
        {["active", "all"].map((v) => (
          <button key={v} type="button"
            onClick={() => setActiveOnly(v === "active")}
            className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              (v === "active") === activeOnly
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/50 text-muted-foreground hover:border-primary/30"
            )}>{v}</button>
        ))}
      </div>

      <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/20">
              {["Code","Plan","Duration","Uses","Status","Created",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 rounded bg-muted/20 animate-pulse" /></td>
                ))}</tr>
              ))
            ) : codes.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">No codes found</td></tr>
            ) : codes.map((code) => (
              <tr key={code.id} className={cn("hover:bg-muted/10 transition-colors", code.disabled_at && "opacity-50")}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <code className="text-[12px] font-mono font-medium text-primary">{code.code}</code>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(code.code); toast.success("Copied!"); }}
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                      <Copy className="size-3" />
                    </button>
                  </div>
                  {code.description && <p className="text-[11px] text-muted-foreground mt-0.5">{code.description}</p>}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={cn("text-[10px]", PLAN_BADGE[code.plan])}>{code.plan}</Badge>
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">
                  {code.duration_days ? `${code.duration_days}d` : "Lifetime"}
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">
                  {code.use_count}{code.max_uses ? `/${code.max_uses}` : ""} uses
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={cn("text-[10px]",
                    code.disabled_at ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"
                  )}>
                    {code.disabled_at ? "Disabled" : "Active"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                  {new Date(code.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button type="button" onClick={() => handleToggle(code)} className="rounded p-1 text-muted-foreground/50 hover:text-foreground transition-colors" title={code.disabled_at ? "Enable" : "Disable"}>
                      {code.disabled_at ? <ToggleLeft className="size-3.5" /> : <ToggleRight className="size-3.5" />}
                    </button>
                    <button type="button" onClick={() => handleDelete(code)} className="rounded p-1 text-muted-foreground/50 hover:text-red-400 transition-colors" title="Delete">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateCodeDialog onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); void load(); }} />
      )}
    </div>
  );
}

function CreateCodeDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [code, setCode] = useState("");
  const [plan, setPlan] = useState("PRO");
  const [days, setDays] = useState<number | "">(30);
  const [maxUses, setMaxUses] = useState<number | "">("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);

  function generateCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    setCode(`AOF-${plan}-${seg()}-${seg()}`);
  }

  async function handleCreate() {
    if (!code.trim()) { toast.error("Code required"); return; }
    setLoading(true);
    try {
      await adminApi.redeemCodes.create({
        code: code.trim(),
        plan,
        description: desc || undefined,
        durationDays: days === "" || days === 0 ? undefined : Number(days),
        maxUses: maxUses === "" ? undefined : Number(maxUses),
      });
      toast.success("Code created");
      onSuccess();
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Ticket className="size-4 text-primary" />
          Create Redeem Code
        </h2>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AOF-PRO-XXXX" className="font-mono text-sm" />
            <Button variant="outline" size="sm" onClick={generateCode} type="button">Auto</Button>
          </div>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" className="text-sm" />
          <div>
            <Label className="text-xs mb-1.5 block">Plan</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {["FREE","LITE","PRO","ADVANCED"].map((p) => (
                <button key={p} type="button" onClick={() => setPlan(p)} className={cn("rounded-lg border py-2 text-xs font-medium transition-colors", plan === p ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground")}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Duration (days, 0=lifetime)</Label>
              <Input type="number" value={days} onChange={(e) => setDays(e.target.value === "" ? "" : Number(e.target.value))} placeholder="30" className="text-sm" min={0} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Max Uses (blank=unlimited)</Label>
              <Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value === "" ? "" : Number(e.target.value))} placeholder="∞" className="text-sm" min={1} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading}>{loading ? "Creating…" : "Create"}</Button>
        </div>
      </div>
    </div>
  );
}
