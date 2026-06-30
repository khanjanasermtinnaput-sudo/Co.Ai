"use client";

// Phase 79 — Enterprise Governance Engine
// RBAC, audit logs, compliance, branch policies, SSO, approvals.

import { useState } from "react";
import { Shield, Users, FileText, GitBranch, Lock, CheckCircle, XCircle, Clock, AlertTriangle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Role = "Owner" | "Admin" | "Developer" | "Reviewer" | "Viewer";
type AuditAction = "DEPLOY" | "MERGE" | "SECRET_ACCESS" | "ROLE_CHANGE" | "BRANCH_DELETE" | "CONFIG_CHANGE";
type PolicyStatus = "enforced" | "warning" | "disabled";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  lastActive: string;
}

interface AuditEntry {
  id: string;
  action: AuditAction;
  actor: string;
  resource: string;
  timestamp: string;
  result: "success" | "denied";
  ipAddress: string;
}

interface BranchPolicy {
  pattern: string;
  requiresReview: number;
  requiresCI: boolean;
  requiresApproval: boolean;
  status: PolicyStatus;
}

const MEMBERS: TeamMember[] = [
  { id: "1", name: "Khanjana S.", email: "khanjanasermtinnaput@gmail.com", role: "Owner",    lastActive: "now"        },
  { id: "2", name: "Alex Chen",   email: "alex@coai.dev",                   role: "Admin",    lastActive: "2h ago"     },
  { id: "3", name: "Sam Patel",   email: "sam@coai.dev",                    role: "Developer",lastActive: "1d ago"     },
  { id: "4", name: "Jordan Kim",  email: "jordan@coai.dev",                 role: "Reviewer", lastActive: "3d ago"     },
];

const AUDIT_LOG: AuditEntry[] = [
  { id: "1", action: "DEPLOY",        actor: "khanjanasermtinnaput", resource: "aof-web@main",       timestamp: "2 min ago",  result: "success", ipAddress: "203.1.x.x" },
  { id: "2", action: "MERGE",         actor: "alex",                 resource: "PR #42 feat/auth",   timestamp: "1h ago",     result: "success", ipAddress: "104.2.x.x" },
  { id: "3", action: "SECRET_ACCESS", actor: "unknown-ip",           resource: "ANTHROPIC_API_KEY",  timestamp: "3h ago",     result: "denied",  ipAddress: "185.x.x.x" },
  { id: "4", action: "BRANCH_DELETE", actor: "sam",                  resource: "feat/old-ui",        timestamp: "1d ago",     result: "success", ipAddress: "72.x.x.x"  },
  { id: "5", action: "ROLE_CHANGE",   actor: "khanjanasermtinnaput", resource: "jordan → Reviewer",  timestamp: "2d ago",     result: "success", ipAddress: "203.1.x.x" },
];

const BRANCH_POLICIES: BranchPolicy[] = [
  { pattern: "main",        requiresReview: 2, requiresCI: true,  requiresApproval: true,  status: "enforced" },
  { pattern: "release/*",   requiresReview: 1, requiresCI: true,  requiresApproval: true,  status: "enforced" },
  { pattern: "feat/*",      requiresReview: 1, requiresCI: true,  requiresApproval: false, status: "enforced" },
  { pattern: "hotfix/*",    requiresReview: 2, requiresCI: false, requiresApproval: true,  status: "warning"  },
];

const ROLE_COLOR: Record<Role, string> = {
  Owner:     "text-primary bg-primary/10",
  Admin:     "text-blue-400 bg-blue-500/10",
  Developer: "text-emerald-400 bg-emerald-500/10",
  Reviewer:  "text-purple-400 bg-purple-500/10",
  Viewer:    "text-muted-foreground bg-muted/20",
};

const ACTION_COLOR: Record<AuditAction, string> = {
  DEPLOY:        "text-emerald-400",
  MERGE:         "text-blue-400",
  SECRET_ACCESS: "text-red-400",
  ROLE_CHANGE:   "text-primary",
  BRANCH_DELETE: "text-amber-400",
  CONFIG_CHANGE: "text-purple-400",
};

interface GovernancePanelProps {
  className?: string;
}

