"use client";

import { useMemo } from "react";
import { Coins, Files, Github, SplitSquareHorizontal, Eye, Code2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCodeStore } from "@/store/code-store";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { extractGeneratedFiles } from "@/lib/export";
import { diffStats } from "@/lib/cocode/diff";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/chat/markdown";
import { ErrorPanel } from "@/components/diagnostics/error-panel";
import { ExportMenu } from "@/components/code/export-menu";
import { CodePreview } from "@/components/code/code-preview";

const OUTPUT_TITLES: Record<"build" | "plan" | "analyze" | "debug", string> = {
  build: "Build output",
  plan: "Plan",
  analyze: "Project analysis",
  debug: "Debug",
};

/** High-signal summary of what CoCode just did — real file/±line counts and
 *  build state only, never a fabricated step. Lives between the chat thread
 *  and the composer in the unified agent panel. */
export function AgentActivity({ className }: { className?: string }) {
  const buildLog = useCodeStore((s) => s.buildLog);
  const building = useCodeStore((s) => s.building);
  const buildError = useCodeStore((s) => s.buildError);
  const buildUsage = useCodeStore((s) => s.buildUsage);
  const outputKind = useCodeStore((s) => s.outputKind);
  const brief = useCodeStore((s) => s.brief);
  const splitGeneratedFiles = useCodeStore((s) => s.splitGeneratedFiles);

  const diff = useCocodeIDEStore((s) => s.diff);
  const setStage = useCocodeIDEStore((s) => s.setStage);
  const setMobileView = useCocodeIDEStore((s) => s.setMobileView);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);

  const fileCount = useMemo(() => extractGeneratedFiles(buildLog).length, [buildLog]);
  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff]);

  function goto(stage: "editor" | "preview" | "diff") {
    setStage(stage);
    setMobileView(stage);
  }

  if (!buildLog && !building && !buildError && !diff) return null;

  const outputTitle = outputKind ? OUTPUT_TITLES[outputKind] : "Output";

  return (
    <div className={cn("space-y-3", className)}>
      {/* Pending diff from an edit-flow reply (existing project) */}
      {diff && diff.files.length > 0 && stats && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <SplitSquareHorizontal className="size-3.5" />
              {stats.files} file{stats.files !== 1 ? "s" : ""} changed
            </span>
            <span className="font-mono text-[11px]">
              <span className="text-emerald-400">+{stats.added}</span>{" "}
              <span className="text-red-400">-{stats.removed}</span>
            </span>
          </div>
          <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => goto("diff")}>
            <SplitSquareHorizontal className="size-3.5" /> View changes
          </Button>
        </div>
      )}

      {/* Generated build output (new project) */}
      {(buildLog || building) && (
        <div className="rounded-2xl border border-white/[0.07] bg-card/60">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Terminal className="size-4 text-primary" />
            <span className="text-sm font-medium">{outputTitle}</span>
            {building ? (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                working…
              </span>
            ) : (
              buildLog && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <CodePreview buildLog={buildLog} />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => splitGeneratedFiles()}
                    disabled={fileCount <= 1}
                    title={fileCount <= 1 ? "Only one file was generated" : "Show the full multi-file breakdown"}
                  >
                    <Files className="size-3.5" /> Split into files
                  </Button>
                  <ExportMenu buildLog={buildLog} brief={brief} />
                  <Button size="sm" variant="secondary" onClick={() => setRightPanel("github")}>
                    <Github className="size-3.5" /> Push to GitHub
                  </Button>
                  {buildUsage && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <Coins className="size-3" />
                      ~{buildUsage.inputTokens + buildUsage.outputTokens} tokens
                    </span>
                  )}
                </div>
              )
            )}
          </div>
          <div className="p-5">
            <Markdown content={buildLog || "Starting…"} />
          </div>
          {!building && buildLog && (
            <div className="flex flex-wrap gap-2 border-t border-border/60 px-4 py-2.5">
              <Button size="sm" variant="outline" onClick={() => goto("editor")}>
                <Code2 className="size-3.5" /> Open files
              </Button>
              <Button size="sm" variant="outline" onClick={() => goto("preview")}>
                <Eye className="size-3.5" /> Test this live
              </Button>
            </div>
          )}
        </div>
      )}

      {buildError && <ErrorPanel error={buildError} />}
    </div>
  );
}
