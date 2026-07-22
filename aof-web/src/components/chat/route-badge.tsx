"use client";

import { MessageSquare, Code2, Globe, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RouteDecision, RouteTarget } from "@/lib/types";

const ICON: Record<RouteTarget, LucideIcon> = {
  chat: MessageSquare,
  code: Code2,
  search: Globe,
};

/** Tiny indicator showing which agent the router auto-selected for a reply. */
export function RouteBadge({ route }: { route: RouteDecision }) {
  const Icon = ICON[route.target];
  return (
    <Badge variant="secondary" title={route.reason} className="text-[10px] text-muted-foreground">
      <Icon className="size-3 text-primary" />
      Routed to {route.label}
    </Badge>
  );
}
