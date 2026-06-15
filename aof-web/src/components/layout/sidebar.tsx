"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen, Plus, Trash2, MessageSquare } from "lucide-react";
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
import { useEffect } from "react";

export function Sidebar() {
  const expanded = useUIStore((s) => s.sidebarExpanded);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const loadRemoteConversations = useChatStore((s) => s.loadRemoteConversations);
  const router = useRouter();
  const pathname = usePathname();

  const isInChat = pathname === "/chat" || pathname?.startsWith("/chat");

  useEffect(() => {
    loadRemoteConversations();
  }, [loadRemoteConversations]);

  const startNewChat = () => {
    selectConversation(null);
    router.push("/chat");
  };

  const openConversation = (id: string) => {
    selectConversation(id);
    router.push("/chat");
  };

  const recentConvs = conversations.slice(0, 30);

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

        {/* ── Recent conversations (only shown when expanded + in /chat) ─── */}
        {expanded && recentConvs.length > 0 && (
          <div className="mt-3">
            <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Recent Chats
            </p>
            <div className="flex flex-col gap-0.5">
              {recentConvs.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  id={conv.id}
                  title={conv.title}
                  updatedAt={conv.updatedAt}
                  active={conv.id === activeId && isInChat}
                  onSelect={() => openConversation(conv.id)}
                  onDelete={() => deleteConversation(conv.id)}
                />
              ))}
            </div>
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

function ConversationItem({
  id,
  title,
  updatedAt,
  active,
  onSelect,
  onDelete,
}: {
  id: string;
  title: string;
  updatedAt: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <MessageSquare className="size-3.5 shrink-0 opacity-60" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px]">{title}</p>
          <p className="text-[11px] text-muted-foreground/60">{timeAgo(updatedAt)}</p>
        </div>
      </button>
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
