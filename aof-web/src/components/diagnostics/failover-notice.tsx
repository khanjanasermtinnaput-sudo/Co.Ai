"use client";

// ── Failover Notice ───────────────────────────────────────────────────────────
// Shown above a reply when the route abandoned the primary provider for a backup.
// Failovers are never hidden — the user always knows which provider answered.

import { ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FailoverNotice as FailoverNoticeT } from "@/lib/errors";

export function FailoverNotice({ notice, className }: { notice: FailoverNoticeT; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200",
        className,
      )}
    >
      <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <span className="font-medium">Primary provider failed — switched to {notice.to}.</span>{" "}
        <span className="text-amber-200/80">
          {notice.from} → {notice.to}. Reason: {notice.reason}.
        </span>
      </div>
    </div>
  );
}
