"use client";

// ── Panel tab strip — the adaptive right-rail navigation ──────────────────────
// Primary tabs (file-context adaptive, from adaptive-panels.ts) + an overflow
// menu for the rest, grouped by the four Build/Understand/Verify/Ship
// workspaces. Pulled out of cocode-workspace.tsx; behavior unchanged.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PANEL_DEFS, PANEL_GROUP_ORDER, type PanelDef } from "@/lib/cocode/adaptive-panels";
import type { IDEPanel } from "@/store/cocode-ide-store";
import { SimpleTooltip } from "./ide-tooltip";

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
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  return (
    <div className="relative">
      <SimpleTooltip label="More panels" description="Show all available panels" side="bottom">
        <button
          ref={buttonRef}
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-caption font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          More <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </SimpleTooltip>
      {open && coords && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div
            style={{ top: coords.top, right: coords.right }}
            className="fixed z-[160] w-52 max-h-[70vh] overflow-y-auto rounded-xl border border-border/60 bg-card/98 py-1.5 shadow-2xl backdrop-blur-2xl"
          >
            {PANEL_GROUP_ORDER.map((group) => {
              const groupPanels = panels.filter((p) => p.group === group);
              if (groupPanels.length === 0) return null;
              return (
                <div key={group}>
                  <div className="px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted-foreground/40">
                    {group}
                  </div>
                  {groupPanels.map((p) => {
                    const Icon = p.icon;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { onSelect(p.id as IDEPanel); setOpen(false); }}
                        className={cn(
                          "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/5",
                          activePanel === p.id && "bg-primary/10",
                        )}
                      >
                        <Icon className={cn("size-3.5 mt-0.5 shrink-0", activePanel === p.id ? "text-primary" : "text-muted-foreground/70")} />
                        <span className="flex flex-col gap-0.5">
                          <span className={cn("text-label font-medium", activePanel === p.id ? "text-primary" : "text-foreground/80")}>{p.label}</span>
                          <span className="text-micro leading-tight text-muted-foreground/50">{p.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
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
