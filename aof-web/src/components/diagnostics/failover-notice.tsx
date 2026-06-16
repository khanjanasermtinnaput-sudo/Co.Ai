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
        "space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <ArrowRightLeft className="size-3.5 shrink-0" />
        ⚠ {notice.from} unavailable — switching model…
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-y-0.5 pl-5 text-amber-200/85">
        <dt>Previous Model</dt>
        <dd>{notice.from}</dd>
        <dt>Replacement Model</dt>
        <dd>{notice.to}</dd>
        <dt>Reason</dt>
        <dd>
          {notice.reason}
          {notice.matchScore != null ? ` · Capability Match ${notice.matchScore}%` : ""}
        </dd>
        <dt>Migration Status</dt>
        <dd className="text-emerald-300">Success</dd>
      </dl>
      <p className="pl-5 text-amber-200/70">Resuming task — no need to resend your message.</p>
    </div>
  );
}
