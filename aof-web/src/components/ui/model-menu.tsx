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
import { defaultEffortFor, effortLabel, effortLevelsFor, EFFORT_INTENT_LABELS, type EffortIntent } from "@/lib/effort";
import type { ChatModel, CodeMode, EffortLevel } from "@/lib/types";

// A committed solid surface (popover tokens, not the app's translucent glass)
// so the menu reads as one clear card rather than blending into whatever is
// behind it — matched bg/foreground pair per the repo's contrast rule.
export const MODEL_MENU_SURFACE = "w-[340px] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl";

export const MODEL_MENU_LABEL = "text-muted-foreground";
export const MODEL_MENU_SEPARATOR = "bg-border";

export const MODEL_MENU_ITEM = cn(
  "items-start gap-3 rounded-xl px-2 py-2.5",
  "focus:bg-foreground/[0.05] focus:text-foreground data-[highlighted]:bg-foreground/[0.05]",
);

export const MODEL_MENU_TITLE = "text-sm font-semibold text-foreground";
export const MODEL_MENU_DESC = "mt-0.5 block text-xs text-muted-foreground";
export const MODEL_MENU_BADGE = "rounded-full border border-border bg-muted px-1.5 py-px text-micro font-medium text-muted-foreground";
export const MODEL_MENU_CHECK = "mt-1 size-4 text-foreground";

/** Model tile that appears to float above the card — two offset sheets and a
 *  long soft shadow give the depth. Inverted foreground/background so it
 *  always contrasts the popover surface, in either theme. */
export function ModelIconTile({
  icon: Icon,
  locked = false,
}: {
  icon: LucideIcon;
  locked?: boolean;
}) {
  return (
    <span className="relative mt-0.5 shrink-0">
      <span aria-hidden className="absolute inset-x-[7px] -bottom-[7px] h-2.5 rounded-md bg-foreground/10" />
      <span aria-hidden className="absolute inset-x-1 -bottom-1 h-3 rounded-lg bg-foreground/20" />
      <span
        className={cn(
          "relative flex size-9 items-center justify-center rounded-[10px]",
          "bg-foreground text-background shadow-lg ring-1 ring-foreground/20",
          locked && "opacity-75",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      {locked && (
        <span className="absolute -bottom-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full bg-popover shadow-md ring-1 ring-border">
          <Lock className="size-2.5 text-accent-warm" strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}

/** Effort as intent chips (Fast/Balanced/Deep/Maximum), Auto included when
 *  offered. One-tap, no drag — the plain-language default surface; the raw
 *  numeric slider (EffortSlider below) stays for CoCode's build modes and,
 *  in Developer Mode, as an advanced fallback so no real level is stranded. */
export function IntentEffortChips({
  intents,
  value,
  onChange,
}: {
  intents: EffortIntent[];
  value: EffortIntent;
  onChange: (intent: EffortIntent) => void;
}) {
  if (intents.length === 0) return null;
  const selected = intents.includes(value) ? value : intents[0];
  return (
    <div className="px-2 pb-1.5 pt-2">
      <span className="px-0.5 text-xs font-semibold text-foreground">Effort</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {intents.map((intent) => {
          const active = intent === selected;
          return (
            <button
              key={intent}
              type="button"
              onClick={() => onChange(intent)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {EFFORT_INTENT_LABELS[intent]}
            </button>
          );
        })}
      </div>
    </div>
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
        <span className="text-xs font-semibold text-foreground">Effort</span>
        <span className="text-caption font-semibold text-foreground">
          {effortLabel(model, selected)}
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
        aria-valuetext={effortLabel(model, selected)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="relative mt-3 flex h-5 cursor-pointer touch-none select-none items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div ref={trackRef} className="relative h-1.5 w-full rounded-full bg-muted">
          {/* filled portion */}
          <div className="absolute inset-y-0 left-0 rounded-full bg-foreground" style={{ width: `${pct}%` }} />
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
                  passed ? "bg-background/70" : "bg-muted-foreground/40",
                )}
                style={{ left: `${at}%` }}
              />
            );
          })}
          {/* knob */}
          <span
            className={cn(
              "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background ring-2 ring-foreground shadow-md transition-transform",
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
                "text-micro font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground",
              )}
            >
              {effortLabel(model, lvl)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
