"use client";

// ── Collapsed right rail — icon strip shown when no panel is open ────────────
// Same primary-panel list as the tab strip, but grouped by the four
// Build/Understand/Verify/Ship workspaces (a thin divider between groups)
// instead of raw file-context order, so the rail reads as organized even at
// icon-only size.

import { PANEL_GROUP_ORDER, type PanelDef } from "@/lib/cocode/adaptive-panels";
import type { IDEPanel } from "@/store/cocode-ide-store";
import { SimpleTooltip } from "./ide-tooltip";

const MAX_ICONS = 12;

export function CollapsedRail({
  primaryPanels,
  onSelect,
}: {
  primaryPanels: PanelDef[];
  onSelect: (id: IDEPanel) => void;
}) {
  const capped = primaryPanels.slice(0, MAX_ICONS);
  const grouped = PANEL_GROUP_ORDER.map((group) => capped.filter((p) => p.group === group)).filter(
    (g) => g.length > 0,
  );

  return (
    <div className="flex w-10 flex-col items-center gap-0.5 border-l border-border/60 bg-sidebar/40 py-2">
      {grouped.map((group, i) => (
        <div key={group[0].group} className={i > 0 ? "mt-1 border-t border-border/40 pt-1" : undefined}>
          {group.map((p) => {
            const Icon = p.icon;
            return (
              <SimpleTooltip key={p.id} label={p.label} description={p.description} side="left" delay={300}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id as IDEPanel)}
                  aria-label={p.label}
                  className="flex w-8 items-center justify-center rounded-md py-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <Icon className="size-4" />
                </button>
              </SimpleTooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
}
