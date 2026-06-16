"use client";

import { motion } from "framer-motion";
import { Terminal, FileCode2, Boxes } from "lucide-react";
import { useCodeStore } from "@/store/code-store";
import { CODE_MODES } from "@/lib/constants";
import type { CodeMode } from "@/lib/types";
import { Composer } from "@/components/composer/composer";
import { Markdown } from "@/components/chat/markdown";
import { ErrorPanel } from "@/components/diagnostics/error-panel";
import { ExportMenu } from "./export-menu";
import { CodePreview } from "./code-preview";

const EXAMPLES = [
  "A responsive pricing page with a monthly/yearly toggle",
  "A REST API for a todo app in Node.js",
  "A snake game that runs in the browser",
  "A CLI that renames files by date",
];

export function CodeBuild({ mode }: { mode: Exclude<CodeMode, "titan"> }) {
  const buildLog = useCodeStore((s) => s.buildLog);
  const buildError = useCodeStore((s) => s.buildError);
  const building = useCodeStore((s) => s.building);
  const runBuild = useCodeStore((s) => s.runBuild);
  const stopBuild = useCodeStore((s) => s.stopBuild);
  const info = CODE_MODES.find((m) => m.id === mode)!;

  const hasOutput = building || buildLog.length > 0 || buildError !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {!hasOutput ? (
            <div className="flex flex-col items-center pt-6 text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-card"
              >
                <Boxes className="size-7 text-primary" />
              </motion.div>
              <h2 className="mt-5 text-xl font-semibold">Build with Aof Code</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {info.tagline} mode — {info.description} Describe what you want and Aof
                will plan, generate and review it.
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => void runBuild(ex)}
                    className="rounded-xl border border-border bg-card/50 p-3 text-left text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
                  >
                    <FileCode2 className="mb-1.5 size-4 text-primary/80" />
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {(buildLog || building) && (
                <div className="rounded-2xl border border-white/[0.07] bg-card/60">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                    <Terminal className="size-4 text-primary" />
                    <span className="text-sm font-medium">Build output</span>
                    {building ? (
                      <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                        working…
                      </span>
                    ) : (
                      buildLog && (
                        <div className="ml-auto flex items-center gap-2">
                          <CodePreview buildLog={buildLog} />
                          <ExportMenu buildLog={buildLog} />
                        </div>
                      )

                    )}
                  </div>
                  <div className="p-5">
                    <Markdown content={buildLog || "Starting…"} />
                  </div>
                </div>
              )}
              {buildError && <ErrorPanel error={buildError} />}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            placeholder="Describe what to build…"
            onSubmit={(v) => void runBuild(v)}
            streaming={building}
            onStop={stopBuild}
            toolbar={
              <span className="text-xs text-muted-foreground">
                Mode: <span className="text-foreground">{info.name}</span> · plans, generates &amp;
                reviews your code
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}
