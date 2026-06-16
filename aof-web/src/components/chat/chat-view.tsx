"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Sparkles, Wand2, Download, FileText, FileJson } from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { exportConversation } from "@/lib/export";
import { Composer } from "@/components/composer/composer";
import { ResponseStyleSelector } from "./response-style-selector";
import { ChatThread } from "./chat-thread";
import { LogoMark } from "@/components/brand/logo";
import { ComposerMascot, type ComposerMascotState } from "@/components/mascot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STARTERS = [
  "Summarize this article for me",
  "Solve 12 × (3 + 4) step by step",
  "Build a landing page in React",
  "Search the web for the latest AI news",
];

export function ChatView() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const style = useChatStore((s) => s.style);
  const setStyle = useChatStore((s) => s.setStyle);
  const streaming = useChatStore((s) => s.streaming);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const consumePending = useChatStore((s) => s.consumePending);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const started = useRef(false);

  // Pick up a message handed off from the homepage composer (run once).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = consumePending();
    if (pending) void send(pending.text, pending.attachments);
  }, [consumePending, send]);

  const empty = messages.length === 0;

  // TAOTAO's mood on the input box: playful while waiting, two cats tossing a
  // yarn ball while the AI works, sad on error / quota.
  const lastMsg = messages[messages.length - 1];
  const lastError =
    lastMsg && lastMsg.role === "assistant" ? lastMsg.error : undefined;
  const mascotState: ComposerMascotState = streaming
    ? "processing"
    : lastError?.code === "AOF_ERROR_004"
      ? "quota"
      : lastError
        ? "error"
        : "waiting";

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border/70 bg-background/70 px-3 backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-foreground">Chat with Aof</span>
          <span className="hidden items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
            <Wand2 className="size-3 text-primary" /> Auto-routed
          </span>
        </div>
        <div className="flex items-center gap-2">
          {active && messages.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Download className="size-3.5" />
                  Export
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportConversation(active, "md")}>
                  <FileText className="mr-2 size-3.5" />
                  Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportConversation(active, "json")}>
                  <FileJson className="mr-2 size-3.5" />
                  JSON (.json)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <ResponseStyleSelector value={style} onChange={setStyle} size="compact" />
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center px-4 text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-card"
            >
              <LogoMark size={30} />
            </motion.div>
            <h2 className="mt-5 text-xl font-semibold">Chat with Aof</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Ask anything, attach images, PDFs or code — Aof picks the right agent
              automatically. Choose how detailed the answer should be above.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-border bg-card/50 px-3.5 py-2 text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ChatThread messages={messages} streaming={streaming} />
        )}
      </div>

      {/* composer */}
      <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
        <div className="mx-auto w-full max-w-3xl">
         <ComposerMascot state={mascotState}>
          <Composer
            placeholder="Message Aof — or attach an image, PDF or code file…"
            onSubmit={(v, atts) => void send(v, atts)}
            streaming={streaming}
            onStop={stop}
            autoFocus={!empty}
            toolbar={
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary/70" />
                <span className="text-xs text-muted-foreground">
                  Aof can make mistakes. Verify important info.
                </span>
              </div>
            }
          />
         </ComposerMascot>
        </div>
      </div>
    </div>
  );
}
