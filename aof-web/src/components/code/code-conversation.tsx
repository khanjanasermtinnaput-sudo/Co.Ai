"use client";

import { motion } from "framer-motion";
import { Boxes, FileCode2, Hammer, RotateCcw, Terminal } from "lucide-react";
import { useCodeStore } from "@/store/code-store";
import { CODE_MODES } from "@/lib/constants";
import type { CodeMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Composer } from "@/components/composer/composer";
import { ChatThread } from "@/components/chat/chat-thread";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { ProjectBriefPanel } from "./project-brief";

// Conversation-first starters — framed as projects to discuss, not commands.
const STARTERS = [
  "Build a Discord-like chat app",
  "A REST API for a todo app",
  "A landing page with a pricing toggle",
  "A snake game that runs in the browser",
];

export function CodeConversation({ mode }: { mode: Exclude<CodeMode, "titan"> }) {
  const convo = useCodeStore((s) => s.convo);
  const brief = useCodeStore((s) => s.brief);
  const chatting = useCodeStore((s) => s.chatting);
  const building = useCodeStore((s) => s.building);
  const buildLog = useCodeStore((s) => s.buildLog);
  const send = useCodeStore((s) => s.sendMessage);
  const stopChat = useCodeStore((s) => s.stopChat);
  const generate = useCodeStore((s) => s.generate);
  const canGenerate = useCodeStore((s) => s.canGenerate());
  const reset = useCodeStore((s) => s.resetConversation);

  const info = CODE_MODES.find((m) => m.id === mode)!;
  const empty = convo.length === 0;

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
              <h2 className="mt-5 text-xl font-semibold">Build with Aof Code</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Describe your project and Aof will ask the right questions first —
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
              {buildLog && (
                <div className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6">
                  <div className="rounded-2xl border border-white/[0.07] bg-card/60">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                      <Terminal className="size-4 text-primary" />
                      <span className="text-sm font-medium">Build output</span>
                      {building && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                          working…
                        </span>
                      )}
                    </div>
                    <div className="p-5">
                      <Markdown content={buildLog || "Starting…"} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* composer */}
        <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              placeholder="Describe your project, or answer Aof's questions…"
              onSubmit={(v) => void send(v)}
              streaming={chatting}
              onStop={stopChat}
              autoFocus={!empty}
              toolbar={
                <div className="flex w-full items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Mode: <span className="text-foreground">{info.name}</span> · discusses first,
                    then plans &amp; generates
                  </span>
                  {!empty && (
                    <button
                      type="button"
                      onClick={reset}
                      className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <RotateCcw className="size-3" /> New
                    </button>
                  )}
                  {/* compact generate button for small screens (panel is hidden there) */}
                  <Button
                    size="sm"
                    onClick={() => void generate()}
                    disabled={!canGenerate}
                    className={cn("shrink-0 lg:hidden", empty && "ml-auto")}
                  >
                    <Hammer className="size-3.5" />
                    Generate
                  </Button>
                </div>
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
