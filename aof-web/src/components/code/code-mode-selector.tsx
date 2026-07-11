"use client";

import { Check, ChevronDown, Lock, Zap, Boxes, Rocket, Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CODE_MODES } from "@/lib/constants";
import { effortLevelsFor } from "@/lib/effort";
import type { CodeMode, EffortLevel } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EffortPicker,
  MODEL_MENU_ITEM,
  MODEL_MENU_LABEL,
  MODEL_MENU_SEPARATOR,
  MODEL_MENU_SURFACE,
  ModelIconTile,
} from "@/components/ui/model-menu";

const ICON: Record<CodeMode, typeof Zap> = {
  lite: Zap,
  "1.0": Boxes,
  pro: Rocket,
  titan: Hexagon,
};

export function CodeModeSelector({
  value,
  onChange,
  effort,
  onEffortChange,
}: {
  value: CodeMode;
  onChange: (mode: CodeMode) => void;
  effort: EffortLevel;
  onEffortChange: (effort: EffortLevel) => void;
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
          <span className="font-semibold">CoCode</span>
          <span className="text-muted-foreground">·</span>
          <span className={cn(isTitan ? "text-gradient-gold font-semibold" : "text-primary")}>
            {current.name}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={MODEL_MENU_SURFACE}>
        <DropdownMenuLabel className={MODEL_MENU_LABEL}>CoCode mode</DropdownMenuLabel>
        <DropdownMenuSeparator className={MODEL_MENU_SEPARATOR} />
        {CODE_MODES.map((m) => {
          const active = m.id === value;
          // Locked modes (Titan, for now) stay visible so the lineup reads
          // complete, but cannot be picked — the padlock explains why.
          if (m.locked) {
            return (
              <DropdownMenuItem
                key={m.id}
                disabled
                className={cn(MODEL_MENU_ITEM, "data-[disabled]:!opacity-100")}
              >
                <ModelIconTile icon={ICON[m.id]} locked />
                <span className="flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("text-sm font-semibold", m.titan ? "text-gradient-gold" : "text-neutral-400")}>
                      {m.name}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 px-1.5 py-px text-[10px] font-semibold text-amber-800">
                      <Lock className="!size-2.5 !text-amber-800" strokeWidth={2.5} />
                      Locked
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-400">
                    {m.description}
                  </span>
                </span>
                <Lock className="mt-1 !size-4 !text-neutral-300" />
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onChange(m.id)}
              className={MODEL_MENU_ITEM}
            >
              <ModelIconTile icon={ICON[m.id]} />
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-900">{m.name}</span>
                  {m.badge && (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-px text-[10px] font-medium text-neutral-600">
                      {m.badge}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
                  {m.description}
                </span>
              </span>
              {active && <Check className="mt-1 size-4 !text-neutral-900" />}
            </DropdownMenuItem>
          );
        })}
        {effortLevelsFor(value).length > 0 && (
          <>
            <DropdownMenuSeparator className={MODEL_MENU_SEPARATOR} />
            <EffortPicker model={value} value={effort} onChange={onEffortChange} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
