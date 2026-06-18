"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TITAN_PHASES } from "@/lib/constants";
import type { TitanPhaseKey } from "@/lib/types";

export function TitanStepper({ current }: { current: TitanPhaseKey }) {
  const currentIndex = TITAN_PHASES.findIndex((p) => p.key === current);

  return (
    <div className="no-scrollbar overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1.5 px-0.5 py-1">
        {TITAN_PHASES.map((phase, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={phase.key} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-all",
                  active && "border-primary/40 bg-primary/10 shadow-glow-sm",
                  done && "border-success/30 bg-success/10",
                  !active && !done && "border-border bg-card/40",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                    active && "bg-primary text-primary-foreground",
                    done && "bg-success text-success-foreground",
                    !active && !done && "bg-secondary text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap text-xs font-medium",
                    active && "text-foreground",
                    done && "text-success",
                    !active && !done && "text-muted-foreground",
                  )}
                >
                  {phase.short}
                </span>
              </div>
              {i < TITAN_PHASES.length - 1 && (
                <span className={cn("h-px w-3 shrink-0", done ? "bg-success/40" : "bg-border")} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
