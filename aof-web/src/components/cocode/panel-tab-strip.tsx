"use client";

// ── Panel tab strip — the adaptive right-rail navigation ──────────────────────
// Primary tabs (file-context adaptive, from adaptive-panels.ts) + an overflow
// menu for the rest, grouped by the four Build/Understand/Verify/Ship
// workspaces. Pulled out of cocode-workspace.tsx; behavior unchanged.

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PANEL_DEFS, PANEL_GROUP_ORDER, type PanelDef } from "@/lib/cocode/adaptive-panels";
import type { IDEPanel } from "@/store/cocode-ide-store";
import { SimpleTooltip } from "./ide-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Uses the shared Radix-backed DropdownMenu (same overlay primitive as every
// other menu in the app) instead of a hand-rolled createPortal — gets
// Escape, focus management, and a consistent z-index/animation for free
// instead of duplicating that logic here.
function OverflowPanelMenu({
  panels,
  activePanel,
  onSelect,
}: {
  panels: PanelDef[];
  activePanel: IDEPanel | null;
  onSelect: (id: IDEPanel | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <SimpleTooltip label="More panels" description="Show all available panels" side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            More <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </button>
        </DropdownMenuTrigger>
      </SimpleTooltip>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-52 overflow-y-auto p-1">
        {PANEL_GROUP_ORDER.map((group) => {
          const groupPanels = panels.filter((p) => p.group === group);
          if (groupPanels.length === 0) return null;
          return (
            <div key={group}>
              <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-widest text-muted-foreground/40">
                {group}
              </DropdownMenuLabel>
              {groupPanels.map((p) => {
                const Icon = p.icon;
                return (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => onSelect(p.id as IDEPanel)}
                    className={cn("items-start gap-2", activePanel === p.id && "bg-primary/10")}
                  >
                    <Icon className={cn("mt-0.5 size-3.5 shrink-0", activePanel === p.id ? "text-primary" : "text-muted-foreground/70")} />
                    <span className="flex flex-col gap-0.5">
                      <span className={cn("text-label font-medium", activePanel === p.id ? "text-primary" : "text-foreground/80")}>
                        {p.label}
                      </span>
                      <span className="text-micro leading-tight text-muted-foreground/50">{p.description}</span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PanelTabStrip({
  primaryPanels,
  overflowPanels,
  activePanel,
  onSelect,
  onClose,
}: {
  primaryPanels: PanelDef[];
  overflowPanels: PanelDef[];
  activePanel: IDEPanel | null;
  onSelect: (id: IDEPanel | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-card/30 px-1 py-1 no-scrollbar">
      {primaryPanels.map((p) => {
        const def = PANEL_DEFS[p.id];
        if (!def) return null;
        const isActive = activePanel === p.id;
        const Icon = def.icon;
        return (
          <SimpleTooltip
            key={p.id}
            label={def.label}
            description={def.description}
            shortcut={def.shortcut}
            side="bottom"
            delay={500}
          >
            <button
              type="button"
              onClick={() => onSelect(isActive ? null : (p.id as IDEPanel))}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium whitespace-nowrap transition-colors",
                isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
              )}
            >
              <Icon className="size-3" />
              {p.label}
            </button>
          </SimpleTooltip>
        );
      })}

      {overflowPanels.length > 0 && (
        <OverflowPanelMenu panels={overflowPanels} activePanel={activePanel} onSelect={onSelect} />
      )}

      <button
        type="button"
        onClick={onClose}
        className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        aria-label="Close panel"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
