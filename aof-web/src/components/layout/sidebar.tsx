"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import { PRIMARY_NAV } from "@/lib/constants";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { Settings } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { conversationsEnabled, searchMessages, type SearchHit } from "@/lib/conversations";

export function Sidebar() {
  const expanded = useUIStore((s) => s.sidebarExpanded);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const loadRemoteConversations = useChatStore((s) => s.loadRemoteConversations);
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState("");
  const [serverHits, setServerHits] = useState<SearchHit[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isInChat = pathname === "/chat" || pathname?.startsWith("/chat");

  useEffect(() => {
    loadRemoteConversations();
  }, [loadRemoteConversations]);

  // Debounced server-side FTS — fires 400ms after the user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search || search.length < 2 || !conversationsEnabled()) {
      setServerHits([]);
      return;
    }
    setServerLoading(true);
    debounceRef.current = setTimeout(async () => {
      const hits = await searchMessages(search, 15);
      setServerHits(hits);
      setServerLoading(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const startNewChat = useCallback(() => {
    selectConversation(null);
    router.push("/chat");
  }, [selectConversation, router]);

  const openConversation = useCallback(
    (id: string) => {
      selectConversation(id);
      router.push("/chat");
    },
    [selectConversation, router],
  );

  const localFiltered = conversations
    .slice(0, 60)
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

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? 264 : 76 }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      className="relative z-30 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex"
    >
      {/* ── Top: logo + new chat ─────────────────────────────────────────── */}
      <div className={cn("flex flex-col gap-3 p-3", expanded ? "items-stretch" : "items-center")}>
        <div className={cn("flex h-11 items-center", expanded ? "justify-between px-1" : "justify-center")}>
          <Link href="/" aria-label="Aof home" className="inline-flex items-center">
            {expanded ? <Logo size={30} /> : <LogoMark size={30} />}
          </Link>
          {expanded && (
            <button
              type="button"
              onClick={toggle}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-[18px]" />
            </button>
          )}
        </div>

        <NewChatButton expanded={expanded} onClick={startNewChat} />
      </div>

      {/* ── Middle: primary nav + conversation list ───────────────────────── */}
      <nav className={cn("flex flex-1 flex-col gap-1 overflow-y-auto p-3 no-scrollbar", !expanded && "items-center")}>
        {expanded && (
          <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Workspace
          </p>
        )}
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.key}
            href={item.href}
            label={item.label}
            icon={item.icon}
            expanded={expanded}
            exact={item.href === "/"}
          />
        ))}

        {/* ── Recent conversations ─────────────────────────────────────── */}
        {expanded && conversations.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            <div className="flex items-center justify-between px-2 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Recent Chats
              </p>
              <span className="text-[10px] text-muted-foreground/50">
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
                className="w-full rounded-lg border border-border/50 bg-white/[0.03] py-1.5 pl-7 pr-7 text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/30 focus:bg-white/[0.05]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {serverLoading && search.length >= 2 && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground/40">Searching…</p>
            )}

            {filtered.length === 0 && !serverLoading ? (
              <p className="px-2 py-3 text-center text-[12px] text-muted-foreground/50">
                No chats match &ldquo;{search}&rdquo;
              </p>
            ) : (
              filtered.map((conv) => {
                const hitExcerpt = search
                  ? serverHits.find((h) => h.conversationId === conv.id)?.excerpt
                  : undefined;
                return (
                  <ConversationItem
                    key={conv.id}
                    id={conv.id}
                    title={conv.title}
                    updatedAt={conv.updatedAt}
                    active={conv.id === activeId && isInChat}
                    searchQuery={search}
                    excerpt={hitExcerpt}
                    onSelect={() => openConversation(conv.id)}
                    onDelete={() => deleteConversation(conv.id)}
                    onRename={(t) => renameConversation(conv.id, t)}
                  />
                );
              })
            )}
          </div>
        )}

        <div className="mt-auto" />
        <NavLink href="/settings" label="Settings" icon={Settings} expanded={expanded} />
      </nav>

      {/* ── Bottom: theme + profile ──────────────────────────────────────── */}
      <div className={cn("flex flex-col gap-1 border-t border-sidebar-border p-3", !expanded && "items-center")}>
        {!expanded && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="size-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand</TooltipContent>
          </Tooltip>
        )}
        <ThemeToggle expanded={expanded} />
        <UserMenu expanded={expanded} />
      </div>
    </motion.aside>
  );
}

function highlight(text: string, query: string): string {
  return text; // plain — keeping JSX in the component
}

function ConversationItem({
  id,
  title,
  updatedAt,
  active,
  searchQuery,
  excerpt,
  onSelect,
  onDelete,
  onRename,
}: {
  id: string;
  title: string;
  updatedAt: string;
  active: boolean;
  searchQuery: string;
  excerpt?: string;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(title);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(title);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      {editing ? (
        <div className="flex flex-1 items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            className="flex-1 rounded border border-primary/40 bg-white/5 px-1.5 py-0.5 text-[13px] text-foreground outline-none focus:border-primary/70"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={startEdit}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title="Double-click to rename"
        >
          <MessageSquare className="size-3.5 shrink-0 opacity-60" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px]">
              {searchQuery
                ? title.split(new RegExp(`(${searchQuery})`, "gi")).map((part, i) =>
                    part.toLowerCase() === searchQuery.toLowerCase() ? (
                      <mark key={i} className="rounded bg-primary/25 text-foreground not-italic">
                        {part}
                      </mark>
                    ) : (
                      part
                    ),
                  )
                : title}
            </p>
            {excerpt ? (
              <p className="truncate text-[11px] text-muted-foreground/50 italic">{excerpt}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground/60">{timeAgo(updatedAt)}</p>
            )}
          </div>
        </button>
      )}

      {!editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
          aria-label={`Delete "${title}"`}
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function NewChatButton({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center rounded-xl bg-primary font-medium text-primary-foreground shadow-glow-sm transition-all hover:shadow-glow active:scale-[0.98]",
        expanded ? "h-11 w-full gap-2 px-3 text-sm" : "size-11 justify-center",
      )}
    >
      <Plus className="size-[20px] shrink-0" />
      {expanded && <span>New Chat</span>}
    </button>
  );

  if (expanded) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">New Chat</TooltipContent>
    </Tooltip>
  );
}
