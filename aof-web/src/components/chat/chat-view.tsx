"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { MessageSquarePlus } from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { Composer } from "@/components/composer/composer";
import { ModelSelector } from "./model-selector";
import { ChatThread } from "./chat-thread";
import { LogoMark } from "@/components/brand/logo";

const STARTERS = [
  "Summarize this article for me",
  "Help me plan my week",
  "Write a polite follow-up email",
  "Explain quantum computing simply",
];

export function ChatView() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
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
    if (pending) void send(pending);
  }, [consumePending, send]);

  const empty = messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/70 bg-background/70 px-3 backdrop-blur-xl sm:px-5">
        <ModelSelector value={model} onChange={setModel} variant="header" />
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
              Ask anything — from quick questions to deep dives. Pick{" "}
              <span className="text-foreground">Lite</span> for speed or{" "}
              <span className="text-foreground">Normal</span> for richer reasoning.
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
          <Composer
            placeholder="Message Aof…"
            onSubmit={(v) => void send(v)}
            streaming={streaming}
            onStop={stop}
            autoFocus={!empty}
            toolbar={
              <div className="flex items-center gap-2">
                <MessageSquarePlus className="size-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Aof can make mistakes. Verify important info.
                </span>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
