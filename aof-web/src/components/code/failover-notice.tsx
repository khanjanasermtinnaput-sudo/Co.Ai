"use client";

// ── Failover Notice ──────────────────────────────────────────────────────────
// Shown when the primary provider failed and Aof switched to a fallback. We never
// hide a failover — the user always knows which provider is actually serving them.

import { motion } from "framer-motion";
import { ArrowRightLeft } from "lucide-react";
import type { FailoverInfo } from "@/lib/provider-errors";

export function FailoverNotice({ info }: { info: FailoverInfo }) {
  const failed = info.from.map((f) => `${f.provider} (${f.code})`).join(", ");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6"
    >
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-medium">Primary provider failed — switched to {info.toLabel}.</span>{" "}
          {failed} was unavailable, so Aof failed over to keep the conversation going.
        </span>
      </div>
    </motion.div>
  );
}
