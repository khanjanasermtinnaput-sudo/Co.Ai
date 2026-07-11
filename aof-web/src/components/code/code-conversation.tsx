"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Boxes,
  Bug,
  FileCode2,
  Files,
  Github,
  Hammer,
  ListChecks,
  RotateCcw,
  ScanSearch,
  Terminal,
} from "lucide-react";
import { useCodeStore } from "@/store/code-store";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { extractGeneratedFiles } from "@/lib/export";
import { CODE_MODES } from "@/lib/constants";
import type { CodeMode } from "@/lib/types";
import { Composer } from "@/components/composer/composer";
import { ChatThread } from "@/components/chat/chat-thread";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { ErrorPanel } from "@/components/diagnostics/error-panel";
import { ExportMenu } from "./export-menu";
import { CodePreview } from "./code-preview";
import { ProjectBriefPanel } from "./project-brief";

// Conversation-first starters — framed as projects to discuss, not commands.
const STARTERS = [
  "Build a Discord-like chat app",
  "A REST API for a todo app",
  "A landing page with a pricing toggle",
  "A snake game that runs in the browser",
];

const OUTPUT_TITLES: Record<"build" | "plan" | "analyze" | "debug", string> = {
  build: "Build output",
  plan: "Plan",
  analyze: "Project analysis",
  debug: "Debug",
};

export function CodeConversation({ mode }: { mode: Exclude<CodeMode, "titan"> }) {
  const convo = useCodeStore((s) => s.convo);
  const brief = useCodeStore((s) => s.brief);
  const chatting = useCodeStore((s) => s.chatting);
  const building = useCodeStore((s) => s.building);
  const buildLog = useCodeStore((s) => s.buildLog);
  const buildError = useCodeStore((s) => s.buildError);
  const send = useCodeStore((s) => s.sendMessage);
  const stopChat = useCodeStore((s) => s.stopChat);
  const generate = useCodeStore((s) => s.generate);
  const createPlan = useCodeStore((s) => s.createPlan);
  const analyzeProject = useCodeStore((s) => s.analyzeProject);
  const canGenerate = useCodeStore((s) => s.canGenerate());
  const canAct = useCodeStore((s) => s.canAct());
  const debugMode = useCodeStore((s) => s.debugMode);
  const setDebugMode = useCodeStore((s) => s.setDebugMode);
  const outputKind = useCodeStore((s) => s.outputKind);
  const reset = useCodeStore((s) => s.resetConversation);
  const splitGeneratedFiles = useCodeStore((s) => s.splitGeneratedFiles);
  const setViewMode = useCocodeIDEStore((s) => s.setViewMode);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);
  const fileCount = useMemo(() => extractGeneratedFiles(buildLog).length, [buildLog]);

  const info = CODE_MODES.find((m) => m.id === mode)!;
  const empty = convo.length === 0;
  const outputTitle = outputKind ? OUTPUT_TITLES[outputKind] : "Output";

  return (
    <div className="flex h-full">
      {/* conversation column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {empty ? (
            <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center px-4 text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-card"
              >
                <Boxes className="size-7 text-primary" />
              </motion.div>
              <h2 className="mt-5 text-xl font-semibold">Build with CoCode</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Describe your project and CoAI will ask the right questions first —
                like a senior engineer. When the brief is ready, hit{" "}
                <span className="text-foreground">Generate Code</span>.
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {STARTERS.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => void send(ex)}
                    className="rounded-xl border border-border bg-card/50 p-3 text-left text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
                  >
                    <FileCode2 className="mb-1.5 size-4 text-primary/80" />
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <ChatThread messages={convo} streaming={chatting} />
              {(buildLog || building || buildError) && (
                <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pb-6 sm:px-6">
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
                            <div className="ml-auto flex items-center gap-2">
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
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setViewMode("editor");
                                  setRightPanel("github");
                                }}
                              >
                                <Github className="size-3.5" /> Push to GitHub
                              </Button>
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
            </>
          )}
        </div>

        {/* action bar + composer */}
        <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
          <div className="mx-auto w-full max-w-3xl">
            {/* action buttons — trigger the existing systems */}
            {!empty && (
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void generate()} disabled={!canGenerate}>
                  <Hammer className="size-3.5" /> Generate Code
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void createPlan()} disabled={!canAct}>
                  <ListChecks className="size-3.5" /> Create Plan
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void analyzeProject()} disabled={!canAct}>
                  <ScanSearch className="size-3.5" /> Analyze
                </Button>
                <Button
                  size="sm"
                  variant={debugMode ? "default" : "outline"}
                  onClick={() => setDebugMode(!debugMode)}
                  disabled={building}
                >
                  <Bug className="size-3.5" /> Debug
                </Button>
                <button
                  type="button"
                  onClick={reset}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <RotateCcw className="size-3" /> New
                </button>
              </div>
            )}

            {debugMode && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <Bug className="size-3.5 shrink-0" />
                Debug mode — paste your error or stack trace and CoAI will diagnose the root cause
                before proposing a fix.
              </div>
            )}

            <Composer
              placeholder={
                debugMode
                  ? "Paste the error message or stack trace…"
                  : "Describe your project, or answer CoAI's questions…"
              }
              onSubmit={(v) => void send(v)}
              streaming={chatting}
              onStop={stopChat}
              autoFocus={!empty}
              toolbar={
                <span className="text-xs text-muted-foreground">
                  Mode: <span className="text-foreground">{info.name}</span> · discusses first,
                  then plans &amp; generates
                </span>
              }
            />
          </div>
        </div>
      </div>

      {/* brief panel — desktop only */}
      <ProjectBriefPanel
        brief={brief}
        generating={building}
        onGenerate={() => void generate()}
        className="hidden w-80 shrink-0 lg:flex"
      />
    </div>
  );
}
