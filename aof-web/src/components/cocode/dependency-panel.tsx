"use client";

// ── Dependency Analyzer Panel (Phase 26) ─────────────────────────────────────
// Runs the dependency analyzer on the virtual FS and shows:
// circular deps, unused imports, dead components, large files, recommendations.

import { useState, useMemo } from "react";
import {
  AlertTriangle, AlertCircle, Info, RefreshCw, ChevronDown, ChevronRight,
  Package, Trash2, CircleDot, FileCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { analyzeDependencies, type DependencyReport } from "@/lib/cocode/dependency-analyzer";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

type Section = "recommendations" | "circular" | "unused" | "dead" | "large";

export function DependencyPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const [report, setReport] = useState<DependencyReport | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<Set<Section>>(new Set(["recommendations"]));

  const allFiles = useMemo(() => flattenFiles(fs), [fs]);

  async function run() {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 50)); // yield to render
    const r = analyzeDependencies(allFiles.map((f) => ({ path: f.path, content: f.content })));
    setReport(r);
    setRunning(false);
  }

  function toggleSection(s: Section) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  const SEVERITY_ICON = {
    error: <AlertCircle className="size-3.5 text-red-400" />,
    warning: <AlertTriangle className="size-3.5 text-amber-400" />,
    info: <Info className="size-3.5 text-sky-400" />,
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Package className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Dependency Analyzer</span>
        {report && (
          <span className="ml-auto text-[11px] text-muted-foreground/60">
            {allFiles.length} files · {report.imports.length} imports
          </span>
        )}
        <Button size="sm" variant={report ? "secondary" : "default"} onClick={run} disabled={running || !allFiles.length}>
          <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
          {report ? "Re-analyze" : "Analyze"}
        </Button>
      </div>

      {!report ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <Package className="mx-auto mb-2 size-10 text-muted-foreground/30" />
            <p className="text-sm font-medium">Dependency Analyzer</p>
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              Detects circular deps, unused imports, dead code, and large bundles.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/50">
          {/* Recommendations */}
          <CollapsibleSection
            id="recommendations"
            label={`Recommendations (${report.recommendations.length})`}
            open={open.has("recommendations")}
            onToggle={() => toggleSection("recommendations")}
          >
            {report.recommendations.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-emerald-400">No issues found.</p>
            ) : report.recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                {SEVERITY_ICON[r.severity]}
                <div>
                  <p className="text-[12px]">{r.message}</p>
                  {r.file && <p className="text-[11px] text-muted-foreground/60">{r.file}</p>}
                </div>
              </div>
            ))}
          </CollapsibleSection>

          {/* Circular Dependencies */}
          <CollapsibleSection
            id="circular"
            label={`Circular Dependencies (${report.circularDeps.length})`}
            open={open.has("circular")}
            onToggle={() => toggleSection("circular")}
            badge={report.circularDeps.length > 0 ? "error" : undefined}
          >
            {report.circularDeps.length === 0 ? (
              <p className="px-4 py-2.5 text-[12px] text-emerald-400">No circular dependencies.</p>
            ) : report.circularDeps.map((cycle, i) => (
              <div key={i} className="px-4 py-2">
                <div className="flex items-center gap-1 text-[11px] text-red-400">
                  <CircleDot className="size-3 shrink-0" />
                  {cycle.join(" → ")}
                </div>
              </div>
            ))}
          </CollapsibleSection>

          {/* Unused Imports */}
          <CollapsibleSection
            id="unused"
            label={`Unused Imports (${report.unusedImports.length})`}
            open={open.has("unused")}
            onToggle={() => toggleSection("unused")}
            badge={report.unusedImports.length > 10 ? "warning" : undefined}
          >
            {report.unusedImports.length === 0 ? (
              <p className="px-4 py-2.5 text-[12px] text-emerald-400">No unused imports.</p>
            ) : report.unusedImports.map((u, i) => (
              <button key={i} type="button" onClick={() => openTab(u.file)}
                className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-white/5">
                <Trash2 className="size-3 shrink-0 text-amber-400" />
                <span className="text-[11px] text-amber-300">{u.specifier}</span>
                <span className="ml-auto truncate text-[11px] text-muted-foreground/50">{u.file}:{u.line}</span>
              </button>
            ))}
          </CollapsibleSection>

          {/* Dead Components */}
          <CollapsibleSection
            id="dead"
            label={`Dead Exports (${report.deadComponents.length})`}
            open={open.has("dead")}
            onToggle={() => toggleSection("dead")}
          >
            {report.deadComponents.length === 0 ? (
              <p className="px-4 py-2.5 text-[12px] text-emerald-400">No dead exports found.</p>
            ) : report.deadComponents.map((d, i) => (
              <div key={i} className="px-4 py-1.5 text-[11px] text-muted-foreground/70">{d}</div>
            ))}
          </CollapsibleSection>

          {/* Large Files */}
          <CollapsibleSection
            id="large"
            label={`Large Files (${report.largeBundles.length})`}
            open={open.has("large")}
            onToggle={() => toggleSection("large")}
          >
            {report.largeBundles.length === 0 ? (
              <p className="px-4 py-2.5 text-[12px] text-emerald-400">No oversized files.</p>
            ) : report.largeBundles.map((b, i) => (
              <button key={i} type="button" onClick={() => openTab(b.path)}
                className="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-white/5">
                <FileCode className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <div>
                  <p className="text-[12px] text-foreground/80">{b.path}</p>
                  <p className="text-[11px] text-muted-foreground/60">{b.lines} lines · {b.warning}</p>
                </div>
              </button>
            ))}
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  id, label, open, onToggle, children, badge,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: "error" | "warning";
}) {
  return (
    <div>
      <button type="button" onClick={onToggle}
        className="flex w-full items-center gap-2 bg-card/30 px-4 py-2.5 text-left hover:bg-card/50">
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        <span className="text-[12px] font-medium">{label}</span>
        {badge && (
          <span className={cn(
            "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            badge === "error" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400",
          )}>!</span>
        )}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
