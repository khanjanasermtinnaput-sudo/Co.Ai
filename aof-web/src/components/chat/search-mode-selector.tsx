"use client";

import { Globe, Sparkles, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchMode } from "@/lib/types";

interface ModeOption {
  id: SearchMode;
  label: string;
  icon: typeof Globe;
  hint: string;
}

export const SEARCH_MODES: ModeOption[] = [
  { id: "auto", label: "Auto", icon: Sparkles, hint: "CoAI searches the web when the question needs fresh info" },
  { id: "off", label: "Off", icon: Power, hint: "Never search — answer from the model's knowledge" },
  { id: "force", label: "Force", icon: Globe, hint: "Always search the web before answering" },
];

interface Props {
  value: SearchMode;
  onChange: (m: SearchMode) => void;
  /** "compact" hides labels on small screens. */
  size?: "segmented" | "compact";
  className?: string;
}

/** Web Search control — AUTO / OFF / FORCE (Universal Search §1). */
export function SearchModeSelector({ value, onChange, size = "segmented", className }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Web search"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-secondary/50 p-0.5",
        className,
      )}
    >
      <span className="px-1.5 text-[11px] font-medium text-muted-foreground/70">
        <Globe className="inline size-3 text-primary/70" />
      </span>
      {SEARCH_MODES.map((opt) => {
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
