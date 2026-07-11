"use client";

// ── Backend Transparency Panel ────────────────────────────────────────────────
// Wraps the four "which model/route actually answered" indicators (failover
// notice, model tier pill, active-model badge, route badge) behind a single
// collapse toggle. Collapsed by default to keep the reply area quiet; every
// indicator is still one click away since failovers/routing are never hidden.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessageT } from "@/lib/types";
import { FailoverNotice } from "./failover-notice";
import { ModelBadge } from "./model-badge";
import { ActiveModelBadge } from "./active-model-badge";
import { RouteBadge } from "@/components/chat/route-badge";

export function BackendPanel({
  message,
  showLabel = "Show backend",
  hideLabel = "Hide",
}: {
  message: ChatMessageT;
  showLabel?: string;
  hideLabel?: string;
}) {
  const [isBackendVisible, setIsBackendVisible] = useState(false);

  const hasBackend = Boolean(message.failover || message.model || message.activeModel || message.route);
  if (!hasBackend) return null;

  if (!isBackendVisible) {
    return (
      <button
        type="button"
        onClick={() => setIsBackendVisible(true)}
        className={cn(
          "inline-flex h-7 w-fit cursor-pointer items-center gap-1.5 rounded-lg",
          "border border-border bg-secondary/40 px-2.5 text-[11px] font-medium",
          "text-muted-foreground transition-colors",
          "hover:bg-secondary hover:text-foreground",
        )}
      >
        <Eye className="size-3.5" />
        {showLabel}
      </button>
    );
  }

  return (
    <AnimatePresence initial={false}>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex flex-col gap-1.5 overflow-hidden"
      >
        {message.failover && <FailoverNotice notice={message.failover} />}
        {message.model && <ModelBadge model={message.model} />}
        {message.activeModel && <ActiveModelBadge notice={message.activeModel} />}
        {message.route && <RouteBadge route={message.route} />}
        <button
          type="button"
          onClick={() => setIsBackendVisible(false)}
          className={cn(
            "inline-flex h-6 w-fit cursor-pointer items-center gap-1 rounded-md px-2",
            "text-[10px] font-medium text-muted-foreground transition-colors",
            "hover:text-foreground",
          )}
        >
          <ChevronUp className="size-3" />
          {hideLabel}
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
