"use client";

import { useState } from "react";
import { Boxes, Bug, FileCode2, Hammer, ListChecks, RotateCcw, ScanSearch, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCodeStore } from "@/store/code-store";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { CODE_MODES } from "@/lib/constants";
import { Composer } from "@/components/composer/composer";
import { ChatThread } from "@/components/chat/chat-thread";
import { Button } from "@/components/ui/button";
import { CodeModeSelector } from "@/components/code/code-mode-selector";
import { ProjectBriefPanel } from "@/components/code/project-brief";
import { TitanWorkflow } from "@/components/code/titan-workflow";
import { AgentActivity } from "./agent-activity";

// Conversation-first starters — framed as projects to discuss, not commands.
const STARTERS = [
  "Build a Discord-like chat app",
  "A REST API for a todo app",
  "A landing page with a pricing toggle",
  "A snake game that runs in the browser",
];

/** The one "Ask CoCode" surface — handles both flows from project state:
 *  an empty workspace discusses → plans → generates a new project; a
 *  workspace with real files iterates with file/diff-aware edits instead
 *  (see `sendEditMessage` in code-store.ts). No separate mode toggle. */
export function AgentPanel({ className }: { className?: string }) {
  const convo = useCodeStore((s) => s.convo);
  const brief = useCodeStore((s) => s.brief);
  const chatting = useCodeStore((s) => s.chatting);
  const building = useCodeStore((s) => s.building);
  const send = useCodeStore((s) => s.sendMessage);
  const stopChat = useCodeStore((s) => s.stopChat);
  const generate = useCodeStore((s) => s.generate);
  const createPlan = useCodeStore((s) => s.createPlan);
  const analyzeProject = useCodeStore((s) => s.analyzeProject);
  const canGenerate = useCodeStore((s) => s.canGenerate());
  const canAct = useCodeStore((s) => s.canAct());
  const debugMode = useCodeStore((s) => s.debugMode);
  const setDebugMode = useCodeStore((s) => s.setDebugMode);
  const mode = useCodeStore((s) => s.mode);
  const setMode = useCodeStore((s) => s.setMode);
  const effort = useCodeStore((s) => s.effort);
  const setEffort = useCodeStore((s) => s.setEffort);
  const reset = useCodeStore((s) => s.resetConversation);

  const hasFiles = useCocodeIDEStore((s) => s.fs.children.length > 0);
  const [briefOpen, setBriefOpen] = useState(false);

  const info = CODE_MODES.find((m) => m.id === mode)!;
  const empty = convo.length === 0;
  // Brief/Generate/Plan/Analyze only apply while discussing a brand-new
  // project — once real files exist, iteration happens by chatting for
  // diffs, so showing "Generate Code" etc. there would just be dead UI.
  const showBuildActions = !hasFiles;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-[13px] font-medium text-foreground">Ask CoCode</span>
        <div className="ml-auto">
          <CodeModeSelector value={mode} onChange={setMode} effort={effort} onEffortChange={setEffort} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === "titan" ? (
          <TitanWorkflow />
        ) : empty ? (
          <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center px-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-card">
              <Boxes className="size-6 text-primary" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">
              {hasFiles ? "Ask CoCode to change something" : "Build with CoCode"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasFiles
                ? "Describe the change you want — CoCode reads your files and replies with a diff to review."
                : "Describe your project and CoAI will ask the right questions first — like a senior engineer."}
            </p>
            {!hasFiles && (
              <div className="mt-5 grid w-full gap-2">
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
            )}
          </div>
        ) : (
          <>
            <ChatThread messages={convo} streaming={chatting} />
            <div className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6">
              <AgentActivity />
            </div>
          </>
        )}
      </div>

      {mode !== "titan" && showBuildActions && brief && (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => setBriefOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Project brief
            <span className="text-muted-foreground/60">{briefOpen ? "Hide" : "Show"}</span>
          </button>
          {briefOpen && (
            <ProjectBriefPanel
              brief={brief}
              generating={building}
              onGenerate={() => void generate()}
              className="h-64 w-full border-l-0"
            />
          )}
        </div>
      )}

      {mode !== "titan" && (
      <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl">
        {!empty && (
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {showBuildActions && (
              <>
                <Button size="sm" onClick={() => void generate()} disabled={!canGenerate}>
                  <Hammer className="size-3.5" /> Generate Code
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void createPlan()} disabled={!canAct}>
                  <ListChecks className="size-3.5" /> Create Plan
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void analyzeProject()} disabled={!canAct}>
                  <ScanSearch className="size-3.5" /> Analyze
                </Button>
              </>
            )}
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
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <Bug className="size-3.5 shrink-0" />
            Debug mode — paste your error or stack trace and CoAI will diagnose the root cause before proposing a fix.
          </div>
        )}

        <Composer
          placeholder={
            debugMode
              ? "Paste the error message or stack trace…"
              : hasFiles
                ? "Describe the change you want…"
                : "Describe your project, or answer CoAI's questions…"
          }
          onSubmit={(v) => void send(v)}
          streaming={chatting}
          onStop={stopChat}
          autoFocus={!empty}
          toolbar={
            <span className="text-xs text-muted-foreground">
              Mode: <span className="text-foreground">{info.name}</span>
              {hasFiles ? " · edits your files with diffs" : " · discusses first, then plans & generates"}
            </span>
          }
        />
      </div>
      )}
    </div>
  );
}
