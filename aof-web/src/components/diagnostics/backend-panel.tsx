"use client";

// ── Backend Transparency Panel ────────────────────────────────────────────────
// Wraps the four "which model/route actually answered" indicators (failover
// notice, model tier pill, active-model badge, route badge) behind a single
// collapse toggle — and the toggle itself only appears in Developer Mode,
// since routes and provider names are plumbing, not product. The one
// user-relevant fact, a failover, stays visible to everyone as a calm
// one-line note (it is real information about the answer they just got).

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, ChevronUp, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";
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
  const developerMode = useUIStore((s) => s.developerMode);
  const [isBackendVisible, setIsBackendVisible] = useState(false);

  const hasBackend = Boolean(message.failover || message.model || message.activeModel || message.route);
  if (!hasBackend) return null;

  if (!developerMode) {
    if (!message.failover) return null;
    return (
      <p className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 py-1 text-caption text-muted-foreground">
        <Shuffle className="size-3" />
        Answered by a backup model — your request went through fine.
      </p>
    );
  }

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
