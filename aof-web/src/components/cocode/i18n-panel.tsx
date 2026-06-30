"use client";

// ── i18n Manager Panel (Phase 48) ────────────────────────────────────────────
// Extracts strings, manages translations, detects missing keys.

import { useState, useMemo } from "react";
import { Globe, Download, AlertTriangle, CheckCircle2, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { analyzeI18n, generateTranslationJSON, type ExtractedString } from "@/lib/cocode/i18n-manager";

type I18nTab = "extract" | "missing" | "translations";

export function I18nPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  const [analyzed, setAnalyzed] = useState(false);
  const [tab, setTab] = useState<I18nTab>("extract");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const report = useMemo(() => {
    if (!analyzed) return null;
    return analyzeI18n(allFiles);
  }, [analyzed, allFiles]);

  function analyze() { setAnalyzed(true); }

  function saveBaseTranslation() {
    if (!report) return;
    const json = generateTranslationJSON(report.extractedStrings);
    upsertFile("messages/en.json", json);
    openTab("messages/en.json");
  }

  function toggleFile(path: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  // Group extracted strings by file
  const byFile = useMemo(() => {
    if (!report) return new Map<string, ExtractedString[]>();
    const map = new Map<string, ExtractedString[]>();
    for (const s of report.extractedStrings) {
      if (!map.has(s.file)) map.set(s.file, []);
      map.get(s.file)!.push(s);
    }
    return map;
  }, [report]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Globe className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">i18n Manager</span>
        {report && (
          <span className="ml-auto text-[11px] text-muted-foreground/50">
            {report.extractedStrings.length} strings
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/50">
        {(["extract", "missing", "translations"] as I18nTab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn("flex-1 py-2 text-[12px] font-medium capitalize transition-colors",
              tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
            {t}
            {t === "missing" && report && report.missingKeys.length > 0 && (
              <span className="ml-1 text-[10px] text-amber-400">({report.missingKeys.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!analyzed ? (
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <Globe className="size-12 text-muted-foreground/20" />
            <p className="text-[13px] text-muted-foreground/60">Analyze your project to extract translatable strings.</p>
            <Button onClick={analyze} className="w-full">
              <RefreshCw className="size-3.5" /> Analyze Project
            </Button>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Framework banner */}
            {report && (
              <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/30 px-3 py-2">
                <span className="text-[11px] text-muted-foreground/60">Detected framework:</span>
                <span className={cn("text-[11px] font-medium", report.framework === "none" ? "text-muted-foreground/40" : "text-primary")}>
                  {report.framework === "none" ? "None detected" : report.framework}
                </span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={analyze}>
                  <RefreshCw className="size-3" />
                </Button>
              </div>
            )}

            {tab === "extract" && report && (
              <>
                <Button onClick={saveBaseTranslation} className="w-full" variant="secondary">
                  <Download className="size-3.5" /> Save messages/en.json ({report.extractedStrings.length} strings)
                </Button>

                {report.extractedStrings.length === 0 && (
                  <p className="py-8 text-center text-[12px] text-muted-foreground/50">No translatable strings found.</p>
                )}

                {Array.from(byFile.entries()).map(([filePath, strings]) => (
                  <div key={filePath} className="rounded-xl border border-border/40 overflow-hidden">
                    <button type="button" onClick={() => toggleFile(filePath)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5">
                      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground/50 transition-transform", expandedFiles.has(filePath) && "rotate-90")} />
                      <span className="flex-1 truncate text-[12px]">{filePath}</span>
                      <span className="text-[11px] text-muted-foreground/50">{strings.length}</span>
                    </button>
                    {expandedFiles.has(filePath) && (
                      <div className="divide-y divide-border/30 border-t border-border/30">
                        {strings.map((s, i) => (
                          <div key={i} className="flex items-center gap-3 px-3 py-2">
                            <code className="shrink-0 text-[11px] text-primary font-mono">{s.key}</code>
                            <span className="truncate text-[11px] text-muted-foreground/70">&quot;{s.value}&quot;</span>
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40">:{s.line}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {tab === "missing" && report && (
              <>
                {report.translationFiles.length === 0 && (
                  <p className="text-[12px] text-muted-foreground/60">No translation files found in <code>messages/</code> or <code>locales/</code>.</p>
                )}
                {/* Coverage */}
                {Object.entries(report.coverage).map(([locale, pct]) => (
                  <div key={locale} className="rounded-xl border border-border/40 bg-card/30 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-medium">{locale}</span>
                      <span className={cn("text-[12px] font-bold", pct === 100 ? "text-emerald-400" : "text-amber-400")}>{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary/30">
                      <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
                {report.missingKeys.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-amber-400/80">Missing Keys</p>
                    <div className="space-y-1">
                      {report.missingKeys.slice(0, 50).map((mk, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <AlertTriangle className="size-3 shrink-0 text-amber-400" />
                          <span className="text-muted-foreground/60">{mk.locale}:</span>
                          <code className="font-mono text-foreground/80">{mk.key}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {report.missingKeys.length === 0 && report.translationFiles.length > 0 && (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <CheckCircle2 className="size-8 text-emerald-400" />
                    <p className="text-[12px] text-emerald-400">All keys are translated!</p>
                  </div>
                )}
              </>
            )}

            {tab === "translations" && report && (
              <>
                {report.translationFiles.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground/60">No translation files detected.</p>
                ) : report.translationFiles.map((tf) => (
                  <div key={tf.path} className="rounded-xl border border-border/40 bg-card/30">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
                      <span className="text-[12px] font-medium">{tf.locale}</span>
                      <span className="text-[11px] text-muted-foreground/50">{tf.path}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground/50">{Object.keys(tf.keys).length} keys</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto divide-y divide-border/20">
                      {Object.entries(tf.keys).slice(0, 30).map(([k, v]) => (
                        <div key={k} className="flex gap-3 px-3 py-1.5 text-[11px]">
                          <code className="shrink-0 text-primary font-mono">{k}</code>
                          <span className="truncate text-muted-foreground/70">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
