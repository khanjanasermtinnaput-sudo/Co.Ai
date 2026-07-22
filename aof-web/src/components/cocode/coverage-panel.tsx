"use client";

// ── Code Coverage Panel (Phase 49) ───────────────────────────────────────────
// Shows test coverage from Istanbul/V8 JSON report or estimates from FS.

import { useState, useMemo } from "react";
import { BarChart3, Upload, RefreshCw, ChevronRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import {
  parseIstanbulReport, estimateCoverage,
  type CoverageReport, type FileCoverage,
} from "@/lib/cocode/coverage-analyzer";

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400", B: "text-blue-400", C: "text-amber-400", D: "text-orange-400", F: "text-red-400",
};
const GRADE_BG: Record<string, string> = {
  A: "bg-emerald-500/10", B: "bg-blue-500/10", C: "bg-amber-500/10", D: "bg-orange-500/10", F: "bg-red-500/10",
};

function PctBar({ pct, color = "bg-primary" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary/30">
      <div className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${pct}%` }} />
    </div>
  );
}

function FileRow({ file, onClick }: { file: FileCoverage; onClick: () => void }) {
  const gradeBg = GRADE_BG[file.grade] ?? "";
  const gradeColor = GRADE_COLOR[file.grade] ?? "text-foreground";
  const name = file.path.split("/").pop() ?? file.path;

  return (
    <button type="button" onClick={onClick}
      className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground/5", gradeBg)}>
      <span className={cn("shrink-0 w-5 text-[12px] font-bold text-center", gradeColor)}>{file.grade}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px]">{name}</p>
        <PctBar pct={file.lines.pct} />
      </div>
      <span className={cn("shrink-0 text-[12px] font-medium tabular-nums", gradeColor)}>
        {file.lines.pct}%
      </span>
    </button>
  );
}

export function CoveragePanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  const [report, setReport] = useState<CoverageReport | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileCoverage | null>(null);
  const [sortBy, setSortBy] = useState<"pct" | "grade" | "name">("pct");

  function loadFromFS() {
    const sourceFiles = allFiles.filter((f) => /\.(tsx?|jsx?)$/.test(f.path) && !f.path.includes(".test.") && !f.path.includes(".spec."));
    const testFiles = allFiles.filter((f) => f.path.includes(".test.") || f.path.includes(".spec."));
    setReport(estimateCoverage(sourceFiles, testFiles));
    setSelectedFile(null);
  }

  async function loadFromJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseIstanbulReport(text);
    if (parsed) { setReport(parsed); setSelectedFile(null); }
  }

  const sortedFiles = useMemo(() => {
    if (!report) return [];
    return [...report.files].sort((a, b) => {
      if (sortBy === "pct") return a.lines.pct - b.lines.pct;
      if (sortBy === "grade") return a.grade.localeCompare(b.grade);
      return a.path.localeCompare(b.path);
    });
  }, [report, sortBy]);

  const summary = report?.summary;
  const summaryColor = summary ? (GRADE_COLOR[summary.grade] ?? "text-foreground") : "text-foreground";

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <BarChart3 className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Code Coverage</span>
        {report && (
          <span className={cn("ml-auto text-[12px] font-bold tabular-nums", summaryColor)}>{summary?.pct}%</span>
        )}
      </div>

      {!report ? (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <BarChart3 className="size-12 text-muted-foreground/20" />
          <p className="text-[13px] text-muted-foreground/60">Load coverage data or estimate from test files.</p>
          <Button onClick={loadFromFS} className="w-full">
            <RefreshCw className="size-3.5" /> Estimate from Test Files
          </Button>
          <label className="w-full cursor-pointer">
            <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 py-3 text-[12px] text-muted-foreground/60 hover:border-primary/40 hover:text-primary transition-colors">
              <Upload className="size-3.5" /> Upload coverage-summary.json
            </div>
            <input type="file" accept=".json" className="hidden" onChange={(e) => void loadFromJSON(e)} />
          </label>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Summary bar */}
          <div className="border-b border-border/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/60">
                {report.source === "estimated" ? "Estimated coverage" : "Actual coverage"} · {report.files.length} files
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={loadFromFS} className="text-[11px] text-muted-foreground/50 hover:text-foreground">
                  <RefreshCw className="size-3" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {(["statements", "branches", "functions", "lines"] as const).map((metric) => {
                const m = report.files.length > 0
                  ? { pct: Math.round(report.files.reduce((a, f) => a + f[metric].pct, 0) / report.files.length) }
                  : { pct: 0 };
                return (
                  <div key={metric} className="rounded-lg border border-border/40 bg-card/30 p-2">
                    <p className={cn("text-[14px] font-bold tabular-nums", m.pct >= 80 ? "text-emerald-400" : m.pct >= 60 ? "text-amber-400" : "text-red-400")}>
                      {m.pct}%
                    </p>
                    <p className="text-[10px] capitalize text-muted-foreground/50">{metric}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedFile ? (
            /* File detail */
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="mb-3 flex items-center gap-2">
                <button type="button" onClick={() => setSelectedFile(null)} className="text-[11px] text-primary hover:underline">← Back</button>
                <span className="text-[12px] text-muted-foreground/60 truncate">{selectedFile.path}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {(["statements", "branches", "functions", "lines"] as const).map((m) => (
                  <div key={m} className="rounded-lg border border-border/40 bg-card/30 p-3">
                    <p className={cn("text-[16px] font-bold", selectedFile[m].pct >= 80 ? "text-emerald-400" : selectedFile[m].pct >= 60 ? "text-amber-400" : "text-red-400")}>
                      {selectedFile[m].pct}%
                    </p>
                    <p className="text-[10px] capitalize text-muted-foreground/50">{m}</p>
                    <p className="text-[10px] text-muted-foreground/40">{selectedFile[m].covered}/{selectedFile[m].total}</p>
                  </div>
                ))}
              </div>
              {selectedFile.lineData.length > 0 && (
                <div className="font-mono text-[11px]">
                  {selectedFile.lineData.slice(0, 50).map((l) => (
                    <div key={l.line} className={cn("flex gap-3 px-2 py-0.5", l.covered ? "text-emerald-400/60" : "bg-red-500/10 text-red-400")}>
                      <span className="w-8 text-right text-muted-foreground/30">{l.line}</span>
                      <span>{l.covered ? `✓ ${l.hits}×` : "✗ uncovered"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* File list */
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-muted-foreground/50">
                Sort:
                {(["pct", "grade", "name"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSortBy(s)}
                    className={cn("rounded px-1.5 py-0.5 capitalize", sortBy === s ? "bg-primary/20 text-primary" : "hover:text-foreground")}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="space-y-1 p-2">
                {sortedFiles.map((f) => (
                  <FileRow key={f.path} file={f} onClick={() => setSelectedFile(f)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
