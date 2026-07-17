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
  Pin,
  FolderKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import { PRIMARY_NAV } from "@/lib/constants";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";
import { useProjectStore } from "@/store/project-store";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { Settings } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { conversationsEnabled, searchMessages, type SearchHit } from "@/lib/conversations";

/** CoCode's workspace lives across /code, /cocode, and /projects — none of these
 *  should ever render CoChat's conversation list (Req 1/6: no cross-product leak).
 *  Exported so the mobile nav drawer (mobile-nav.tsx) can pick the same panel
 *  the desktop sidebar shows, instead of omitting history entirely. */
export function isCoCodeArea(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith("/code") ||
    pathname.startsWith("/cocode") ||
    pathname.startsWith("/projects")
  );
}

export function Sidebar() {
  const expanded = useUIStore((s) => s.sidebarExpanded);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const router = useRouter();
  const pathname = usePathname();
  const inCoCode = isCoCodeArea(pathname);

  const startNewChat = useCallback(() => {
    // Clear the active conversation first — when already on /chat the push is a
    // no-op, and without this the next send appends to the current conversation
    // instead of starting a new one. getState() avoids subscribing the whole
    // sidebar to chat-store (only CoChatHistoryPanel needs live updates).
    useChatStore.getState().selectConversation(null);
    router.push("/chat");
  }, [router]);

  const startNewProject = useCallback(() => {
    router.push("/projects");
  }, [router]);

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? 264 : 76 }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      className="relative z-30 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex"
    >
      {/* ── Top: logo + new chat/project ──────────────────────────────────── */}
      <div className={cn("flex flex-col gap-3 p-3", expanded ? "items-stretch" : "items-center")}>
        <div className={cn("flex h-11 items-center", expanded ? "justify-between px-1" : "justify-center")}>
          <Link href="/" aria-label="Co.AI home" className="inline-flex min-h-11 min-w-11 items-center">
            {expanded ? <Logo size={30} /> : <LogoMark size={30} />}
          </Link>
          {expanded && (
            <button
              type="button"
              onClick={toggle}
              className="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-[18px]" />
            </button>
          )}
        </div>

        {inCoCode ? (
          <NewActionButton expanded={expanded} label="New Project" onClick={startNewProject} />
        ) : (
          <NewActionButton expanded={expanded} label="New Chat" onClick={startNewChat} />
        )}
      </div>

      {/* ── Middle: primary nav + workspace-scoped history ────────────────── */}
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

        {expanded && (inCoCode ? <CoCodeHistoryPanel /> : <CoChatHistoryPanel pathname={pathname} />)}

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
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
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

// ── CoChat history panel ───────────────────────────────────────────────────────
// Reads only useChatStore — never touches CoCode's projects. Exported for reuse
// by the mobile nav drawer (mobile-nav.tsx).

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

  const isInChat = pathname === "/chat" || pathname?.startsWith("/chat");

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
      router.push("/chat");
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
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Recent Chats
        </p>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-secondary/20 px-2.5 py-2">
          <span className="text-[12px] text-muted-foreground">Couldn&rsquo;t load your chats</span>
          <button
            type="button"
            onClick={() => loadRemoteConversations()}
            className="shrink-0 rounded-md border border-border/50 bg-secondary/40 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-secondary"
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
        <>
          {filtered.map((conv) => {
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
                onDelete={() => setPendingDeleteId(conv.id)}
                onRename={(t) => renameConversation(conv.id, t)}
              />
            );
          })}
          {!search && conversations.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + 60)}
              className="w-full rounded-lg px-2 py-1.5 text-center text-[12px] text-muted-foreground/60 transition-colors hover:bg-white/5 hover:text-muted-foreground"
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

// ── CoCode history panel ────────────────────────────────────────────────────────
// Reads only useProjectStore — never touches CoChat's conversations.

// Exported for reuse by the mobile nav drawer (mobile-nav.tsx).
export function CoCodeHistoryPanel() {
  const projects = useProjectStore((s) => s.projects);
  const load = useProjectStore((s) => s.load);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    });
  }, [projects, search]);

  if (projects.length === 0) return null;

  const pendingName = pendingDeleteId
    ? projects.find((p) => p.id === pendingDeleteId)?.name
    : null;

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Recent Projects
        </p>
        <span className="text-[10px] text-muted-foreground/50">
          {filtered.length}/{projects.length}
        </span>
      </div>

      <div className="relative mb-1">
        <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
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

      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-center text-[12px] text-muted-foreground/50">
          No projects match &ldquo;{search}&rdquo;
        </p>
      ) : (
        filtered.map((p) => (
          <div
            key={p.id}
            className="group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <button
              type="button"
              onClick={() => router.push(`/projects/${p.id}`)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <FolderKanban className="size-3.5 shrink-0 opacity-60" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-[13px]">
                  {p.pinned && <Pin className="size-2.5 shrink-0 fill-current text-primary" />}
                  {p.name}
                </p>
                <p className="text-[11px] text-muted-foreground/60">{timeAgo(p.updatedAt)}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPendingDeleteId(p.id);
              }}
              className="shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
              aria-label={`Delete "${p.name}"`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        title={pendingName ? `Delete "${pendingName}"?` : "Delete this project?"}
        description="This permanently deletes the project and cannot be undone."
        onConfirm={() => {
          if (pendingDeleteId) deleteProject(pendingDeleteId);
        }}
      />
    </div>
  );
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

function NewActionButton({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "group flex items-center rounded-xl bg-primary font-medium text-primary-foreground shadow-glow-sm transition-all hover:shadow-glow active:scale-[0.98]",
        expanded ? "h-11 w-full gap-2 px-3 text-sm" : "size-11 justify-center",
      )}
    >
      <Plus className="size-[20px] shrink-0" />
      {expanded && <span>{label}</span>}
    </button>
  );

  if (expanded) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
