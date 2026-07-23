"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Download, FileText, FileJson, Plus } from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { useAuthStore } from "@/store/auth-store";
import { exportConversation } from "@/lib/export";
import { Composer } from "@/components/composer/composer";
import { ChatModelSelector } from "./chat-model-selector";
import { ChatThread } from "./chat-thread";
import { ComposerMascot, type ComposerMascotState } from "@/components/mascot";
import { GuestMeter } from "@/components/auth/guest-meter";
import { MobileMenuButton } from "@/components/layout/mobile-nav";
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
  const modelPreference = useChatStore((s) => s.modelPreference);
  const setModel = useChatStore((s) => s.setModel);
  const setModelAuto = useChatStore((s) => s.setModelAuto);
  const effort = useChatStore((s) => s.effort);
  const setEffort = useChatStore((s) => s.setEffort);
  const effortIntent = useChatStore((s) => s.effortIntent);
  const setEffortIntent = useChatStore((s) => s.setEffortIntent);
  const streaming = useChatStore((s) => s.streaming);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const consumePending = useChatStore((s) => s.consumePending);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const messagesStatus = useChatStore((s) =>
    activeId ? s.messagesStatus[activeId] : undefined,
  );

  // Auth readiness — we wait for this before firing the queued first message.
  // This prevents the race condition where send() is called before the Supabase
  // session resolves, causing access-gate checks to run against stale state.
  const ready = useAuthStore((s) => s.ready);

  // Kept only for old external links (`/?intent=learn`) that predate the
  // removal of the empty-state quick-action cards — no in-app control sets
  // this anymore.
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);

  // Legacy deep link support: /?intent=learn used to be the Learn card's href.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("intent") === "learn") {
      window.history.replaceState({}, "", "/");
      setPrefill({ text: "Teach me about ", nonce: Date.now() });
    }
  }, []);

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

  // Hydrate this conversation's messages from the server whenever it becomes
  // active — the localStorage cache alone can't show history saved on (or
  // trimmed past 20 messages by) another device/session. loadMessages() is a
  // no-op once already "loading"/"loaded" for this id, so this only ever
  // fires the actual fetch once per conversation per session.
  useEffect(() => {
    if (!activeId) return;
    void loadMessages(activeId);
  }, [activeId, loadMessages]);

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
      {/* ── Header ──────────────────────────────────────────────────────────
         Phone (<md): one unified bar — hamburger · model (centered) · new
         chat — replacing the stacked MobileTopbar + this header. md+: the
         sidebar already provides navigation, so this reverts to the
         original model-selector-left / export-right row. */}
      <div className="sticky top-0 z-10 bg-background pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center gap-2 border-b border-border px-3 md:justify-between md:gap-3 md:px-5">
          <MobileMenuButton className="md:hidden" />

          <div className="flex min-w-0 flex-1 items-center justify-center gap-2 md:flex-none md:justify-start">
            <ChatModelSelector
              value={model}
              preference={modelPreference}
              onChange={setModel}
              onAuto={setModelAuto}
              effortIntent={effortIntent}
              onEffortIntentChange={setEffortIntent}
              rawEffort={effort}
              onRawEffortChange={setEffort}
            />
          </div>

          <button
            type="button"
            onClick={() => selectConversation(null)}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground md:hidden"
            aria-label="New chat"
          >
            <Plus className="size-5" />
          </button>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
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
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty && messagesStatus === "loading" ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <p className="text-sm text-muted-foreground">Loading messages…</p>
          </div>
        ) : empty && messagesStatus === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-sm text-muted-foreground">Couldn&rsquo;t load this conversation.</p>
            <button
              type="button"
              onClick={() => activeId && loadMessages(activeId)}
              className="rounded-lg border border-border/50 bg-secondary/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary"
            >
              Retry
            </button>
          </div>
        ) : empty ? (
          // Deliberately blank — the composer below is the whole surface.
          <div className="h-full" />
        ) : (
          <ChatThread messages={messages} streaming={streaming} />
        )}
      </div>

      {/* ── Composer ────────────────────────────────────────────────────────── */}
      <div className="border-t border-border bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:py-4">
        <GuestMeter />
        <div className="mx-auto w-full max-w-3xl">
          <ComposerMascot state={mascotState}>
            <Composer
              placeholder="Message Co.AI — or attach an image, PDF or code file…"
              onSubmit={(v, atts) => send(v, atts)}
              disabled={!ready}
              streaming={streaming}
              onStop={stop}
              autoFocus={!empty}
              prefill={prefill}
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
