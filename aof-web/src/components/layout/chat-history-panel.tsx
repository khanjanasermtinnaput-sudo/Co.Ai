"use client";

// ── CoChat history panel ──────────────────────────────────────────────────────
// Reads only useChatStore — never touches CoCode's projects. Rendered by the
// desktop sidebar and the mobile nav drawer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { conversationsEnabled, searchMessages, type SearchHit } from "@/lib/conversations";
import { ConversationItem } from "./conversation-item";

export function CoChatHistoryPanel({ pathname }: { pathname: string }) {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const loadRemoteConversations = useChatStore((s) => s.loadRemoteConversations);
  const conversationsListStatus = useChatStore((s) => s.conversationsListStatus);
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [serverHits, setServerHits] = useState<SearchHit[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "/" is the chat surface; /chat only survives as a redirect.
  const isInChat = pathname === "/" || pathname?.startsWith("/chat");

  useEffect(() => {
    loadRemoteConversations();
  }, [loadRemoteConversations]);

  // Reset pagination when search changes
  useEffect(() => { setVisibleCount(60); }, [search]);

  // Debounced server-side FTS — fires 400ms after the user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search || search.length < 2 || !conversationsEnabled()) {
      setServerHits([]);
      return;
    }
    setServerLoading(true);
    debounceRef.current = setTimeout(async () => {
      const hits = await searchMessages(search, 15, "cochat");
      setServerHits(hits);
      setServerLoading(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const openConversation = useCallback(
    (id: string) => {
      selectConversation(id);
      router.push("/");
    },
    [selectConversation, router],
  );

  const localFiltered = conversations
    .slice(0, search ? conversations.length : visibleCount)
    .filter((c) =>
      search
        ? c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.messages.some((m) =>
            m.content.toLowerCase().includes(search.toLowerCase()),
          )
        : true,
    );

  // Merge server hits: add conversations from server results not already in local
  const filtered = useMemo(() => {
    if (!search) return localFiltered;
    const localIds = new Set(localFiltered.map((c) => c.id));
    const serverConvIds = [...new Set(serverHits.map((h) => h.conversationId))].filter(
      (id) => !localIds.has(id),
    );
    const serverExtras = conversations.filter((c) => serverConvIds.includes(c.id));
    return [...localFiltered, ...serverExtras];
  }, [localFiltered, serverHits, conversations, search]);

  if (conversations.length === 0) {
    if (conversationsListStatus !== "error") return null;
    // A genuinely empty list looks identical to a failed fetch unless we
    // distinguish them via status — show a retry row instead of just
    // vanishing the whole section (which reads as "my chats disappeared").
    return (
      <div className="mt-3 flex flex-col gap-1 px-2">
        <p className="text-caption font-medium uppercase tracking-wider text-muted-foreground/70">
          Recent Chats
        </p>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-secondary/20 px-2.5 py-2">
          <span className="text-label text-muted-foreground">Couldn&rsquo;t load your chats</span>
          <button
            type="button"
            onClick={() => loadRemoteConversations()}
            className="shrink-0 rounded-md border border-border/50 bg-secondary/40 px-2 py-1 text-caption text-foreground transition-colors hover:bg-secondary"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const pendingTitle = pendingDeleteId
    ? conversations.find((c) => c.id === pendingDeleteId)?.title
    : null;

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-caption font-medium uppercase tracking-wider text-muted-foreground/70">
          Recent Chats
        </p>
        <span className="text-micro text-muted-foreground/50">
          {filtered.length}/{conversations.length}
        </span>
      </div>

      {/* Search bar */}
      <div className="relative mb-1">
        <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats…"
          className="w-full rounded-lg border border-border/50 bg-foreground/[0.03] py-1.5 pl-7 pr-7 text-label text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/30 focus:bg-foreground/[0.05]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {serverLoading && search.length >= 2 && (
        <p className="px-2 py-1 text-caption text-muted-foreground/40">Searching…</p>
      )}

      {filtered.length === 0 && !serverLoading ? (
        <p className="px-2 py-3 text-center text-label text-muted-foreground/50">
          No chats match &ldquo;{search}&rdquo;
        </p>
      ) : (
        <>
          {filtered.map((conv) => {
            const hitExcerpt = search
              ? serverHits.find((h) => h.conversationId === conv.id)?.excerpt
              : undefined;
            return (
              <ConversationItem
                key={conv.id}
                title={conv.title}
                updatedAt={conv.updatedAt}
                active={conv.id === activeId && isInChat}
                searchQuery={search}
                excerpt={hitExcerpt}
                onSelect={() => openConversation(conv.id)}
                onDelete={() => setPendingDeleteId(conv.id)}
                onRename={(t) => renameConversation(conv.id, t)}
              />
            );
          })}
          {!search && conversations.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + 60)}
              className="w-full rounded-lg px-2 py-1.5 text-center text-label text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-muted-foreground"
            >
              Load more ({conversations.length - visibleCount} remaining)
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        title={pendingTitle ? `Delete "${pendingTitle}"?` : "Delete this chat?"}
        description="This permanently deletes the conversation and all its messages. This cannot be undone."
        onConfirm={() => {
          if (pendingDeleteId) deleteConversation(pendingDeleteId);
        }}
      />
    </div>
  );
}
