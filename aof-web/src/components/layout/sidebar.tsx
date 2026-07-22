"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV } from "@/lib/constants";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NewActionButton } from "./new-action-button";
import { CoChatHistoryPanel } from "./chat-history-panel";
import { CoCodeHistoryPanel } from "./cocode-history-panel";

/** The Code area spans /code and /projects — it must never render CoChat's
 *  conversation list (no cross-product leak). Shared with the mobile drawer so
 *  both pick the same contextual history panel. */
export function isCoCodeArea(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/code") || pathname.startsWith("/projects");
}

export function Sidebar() {
  const expanded = useUIStore((s) => s.sidebarExpanded);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const router = useRouter();
  const pathname = usePathname();
  const inCoCode = isCoCodeArea(pathname);

  const startNewChat = useCallback(() => {
    // Clear the active conversation first — when already on the chat surface
    // the push is a no-op, and without this the next send appends to the
    // current conversation instead of starting a new one. getState() avoids
    // subscribing the whole sidebar to chat-store.
    useChatStore.getState().selectConversation(null);
    router.push("/");
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
              className="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
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
      </nav>

      {/* ── Bottom: theme + profile ──────────────────────────────────────── */}
      <div className={cn("flex flex-col gap-1 border-t border-sidebar-border p-3", !expanded && "items-center")}>
        {!expanded && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
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