export function GovernancePanel({ className }: GovernancePanelProps) {
  const [tab, setTab] = useState<"rbac" | "audit" | "policies" | "compliance">("rbac");

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Governance</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[9px] font-semibold text-red-400">
            1 ALERT
          </span>
        </div>
      </div>

      {/* Security alert */}
      <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-4 py-2">
        <AlertTriangle className="size-3 text-red-400 shrink-0" />
        <span className="text-[11px] text-red-400/90">Unauthorized SECRET_ACCESS attempt blocked from 185.x.x.x — 3h ago</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/40 bg-card/20 overflow-x-auto no-scrollbar">
        {(["rbac", "audit", "policies", "compliance"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn("shrink-0 px-3 py-2 text-[11px] font-medium capitalize transition-colors",
              tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {t === "rbac" ? "Team & Roles" : t === "audit" ? "Audit Log" : t === "policies" ? "Branch Policies" : "Compliance"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === "rbac" && (
          <>
            <div className="flex items-center justify-between px-1 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Team Members</p>
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] gap-1">
                <Plus className="size-2.5" /> Invite
              </Button>
            </div>
            {MEMBERS.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
                <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                  {m.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{m.name}</p>
                  <p className="text-[10px] text-muted-foreground/50 truncate">{m.email} · {m.lastActive}</p>
                </div>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", ROLE_COLOR[m.role])}>{m.role}</span>
              </div>
            ))}
          </>
        )}

        {tab === "audit" && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">Recent Actions</p>
            {AUDIT_LOG.map((entry) => (
              <div key={entry.id} className={cn("rounded-xl border px-3 py-2.5 transition-colors",
                entry.result === "denied" ? "border-red-500/20 bg-red-500/5" : "border-border/40 bg-card/30 hover:bg-card/50")}>
                <div className="flex items-center gap-2 mb-0.5">
                  {entry.result === "success"
                    ? <CheckCircle className="size-3 text-emerald-400 shrink-0" />
                    : <XCircle className="size-3 text-red-400 shrink-0" />}
                  <span className={cn("font-mono text-[10px] font-semibold", ACTION_COLOR[entry.action])}>{entry.action}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
                    <Clock className="size-2.5" />{entry.timestamp}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground/70 pl-5">{entry.actor} → <span className="text-foreground/70">{entry.resource}</span></p>
                <p className="text-[9px] text-muted-foreground/40 pl-5 mt-0.5">{entry.ipAddress}</p>
              </div>
            ))}
          </>
        )}

        {tab === "policies" && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">Branch Protection</p>
            {BRANCH_POLICIES.map((p) => (
              <div key={p.pattern} className={cn("rounded-xl border px-3 py-2.5 transition-colors",
                p.status === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-border/40 bg-card/30 hover:bg-card/50")}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="size-3.5 text-muted-foreground/60" />
                    <span className="font-mono font-medium text-foreground">{p.pattern}</span>
                  </div>
                  <span className={cn("text-[9px] font-semibold uppercase", p.status === "enforced" ? "text-emerald-400" : "text-amber-400")}>{p.status}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[9px] rounded bg-muted/30 px-1.5 py-0.5 text-muted-foreground/70">{p.requiresReview} reviewer{p.requiresReview !== 1 ? "s" : ""}</span>
                  {p.requiresCI && <span className="text-[9px] rounded bg-blue-500/10 text-blue-400 px-1.5 py-0.5">CI required</span>}
                  {p.requiresApproval && <span className="text-[9px] rounded bg-primary/10 text-primary px-1.5 py-0.5">approval required</span>}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "compliance" && (
          <div className="space-y-3">
            {[
              { name: "SOC 2 Type II",  status: "compliant",  note: "Last audit: Jan 2025" },
              { name: "GDPR",           status: "compliant",  note: "Data retention: 12 months" },
              { name: "ISO 27001",      status: "in-progress",note: "Audit scheduled Q2 2025" },
              { name: "HIPAA",          status: "not-started",note: "Not applicable" },
            ].map((c) => (
              <div key={c.name} className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
                <Lock className={cn("size-3.5 shrink-0", c.status === "compliant" ? "text-emerald-400" : c.status === "in-progress" ? "text-amber-400" : "text-muted-foreground/40")} />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground/60">{c.note}</p>
                </div>
                <span className={cn("text-[9px] font-semibold uppercase",
                  c.status === "compliant" ? "text-emerald-400" : c.status === "in-progress" ? "text-amber-400" : "text-muted-foreground/40")}>
                  {c.status.replace("-", " ")}
                </span>
              </div>
            ))}
            <Button variant="outline" className="w-full h-8 text-[11px] gap-1.5 mt-1">
              <FileText className="size-3" /> Export Compliance Report
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
