"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV } from "@/lib/constants";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { Settings } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Sidebar() {
  const expanded = useUIStore((s) => s.sidebarExpanded);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const router = useRouter();

  const startNewChat = () => {
    selectConversation(null);
    router.push("/");
  };

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

      {/* ── Middle: primary nav ──────────────────────────────────────────── */}
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
