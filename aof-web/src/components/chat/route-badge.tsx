"use client";

import { MessageSquare, Code2, Globe, GraduationCap, Brain, BookOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RouteDecision, RouteTarget } from "@/lib/types";

const ICON: Record<RouteTarget, LucideIcon> = {
  chat: MessageSquare,
  code: Code2,
  search: Globe,
  tutor: GraduationCap,
  reasoning: Brain,
  research: BookOpen,
};

/** Tiny indicator showing which agent the router auto-selected for a reply. */
export function RouteBadge({ route }: { route: RouteDecision }) {
  const Icon = ICON[route.target];
  return (
    <span
      title={route.reason}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-0.5",
        "text-[10px] font-medium text-muted-foreground",
      )}
    >
      <Icon className="size-3 text-primary" />
      Routed to {route.label}
    </span>
  );
}
