"use client";

import { useEffect, useRef } from "react";
import { Sparkles, Download, FileText, FileJson } from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { useAuthStore } from "@/store/auth-store";
import { exportConversation } from "@/lib/export";
import { Composer } from "@/components/composer/composer";
import { ChatModelSelector } from "./chat-model-selector";
import { ResponseStyleSelector } from "./response-style-selector";
import { SearchModeSelector } from "./search-mode-selector";
import { ChatThread } from "./chat-thread";
import { ComposerMascot, type ComposerMascotState } from "@/components/mascot";
import { GuestMeter } from "@/components/auth/guest-meter";
import type { Attachment } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ChatView() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
  const style = useChatStore((s) => s.style);
  const setStyle = useChatStore((s) => s.setStyle);
  const searchMode = useChatStore((s) => s.searchMode);
  const setSearchMode = useChatStore((s) => s.setSearchMode);
  const streaming = useChatStore((s) => s.streaming);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const consumePending = useChatStore((s) => s.consumePending);

  // Auth readiness — we wait for this before firing the queued first message.
  // This prevents the race condition where send() is called before the Supabase
  // session resolves, causing access-gate checks to run against stale state.
  const ready = useAuthStore((s) => s.ready);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  // Hold the homepage-queued message in a local ref so it survives across
  // the auth-readiness wait without being lost in the Zustand store.
  const pendingRef = useRef<{ text: string; attachments?: Attachment[] } | null>(null);
  const sentRef = useRef(false);

  // Step 1 — capture the pending message from the store immediately on mount.
  // consumePending() clears it from Zustand, so it won't be double-consumed.
  useEffect(() => {
    const pending = consumePending();
    if (pending) pendingRef.current = pending;
  }, [consumePending]);

  // Step 2 — once auth has resolved, fire the captured message.
  // Re-runs whenever `ready` flips true (which happens at most once per session).
  useEffect(() => {
    if (!ready) return;
    if (sentRef.current) return;
    const pending = pendingRef.current;
    if (!pending) return;
    sentRef.current = true;
    pendingRef.current = null;
    void send(pending.text, pending.attachments);
  }, [ready, send]);

  const empty = messages.length === 0;

  const lastMsg = messages[messages.length - 1];
  const lastError = lastMsg?.role === "assistant" ? lastMsg.error : undefined;
  const mascotState: ComposerMascotState = streaming
    ? "processing"
    : lastError?.code === "AOF_ERROR_004"
      ? "quota"
      : lastError
        ? "error"
        : "waiting";

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border/70 bg-background/70 px-3 backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <ChatModelSelector value={model} onChange={setModel} />
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
          <SearchModeSelector value={searchMode} onChange={setSearchMode} size="compact" />
          <ResponseStyleSelector value={style} onChange={setStyle} size="compact" />
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <span className="text-3xl" role="img" aria-label="wave">👋</span>
            <h2 className="mt-4 text-xl font-medium text-foreground">Welcome to Co.AI</h2>
            <p className="mt-2 text-sm text-muted-foreground">Start a conversation.</p>
          </div>
        ) : (
          <ChatThread messages={messages} streaming={streaming} />
        )}
      </div>

      {/* ── Composer ────────────────────────────────────────────────────────── */}
      <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
        <GuestMeter />
        <div className="mx-auto w-full max-w-3xl">
          <ComposerMascot state={mascotState}>
            <Composer
              placeholder="Message Co.AI — or attach an image, PDF or code file…"
              onSubmit={(v, atts) => void send(v, atts)}
              streaming={streaming}
              onStop={stop}
              autoFocus={!empty}
              toolbar={
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-primary/70" />
                  <span className="text-xs text-muted-foreground">
                    Co.AI can make mistakes. Verify important info.
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
