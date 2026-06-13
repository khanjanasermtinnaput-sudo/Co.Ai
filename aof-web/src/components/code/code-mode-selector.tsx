"use client";

import { Check, ChevronDown, Zap, Boxes, Rocket, Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CODE_MODES } from "@/lib/constants";
import type { CodeMode } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

const ICON: Record<CodeMode, typeof Zap> = {
  lite: Zap,
  "1.0": Boxes,
  pro: Rocket,
  titan: Hexagon,
};

export function CodeModeSelector({
  value,
  onChange,
}: {
  value: CodeMode;
  onChange: (mode: CodeMode) => void;
}) {
  const current = CODE_MODES.find((m) => m.id === value) ?? CODE_MODES[0];
  const isTitan = value === "titan";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[15px] font-medium text-foreground transition-colors hover:bg-white/5"
        >
          <span className="font-semibold">Aof Code</span>
          <span className="text-muted-foreground">·</span>
          <span className={cn(isTitan ? "text-gradient-gold font-semibold" : "text-primary")}>
            {current.name}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Aof Code mode</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CODE_MODES.map((m) => {
          const Icon = ICON[m.id];
          const active = m.id === value;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onChange(m.id)}
              className={cn("items-start gap-3 py-2.5", m.titan && "data-[highlighted]:bg-primary/10")}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-7 items-center justify-center rounded-md",
                  m.titan
                    ? "bg-gradient-to-br from-amber-400/30 to-orange-500/20 [&>svg]:text-primary"
                    : "bg-primary/12 [&>svg]:text-primary",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("text-sm font-medium", m.titan ? "text-gradient-gold" : "text-foreground")}>
                    {m.name}
                  </span>
                  {m.badge && (
                    <Badge
                      variant={m.titan ? "default" : "muted"}
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {m.badge}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {m.description}
                </span>
              </span>
              {active && <Check className="mt-1 size-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
