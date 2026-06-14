"use client";

import { Minus, AlignLeft, AlignJustify } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResponseStyle } from "@/lib/types";

interface StyleOption {
  id: ResponseStyle;
  label: string;
  icon: typeof Minus;
  hint: string;
}

export const RESPONSE_STYLES: StyleOption[] = [
  { id: "short", label: "Short", icon: Minus, hint: "Straight to the point" },
  { id: "normal", label: "Normal", icon: AlignLeft, hint: "Concise with reasoning" },
  { id: "detailed", label: "Detailed", icon: AlignJustify, hint: "Step-by-step, with examples" },
];

interface Props {
  value: ResponseStyle;
  onChange: (s: ResponseStyle) => void;
  /** "segmented" is the full pill group; "compact" hides labels on small screens. */
  size?: "segmented" | "compact";
  className?: string;
}

/** Short / Normal / Detailed verbosity control. Model choice stays automatic. */
export function ResponseStyleSelector({ value, onChange, size = "segmented", className }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Response style"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-secondary/50 p-0.5",
        className,
      )}
    >
      {RESPONSE_STYLES.map((opt) => {
        const Icon = opt.icon;
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            onClick={() => onChange(opt.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-glow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            <span className={cn(size === "compact" && "hidden sm:inline")}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
