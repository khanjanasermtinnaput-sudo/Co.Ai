"use client";

// ── Security Scanner Panel (Phase 36) ────────────────────────────────────────
// OWASP Top 10 detection, secrets leakage, vulnerable deps, injection risks.
// Each finding has root cause, OWASP category, CWE, and auto-fix capability.

import { useState, useMemo } from "react";
import {
  ShieldAlert, ShieldCheck, RefreshCw, ChevronDown, ChevronRight,
  AlertCircle, AlertTriangle, Info, FileCode, Wand2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { scanSecurity, type SecurityFinding, type SecuritySeverity } from "@/lib/cocode/security-scanner";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

const SEV_ICON: Record<SecuritySeverity, React.ReactNode> = {
  critical: <AlertCircle className="size-3.5 text-red-500" />,
  high: <AlertCircle className="size-3.5 text-red-400" />,
  medium: <AlertTriangle className="size-3.5 text-amber-400" />,
  low: <Info className="size-3.5 text-sky-400" />,
  info: <Info className="size-3.5 text-muted-foreground/50" />,
};

const SEV_BADGE: Record<SecuritySeverity, string> = {
  critical: "bg-red-500/25 text-red-300 border border-red-500/40",
  high: "bg-red-400/15 text-red-400 border border-red-400/30",
  medium: "bg-amber-400/15 text-amber-400 border border-amber-400/30",
  low: "bg-sky-400/15 text-sky-400 border border-sky-400/30",
  info: "bg-secondary/30 text-muted-foreground/60",
};

export function SecurityPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);

  const [findings, setFindings] = useState<SecurityFinding[] | null>(null);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<SecuritySeverity | "all">("all");
  const [fixing, setFixing] = useState<string | null>(null);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  async function scan() {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 50));
    setFindings(scanSecurity(allFiles));
    setRunning(false);
  }

  async function autoFix(finding: SecurityFinding) {
    if (!finding.autoFixable) return;
    setFixing(finding.id);

    const fileContent = allFiles.find((f) => f.path === finding.file)?.content ?? "";
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Security fix: ${finding.title}\nIssue: ${finding.description}\nFix: ${finding.recommendation}\nFile: ${finding.file}\n\`\`\`\n${fileContent.slice(0, 2000)}\n\`\`\`\nGenerate a unified git diff only.`,
        history: [],
        agent: "cocode",
        route: "security",
      }),
    });

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
      }
      const { extractDiffs } = await import("@/lib/cocode/diff");
      const diffs = extractDiffs(full);
      if (diffs.length) { setDiff(diffs[0]); setRightPanel("diff"); }
    }

    setFixing(null);
  }

  const filtered = useMemo(() =>
    (findings ?? []).filter((f) => filter === "all" || f.severity === filter),
    [findings, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    (findings ?? []).forEach((f) => { c[f.severity] = (c[f.severity] ?? 0) + 1; });
    return c;
  }, [findings]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <ShieldAlert className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Security Scanner</span>
        {findings !== null && (
          <span className="text-[11px] text-muted-foreground/60">
            {findings.length === 0
              ? "✓ No issues"
              : `${counts.critical ?? 0}C · ${counts.high ?? 0}H · ${counts.medium ?? 0}M`}
          </span>
        )}
        <Button size="sm" variant={findings ? "secondary" : "default"} className="ml-auto" onClick={scan} disabled={running}>
          <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
          {findings ? "Re-scan" : "Scan"}
        </Button>
      </div>

      {!findings ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <ShieldAlert className="size-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium">Security Scanner</p>
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              Detects OWASP Top 10 vulnerabilities, hardcoded secrets, XSS/injection risks, and outdated dependencies.
            </p>
          </div>
          <Button onClick={scan} disabled={!allFiles.length}>
            <ShieldAlert className="size-3.5" /> Run Security Scan
          </Button>
        </div>
      ) : findings.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <ShieldCheck className="size-12 text-emerald-400/60" />
          <p className="font-medium text-emerald-400">No Security Issues Found</p>
          <p className="text-[12px] text-muted-foreground/60">Your codebase passed the security scan.</p>
        </div>
      ) : (
        <>
          {/* Filter */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border/50 px-3 py-1 no-scrollbar">
            {(["all", "critical", "high", "medium", "low"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFilter(s)}
                className={cn(
                  "shrink-0 rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                  filter === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}>
                {s}{s !== "all" && counts[s] ? ` (${counts[s]})` : ""}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.map((f) => (
              <FindingRow key={f.id} finding={f} expanded={expanded === f.id}
                onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
                onOpenFile={() => f.file && openTab(f.file)}
                onFix={() => void autoFix(f)}
                fixing={fixing === f.id}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FindingRow({
  finding, expanded, onToggle, onOpenFile, onFix, fixing,
}: {
  finding: SecurityFinding;
  expanded: boolean;
  onToggle: () => void;
  onOpenFile: () => void;
  onFix: () => void;
  fixing: boolean;
}) {
  return (
    <div className="border-b border-border/30">
      <button type="button" onClick={onToggle}
        className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-white/[0.03]">
        {expanded ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        {SEV_ICON[finding.severity]}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium">{finding.title}</p>
          {finding.file && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpenFile(); }}
              className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary">
              <FileCode className="size-2.5" />
              {finding.file}{finding.line ? `:${finding.line}` : ""}
            </button>
          )}
        </div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize", SEV_BADGE[finding.severity])}>
          {finding.severity}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 bg-card/20 px-10 pb-3 text-[11px]">
          <div>
            <span className="text-muted-foreground/50">OWASP: </span>
            <span className="text-amber-300">{finding.owasp}</span>
            {finding.cwe && <span className="ml-2 text-muted-foreground/40">{finding.cwe}</span>}
          </div>
          <p>{finding.description}</p>
          {finding.code && (
            <pre className="overflow-x-auto rounded bg-[#0a0a0f] px-2 py-1 font-mono text-[10px] text-slate-400">
              {finding.code}
            </pre>
          )}
          <div>
            <span className="text-muted-foreground/50">Fix: </span>
            <span className="text-emerald-400">{finding.recommendation}</span>
          </div>
          {finding.autoFixable && (
            <Button size="sm" onClick={onFix} disabled={fixing}>
              {fixing ? <><Loader2 className="size-3.5 animate-spin" /> Generating fix…</> : <><Wand2 className="size-3.5" /> Auto Fix</>}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
