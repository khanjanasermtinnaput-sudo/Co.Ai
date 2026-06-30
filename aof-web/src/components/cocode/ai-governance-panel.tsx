"use client";

// Phase 94 — Enterprise AI Governance
// Every AI action is logged with reasoning, confidence, affected systems,
// risk level, rollback plan, and approval requirement.
// Full traceability — nothing is a black box.

import { useState } from "react";
import { ScrollText, CheckCircle, AlertTriangle, X, Clock, Shield, RotateCcw, Search, ChevronRight, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

type ActionStatus = "pending-approval" | "approved" | "rejected" | "rolled-back" | "auto-approved";
type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

interface GovernanceRecord {
  id: string;
  timestamp: string;
  action: string;
  agent: string;
  department: string;
  reasoning: string;
  confidenceScore: number;
  affectedSystems: string[];
  riskLevel: RiskLevel;
  rollbackPlan: string;
  requiresApproval: boolean;
  status: ActionStatus;
  approvedBy?: string;
}

const RISK_COLOR: Record<RiskLevel, string> = {
  none:     "text-muted-foreground/40",
  low:      "text-emerald-400",
  medium:   "text-amber-400",
  high:     "text-red-400",
  critical: "text-red-400",
};
const RISK_BG: Record<RiskLevel, string> = {
  none:     "bg-muted/5 border-border/20",
  low:      "bg-emerald-500/5 border-emerald-500/15",
  medium:   "bg-amber-500/5 border-amber-500/15",
  high:     "bg-red-500/5 border-red-500/20",
  critical: "bg-red-500/10 border-red-500/30",
};

const STATUS_CONFIG: Record<ActionStatus, { icon: React.ElementType; color: string; label: string }> = {
  "pending-approval": { icon: Clock,         color: "text-amber-400",          label: "Pending"       },
  "approved":         { icon: CheckCircle,   color: "text-emerald-400",        label: "Approved"      },
  "auto-approved":    { icon: CheckCircle,   color: "text-primary",            label: "Auto-Approved" },
  "rejected":         { icon: X,             color: "text-red-400",            label: "Rejected"      },
  "rolled-back":      { icon: RotateCcw,     color: "text-orange-400",         label: "Rolled Back"   },
};

const RECORDS: GovernanceRecord[] = [
  {
    id: "gov-001", timestamp: "2026-06-30 14:32:11", action: "Merge hotfix branch to main",
    agent: "ReleaseBot", department: "Release Management",
    reasoning: "INC-001 root cause fixed. All 47 tests pass. P95 latency back to 180ms baseline. Merge risk is low.",
    confidenceScore: 94, affectedSystems: ["tmap-v2", "aof-web", "Railway prod"],
    riskLevel: "medium", requiresApproval: true, status: "approved", approvedBy: "Developer",
    rollbackPlan: "git revert HEAD~1 + railway rollback to previous deploy hash aef3c29",
  },
  {
    id: "gov-002", timestamp: "2026-06-30 14:28:04", action: "Rotate TMAP_API_KEY in production",
    agent: "KeyRotator", department: "Security",
    reasoning: "API key age is 47 days. Policy requires rotation every 30 days. No active sessions will be interrupted — new key staged before old key revoked.",
    confidenceScore: 99, affectedSystems: ["tmap-v2 env", "Railway secrets"],
    riskLevel: "low", requiresApproval: false, status: "auto-approved",
    rollbackPlan: "Restore previous key from AES-256-GCM encrypted backup in Supabase vault",
  },
  {
    id: "gov-003", timestamp: "2026-06-30 13:45:00", action: "Auto-scale Railway service to 3 replicas",
    agent: "Deploy Bot", department: "DevOps",
    reasoning: "CPU at 82% sustained for 8 minutes. Traffic spike from HN post. Scaling to 3 replicas reduces CPU to predicted 28%.",
    confidenceScore: 88, affectedSystems: ["Railway prod", "tmap-v2"],
    riskLevel: "low", requiresApproval: false, status: "auto-approved",
    rollbackPlan: "Scale back to 1 replica via railway scale --replicas=1",
  },
  {
    id: "gov-004", timestamp: "2026-06-30 12:10:00", action: "Delete 3 unused exports from code-store.ts",
    agent: "Coder", department: "Engineering",
    reasoning: "coarseMode, legacyBrief, oldSend have zero references across codebase. Dead code increases cognitive load.",
    confidenceScore: 97, affectedSystems: ["aof-web bundle"],
    riskLevel: "none", requiresApproval: false, status: "auto-approved",
    rollbackPlan: "git revert commit — changes are non-destructive to runtime behavior",
  },
  {
    id: "gov-005", timestamp: "2026-06-30 11:00:00", action: "Migrate Supabase schema — add enterprise_tier enum",
    agent: "Coder", department: "Engineering",
    reasoning: "Enterprise SSO requires new tier value. Migration is additive — no existing rows affected. Tested on staging.",
    confidenceScore: 91, affectedSystems: ["Supabase prod DB", "tmap-v2 auth", "aof-web"],
    riskLevel: "high", requiresApproval: true, status: "pending-approval",
    rollbackPlan: "Execute rollback migration: ALTER TYPE user_tier DROP VALUE 'enterprise' (requires no rows use the value)",
  },
];

interface AIGovernancePanelProps { className?: string }

export function AIGovernancePanel({ className }: AIGovernancePanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState(RECORDS);

  const filtered = records.filter((r) =>
    !search || r.action.toLowerCase().includes(search.toLowerCase()) || r.agent.toLowerCase().includes(search.toLowerCase())
  );
  const pending = records.filter((r) => r.status === "pending-approval").length;

  const selectedRecord = records.find((r) => r.id === selected);

  function approve(id: string) {
    setRecords((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" as ActionStatus, approvedBy: "Developer" } : r));
  }
  function reject(id: string) {
    setRecords((prev) => prev.map((r) => r.id === id ? { ...r, status: "rejected" as ActionStatus } : r));
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <ScrollText className="size-4 text-primary" />
          <span className="font-semibold text-foreground">AI Governance</span>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">{pending} pending approval</span>}
          <span className="text-[10px] text-muted-foreground/40">{records.length} records</span>
        </div>
      </div>

      <div className="border-b border-border/30 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search audit log…"
            className="w-full rounded-lg border border-border/40 bg-white/[0.02] py-1.5 pl-7 pr-3 text-[11px] outline-none focus:border-primary/30 placeholder:text-muted-foreground/30" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("overflow-y-auto p-3 space-y-1.5", selected ? "w-52 shrink-0 border-r border-border/40" : "flex-1")}>
          {filtered.map((record) => {
            const stCfg = STATUS_CONFIG[record.status];
            const StIcon = stCfg.icon;
            return (
              <button key={record.id} type="button" onClick={() => setSelected(selected === record.id ? null : record.id)}
                className={cn("w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                  record.status === "pending-approval" ? "border-amber-500/30 bg-amber-500/5" :
                  selected === record.id ? "border-primary/30 bg-primary/5" : "border-border/40 bg-card/30 hover:bg-card/50")}>
                <div className="flex items-center gap-2">
                  <StIcon className={cn("size-3 shrink-0", stCfg.color)} />
                  <span className="flex-1 font-medium text-foreground truncate text-[11px]">{record.action}</span>
                  <span className={cn("text-[9px] font-semibold shrink-0", RISK_COLOR[record.riskLevel])}>{record.riskLevel}</span>
                </div>
                {!selected && (
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/50">
                    <span>{record.agent}</span>
                    <span className="text-muted-foreground/30">·</span>
                    <span>{record.timestamp.split(" ")[1]}</span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="font-mono">{record.confidenceScore}% conf</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {selected && selectedRecord && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div>
              <p className="font-semibold text-foreground leading-tight mb-0.5">{selectedRecord.action}</p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                <span>{selectedRecord.agent}</span>
                <span>·</span>
                <span>{selectedRecord.department}</span>
                <span>·</span>
                <span>{selectedRecord.timestamp}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Confidence", value: `${selectedRecord.confidenceScore}%`, color: selectedRecord.confidenceScore >= 90 ? "text-emerald-400" : "text-amber-400" },
                { label: "Risk Level", value: selectedRecord.riskLevel, color: RISK_COLOR[selectedRecord.riskLevel] },
                { label: "Approval",   value: selectedRecord.requiresApproval ? "Required" : "Auto",  color: selectedRecord.requiresApproval ? "text-amber-400" : "text-muted-foreground/60" },
                { label: "Status",     value: STATUS_CONFIG[selectedRecord.status].label, color: STATUS_CONFIG[selectedRecord.status].color },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-border/40 bg-card/30 px-2.5 py-2">
                  <p className="text-[9px] text-muted-foreground/40">{m.label}</p>
                  <p className={cn("font-semibold capitalize text-[11px] mt-0.5", m.color)}>{m.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-muted-foreground/40 mb-1.5">AI Reasoning</p>
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{selectedRecord.reasoning}</p>
            </div>

            <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-muted-foreground/40 mb-1.5">Affected Systems</p>
              <div className="flex flex-wrap gap-1">
                {selectedRecord.affectedSystems.map((sys) => (
                  <span key={sys} className="rounded bg-muted/20 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70">{sys}</span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-orange-400/70 mb-1.5 flex items-center gap-1.5">
                <RotateCcw className="size-3" /> Rollback Plan
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">{selectedRecord.rollbackPlan}</p>
            </div>

            {selectedRecord.status === "pending-approval" && (
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => approve(selectedRecord.id)}
                  className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 py-2 text-[11px] font-semibold text-white transition-colors flex items-center justify-center gap-1.5">
                  <CheckCircle className="size-3.5" /> Approve
                </button>
                <button type="button" onClick={() => reject(selectedRecord.id)}
                  className="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 py-2 text-[11px] font-semibold text-red-400 transition-colors flex items-center justify-center gap-1.5">
                  <X className="size-3.5" /> Reject
                </button>
              </div>
            )}
            {selectedRecord.status === "approved" && selectedRecord.approvedBy && (
              <div className="flex items-center gap-2 text-[10px] text-emerald-400/70">
                <CheckCircle className="size-3" /> Approved by {selectedRecord.approvedBy}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
