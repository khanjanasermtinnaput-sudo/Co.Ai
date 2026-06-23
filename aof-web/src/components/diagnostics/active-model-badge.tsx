"use client";

// ── Active Model Panel ────────────────────────────────────────────────────────
// Section 1 / Section 6 of the AOF transparency spec: every assistant reply
// always shows which model actually answered, which provider it came from, and
// what role it played — never hidden behind a generic "Co.AI replied" bubble.

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelNotice } from "@/lib/errors";

export function ActiveModelBadge({ notice, className }: { notice: ModelNotice; className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-secondary/40 px-3 py-1.5 text-xs",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <Bot className="size-3.5 text-primary" />
        {notice.model}
      </span>
      <span className="text-muted-foreground">Provider: {notice.provider}</span>
      <span className="text-muted-foreground">Role: {notice.role}</span>
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        Active
      </span>
    </div>
  );
}
