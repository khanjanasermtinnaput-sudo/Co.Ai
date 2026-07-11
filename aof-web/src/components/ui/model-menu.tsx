"use client";

// ── Model menu building blocks ────────────────────────────────────────────────
// Shared look for the CoChat / CoCode model pickers. The menu is a "paper"
// card that follows the theme — white in light mode, near-black in dark — with
// floating model tiles that invert against it (black tile in light, white tile
// in dark) so they always read as a raised, layered object. The reasoning
// effort dial is a draggable slider that snaps to the selected model's levels.

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFORT_LABELS, defaultEffortFor, effortLevelsFor } from "@/lib/effort";
import type { ChatModel, CodeMode, EffortLevel } from "@/lib/types";

// The `!` utilities override DropdownMenuContent's own glass/popover styling so
// this menu commits to a solid, theme-aware surface.
export const MODEL_MENU_SURFACE = cn(
  "w-[340px] rounded-2xl p-2",
  "!bg-white !text-neutral-900 !border-black/[0.08]",
  "dark:!bg-[#0b0b0c] dark:!text-neutral-100 dark:!border-white/10",
  "shadow-[0_2px_4px_rgba(0,0,0,0.05),0_16px_32px_-12px_rgba(0,0,0,0.22),0_32px_72px_-16px_rgba(0,0,0,0.18)]",
  "dark:shadow-[0_2px_4px_rgba(0,0,0,0.5),0_24px_48px_-16px_rgba(0,0,0,0.7)]",
);

export const MODEL_MENU_LABEL = "text-neutral-500 dark:text-neutral-400";
export const MODEL_MENU_SEPARATOR = "!bg-neutral-200 dark:!bg-white/10";

export const MODEL_MENU_ITEM = cn(
  "items-start gap-3 rounded-xl px-2 py-2.5",
  "focus:!bg-neutral-950/[0.05] focus:!text-neutral-900 data-[highlighted]:!bg-neutral-950/[0.05]",
  "dark:focus:!bg-white/[0.06] dark:focus:!text-neutral-100 dark:data-[highlighted]:!bg-white/[0.06]",
);

export const MODEL_MENU_TITLE = "text-sm font-semibold text-neutral-900 dark:text-neutral-100";
export const MODEL_MENU_DESC = "mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400";
export const MODEL_MENU_BADGE = cn(
  "rounded-full px-1.5 py-px text-[10px] font-medium",
  "border border-neutral-200 bg-neutral-50 text-neutral-600",
  "dark:border-white/10 dark:bg-white/5 dark:text-neutral-300",
);
export const MODEL_MENU_CHECK = "mt-1 size-4 !text-neutral-900 dark:!text-neutral-100";

/** Model tile that appears to float above the card — two offset sheets and a
 *  long soft shadow give the depth. It inverts per theme so it always contrasts
 *  the surface: black-on-white in light, white-on-black in dark. */
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
        className="absolute inset-x-[7px] -bottom-[7px] h-2.5 rounded-md bg-neutral-900/10 dark:bg-white/[0.07]"
      />
      <span
        aria-hidden
        className="absolute inset-x-1 -bottom-1 h-3 rounded-lg bg-neutral-900/25 dark:bg-white/15"
      />
      <span
        className={cn(
          "relative flex size-9 items-center justify-center rounded-[10px]",
          "bg-gradient-to-b from-neutral-800 to-neutral-950 text-white ring-1 ring-black/50",
          "shadow-[0_10px_20px_-6px_rgba(0,0,0,0.5),0_4px_8px_-2px_rgba(0,0,0,0.35)]",
          "dark:from-neutral-100 dark:to-white dark:text-neutral-900 dark:ring-black/20",
          "dark:shadow-[0_10px_22px_-6px_rgba(0,0,0,0.7),0_4px_8px_-2px_rgba(0,0,0,0.5)]",
          locked && "opacity-75",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      {locked && (
        <span className="absolute -bottom-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/10 dark:bg-neutral-900 dark:ring-white/15">
          <Lock className="size-2.5 text-amber-600 dark:text-amber-500" strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}

/** Draggable reasoning-effort slider. Stops follow the *selected* model's tier
 *  (3 for Mikros/Kanon, 5 for Ypertatos); renders nothing for Titan. Not a menu
 *  item on purpose — sliding/keying must not close the menu. */
export function EffortSlider({
  model,
  value,
  onChange,
}: {
  model: ChatModel | CodeMode;
  value: EffortLevel;
  onChange: (effort: EffortLevel) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const levels = effortLevelsFor(model);
  const selected = levels.includes(value) ? value : defaultEffortFor(model);
  const index = Math.max(0, levels.indexOf(selected));
  const max = levels.length - 1;

  // Hooks must run every render; bail on output only after they're declared.
  if (levels.length === 0) return null;

  const pct = max === 0 ? 0 : (index / max) * 100;

  const commitFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || max === 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const next = levels[Math.round(frac * max)];
    if (next !== selected) onChange(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    commitFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    commitFromClientX(e.clientX);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next = index;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, index - 1);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(max, index + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (levels[next] !== selected) onChange(levels[next]);
  };

  return (
    <div className="px-2 pb-1.5 pt-2">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">Effort</span>
        <span className="text-[11px] font-semibold text-neutral-900 dark:text-neutral-100">
          {EFFORT_LABELS[selected]}
        </span>
      </div>

      {/* Interactive band — generous hit area around the thin track. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Reasoning effort"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={index}
        aria-valuetext={EFFORT_LABELS[selected]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="relative mt-3 flex h-5 cursor-pointer touch-none select-none items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 dark:focus-visible:ring-white/20"
      >
        <div ref={trackRef} className="relative h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
          {/* filled portion */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-neutral-900 dark:bg-white"
            style={{ width: `${pct}%` }}
          />
          {/* stop ticks */}
          {levels.map((lvl, i) => {
            const at = max === 0 ? 0 : (i / max) * 100;
            const passed = i <= index;
            return (
              <span
                key={lvl}
                aria-hidden
                className={cn(
                  "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  passed
                    ? "bg-white/70 dark:bg-neutral-900/70"
                    : "bg-neutral-400/70 dark:bg-neutral-600",
                )}
                style={{ left: `${at}%` }}
              />
            );
          })}
          {/* knob */}
          <span
            className={cn(
              "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform",
              "bg-white ring-2 ring-neutral-900 shadow-[0_2px_6px_rgba(0,0,0,0.35)]",
              "dark:bg-neutral-900 dark:ring-white dark:shadow-[0_2px_6px_rgba(0,0,0,0.6)]",
              dragging && "scale-110",
            )}
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>

      {/* clickable stop labels */}
      <div className="mt-2 flex justify-between px-0.5">
        {levels.map((lvl) => {
          const active = lvl === selected;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => onChange(lvl)}
              className={cn(
                "text-[10px] font-medium transition-colors",
                active
                  ? "text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300",
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
