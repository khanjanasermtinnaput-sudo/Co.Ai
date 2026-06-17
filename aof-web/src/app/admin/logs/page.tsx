"use client";

import React, { useEffect, useState, useCallback } from "react";
import { ScrollText, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle, Info, XCircle, Zap } from "lucide-react";
import { adminApi } from "@/components/admin/admin-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SystemLog {
  id: string; actor_id: string | null; action: string;
  target_id: string | null; target_type: string | null;
  metadata: Record<string, unknown> | null; severity: string; created_at: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  info:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  warning:  "bg-amber-500/10 text-amber-400 border-amber-500/20",
  error:    "bg-red-500/10 text-red-400 border-red-500/20",
  critical: "bg-red-600/20 text-red-300 border-red-600/30",
};

const SEVERITY_ICON: Record<string, React.ElementType> = {
  info: Info, warning: AlertTriangle, error: XCircle, critical: Zap,
};

function timeStr(s: string) {
  const d = new Date(s);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function LogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState("");
  const [action, setAction] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: "50" };
      if (severity) params.severity = severity;
      if (action) params.action = action;
      const res = await adminApi.logs.list(params);
      setLogs(res.logs ?? []);
      setTotal(res.total ?? 0);
      setTotalPages(res.totalPages ?? 1);
    } catch { toast.error("Failed to load logs"); }
    finally { setLoading(false); }
  }, [page, severity, action]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">System Logs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total.toLocaleString()} log entries</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1.5">
          {["", "info", "warning", "error", "critical"].map((s) => (
            <button key={s} type="button"
              onClick={() => { setSeverity(s); setPage(1); }}
              className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors",
                severity === s ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30"
              )}>{s === "" ? "All" : s}</button>
          ))}
        </div>
        <input
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          placeholder="Filter by action…"
          className="h-8 rounded-lg border border-border/50 bg-background px-3 text-xs outline-none focus:border-primary/40 min-w-48"
        />
      </div>

      {/* Log list */}
      <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="space-y-0 divide-y divide-border/30">
          {loading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-3">
                <div className="h-4 w-16 rounded bg-muted/20 animate-pulse" />
                <div className="h-4 flex-1 rounded bg-muted/20 animate-pulse" />
              </div>
            ))
          ) : logs.length === 0 ? (
            <div className="py-16 text-center">
              <ScrollText className="size-8 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No logs found</p>
            </div>
          ) : logs.map((log) => {
            const Icon = SEVERITY_ICON[log.severity] ?? Info;
            const isExpanded = expanded === log.id;
            return (
              <div key={log.id} className="group">
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : log.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/10 transition-colors"
                >
                  <Icon className={cn("size-3.5 shrink-0 mt-0.5", {
                    info: "text-blue-400", warning: "text-amber-400",
                    error: "text-red-400", critical: "text-red-300",
                  }[log.severity] ?? "text-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={cn("text-[9px] shrink-0", SEVERITY_STYLES[log.severity])}>
                        {log.severity.toUpperCase()}
                      </Badge>
                      <code className="text-[12px] font-mono text-foreground">{log.action}</code>
                      {log.target_type && (
                        <span className="text-[11px] text-muted-foreground">→ {log.target_type}</span>
                      )}
                      {log.actor_id && (
                        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-32">by {log.actor_id.slice(0,8)}…</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                    {timeStr(log.created_at)}
                  </span>
                </button>
                {isExpanded && log.metadata && (
                  <div className="px-4 pb-3 ml-6">
                    <pre className="rounded-lg border border-border/50 bg-muted/20 p-3 text-[11px] text-muted-foreground overflow-x-auto">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
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
    </div>
  );
}
