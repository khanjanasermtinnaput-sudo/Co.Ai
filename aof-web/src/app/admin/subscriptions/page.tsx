"use client";

import React, { useEffect, useState, useCallback } from "react";
import { CreditCard, RefreshCw, Plus, ChevronLeft, ChevronRight, XCircle } from "lucide-react";
import { adminApi } from "@/components/admin/admin-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Subscription {
  id: string; user_id: string; userEmail: string | null; plan: string;
  source: string; granted_by: string | null; granted_at: string;
  expires_at: string | null; revoked_at: string | null; notes: string | null;
}

const PLAN_BADGE: Record<string, string> = {
  FREE:     "bg-muted/50 text-muted-foreground",
  LITE:     "bg-blue-500/10 text-blue-400",
  PRO:      "bg-violet-500/10 text-violet-400",
  ADVANCED: "bg-amber-500/10 text-amber-400",
};

function fmt(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [showGrant, setShowGrant] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.subscriptions.list({ page: String(page), limit: "50", active: String(activeOnly) });
      setSubs(res.subscriptions ?? []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages ?? 1);
    } catch { toast.error("Failed to load subscriptions"); }
    finally { setLoading(false); }
  }, [page, activeOnly]);

  useEffect(() => { void load(); }, [load]);

  async function handleRevoke(sub: Subscription) {
    if (!confirm(`Revoke ${sub.plan} subscription for ${sub.userEmail ?? sub.user_id}?`)) return;
    try {
      await adminApi.subscriptions.revoke(sub.id);
      toast.success("Subscription revoked");
      void load();
    } catch { toast.error("Failed to revoke subscription"); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Subscriptions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total.toLocaleString()} records</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowGrant(true)}>
            <Plus className="size-3.5" />
            Grant Subscription
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setActiveOnly(true); setPage(1); }}
          className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            activeOnly ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30"
          )}
        >
          Active Only
        </button>
        <button
          type="button"
          onClick={() => { setActiveOnly(false); setPage(1); }}
          className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            !activeOnly ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30"
          )}
        >
          All History
        </button>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                {["User", "Plan", "Source", "Granted", "Expires", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 rounded bg-muted/20 animate-pulse" /></td>
                  ))}</tr>
                ))
              ) : subs.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">No subscriptions found</td></tr>
              ) : (
                subs.map((sub) => {
                  const expired = isExpired(sub.expires_at);
                  const revoked = !!sub.revoked_at;
                  const status = revoked ? "revoked" : expired ? "expired" : "active";
                  return (
                    <tr key={sub.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 text-[13px] max-w-48 truncate">{sub.userEmail ?? sub.user_id}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn("text-[10px]", PLAN_BADGE[sub.plan])}>{sub.plan}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground capitalize">{sub.source}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">{fmt(sub.granted_at)}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                        {sub.expires_at ? fmt(sub.expires_at) : "Lifetime"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn("text-[10px]",
                          status === "active" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                          status === "expired" && "bg-orange-500/10 text-orange-400 border-orange-500/20",
                          status === "revoked" && "bg-red-500/10 text-red-400 border-red-500/20",
                        )}>
                          {status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {status === "active" && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(sub)}
                            className="rounded p-1 text-muted-foreground/50 hover:text-red-400 transition-colors"
                            title="Revoke"
                          >
                            <XCircle className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
            <p className="text-[12px] text-muted-foreground">Page {page} of {totalPages}</p>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {showGrant && (
        <GrantDialog onClose={() => setShowGrant(false)} onSuccess={() => { setShowGrant(false); void load(); }} />
      )}
    </div>
  );
}

function GrantDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [userId, setUserId] = useState("");
  const [plan, setPlan] = useState("PRO");
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGrant() {
    if (!userId.trim()) { toast.error("User ID required"); return; }
    setLoading(true);
    try {
      await adminApi.subscriptions.grant({ userId: userId.trim(), plan, durationDays: days === 0 ? undefined : days, isLifetime: days === 0, grantReason: reason });
      toast.success("Subscription granted");
      onSuccess();
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <h2 className="font-semibold flex items-center gap-2 mb-4">
          <CreditCard className="size-4 text-primary" />
          Grant Subscription
        </h2>
        <div className="space-y-3">
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User ID (UUID)" className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary/40" />
          <div className="grid grid-cols-4 gap-1.5">
            {["FREE","LITE","PRO","ADVANCED"].map((p) => (
              <button key={p} type="button" onClick={() => setPlan(p)} className={cn("rounded-lg border py-2 text-xs font-medium transition-colors", plan === p ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30")}>
                {p}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[{l:"7d",d:7},{l:"30d",d:30},{l:"90d",d:90},{l:"180d",d:180},{l:"365d",d:365},{l:"∞",d:0}].map(({l,d}) => (
              <button key={l} type="button" onClick={() => setDays(d)} className={cn("rounded-lg border py-2 text-xs font-medium transition-colors", days === d ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground")}>
                {l}
              </button>
            ))}
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary/40 resize-none h-16" />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleGrant} disabled={loading}>{loading ? "Granting…" : "Grant"}</Button>
        </div>
      </div>
    </div>
  );
}
