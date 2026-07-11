"use client";

// ── Model menu building blocks ────────────────────────────────────────────────
// Shared look for the CoChat / CoCode model pickers: a white "paper" surface
// with black type, floating black icon tiles (stacked sheets underneath give
// the layered depth), and the reasoning-effort dial. The app shell stays dark;
// only these menus deliberately flip to light so the model list reads like a
// physical card deck sitting on top of the UI.

import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFORT_LABELS, defaultEffortFor, effortLevelsFor } from "@/lib/effort";
import { getModelBaseName } from "@/lib/model-branding";
import type { ChatModel, CodeMode, EffortLevel } from "@/lib/types";

// `glass-strong` on DropdownMenuContent paints a dark translucent background;
// the !important utilities are what flip this one menu to the light surface.
export const MODEL_MENU_SURFACE = cn(
  "w-[340px] rounded-2xl !border-black/[0.08] !bg-white p-2 !text-neutral-900",
  "shadow-[0_2px_4px_rgba(0,0,0,0.05),0_16px_32px_-12px_rgba(0,0,0,0.22),0_32px_72px_-16px_rgba(0,0,0,0.18)]",
);

export const MODEL_MENU_LABEL = "text-neutral-500";
export const MODEL_MENU_SEPARATOR = "!bg-neutral-200";

export const MODEL_MENU_ITEM = cn(
  "items-start gap-3 rounded-xl px-2 py-2.5",
  "focus:!bg-neutral-950/[0.05] focus:!text-neutral-900 data-[highlighted]:!bg-neutral-950/[0.05]",
);

/** Black icon tile that appears to float above the sheet — two offset layers
 *  underneath plus a long soft shadow sell the depth. */
export function ModelIconTile({
  icon: Icon,
  locked = false,
}: {
  icon: LucideIcon;
  locked?: boolean;
}) {
  return (
    <span className="relative mt-0.5 shrink-0">
      <span
        aria-hidden
        className="absolute inset-x-[7px] -bottom-[7px] h-2.5 rounded-md bg-neutral-900/10"
      />
      <span
        aria-hidden
        className="absolute inset-x-1 -bottom-1 h-3 rounded-lg bg-neutral-900/25"
      />
      <span
        className={cn(
          "relative flex size-9 items-center justify-center rounded-[10px] text-white",
          "bg-gradient-to-b from-neutral-800 to-neutral-950 ring-1 ring-black/50",
          "shadow-[0_10px_20px_-6px_rgba(0,0,0,0.5),0_4px_8px_-2px_rgba(0,0,0,0.35)]",
          locked && "opacity-75",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      {locked && (
        <span className="absolute -bottom-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/10">
          <Lock className="size-2.5 text-amber-600" strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}

/** Segmented reasoning-effort dial. Options follow the *selected* model's tier
 *  (Low/Normal/High vs Ultra/Extreme); renders nothing for Titan. Buttons are
 *  not menu items on purpose — picking an effort must not close the menu. */
export function EffortPicker({
  model,
  value,
  onChange,
}: {
  model: ChatModel | CodeMode;
  value: EffortLevel;
  onChange: (effort: EffortLevel) => void;
}) {
  const levels = effortLevelsFor(model);
  if (levels.length === 0) return null;
  const selected = levels.includes(value) ? value : defaultEffortFor(model);

  return (
    <div className="px-2 pb-1 pt-1.5">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-xs font-semibold text-neutral-900">Effort</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          {getModelBaseName(model)}
        </span>
      </div>
      <div className="mt-1.5 flex gap-1 rounded-xl bg-neutral-100 p-1 ring-1 ring-black/[0.04]">
        {levels.map((lvl) => {
          const active = lvl === selected;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => onChange(lvl)}
              aria-pressed={active}
              className={cn(
                "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all",
                active
                  ? "bg-gradient-to-b from-neutral-800 to-neutral-950 text-white shadow-[0_3px_8px_-2px_rgba(0,0,0,0.45),0_8px_16px_-6px_rgba(0,0,0,0.3)]"
                  : "text-neutral-500 hover:bg-white hover:text-neutral-900 hover:shadow-sm",
              )}
            >
              {EFFORT_LABELS[lvl]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
