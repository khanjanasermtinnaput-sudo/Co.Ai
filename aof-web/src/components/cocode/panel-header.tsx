"use client";

// ── Shared CoCode panel header ────────────────────────────────────────────────
// Every top-level cocode/*-panel.tsx used to hand-copy this exact header shell
// (icon + title inside `flex items-center gap-2 border-b border-border/70 px-4
// py-2.5`). This component is the single source of truth for that chrome so
// panels only own their own icon/title/badges/actions, not the surrounding
// classes. `children` is a raw passthrough for whatever a panel renders after
// the title — badges, counts, search boxes, action-button rows — so migrating
// a panel onto this component is a pure extraction with zero visual change.

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PanelHeaderProps {
  /** Icon rendered at the start of the header. */
  icon: LucideIcon;
  /** Panel title text. */
  title: string;
  /** Optional one-line description rendered under the title. Most panels don't use this. */
  description?: string;
  /** Extra content rendered after the title — badges, counts, search boxes, action buttons, etc. */
  children?: ReactNode;
  /** Extra classes for the header row itself (e.g. a panel that needs `flex-wrap` or a wider `gap`). */
  className?: string;
}

export function PanelHeader({ icon: Icon, title, description, children, className }: PanelHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2 border-b border-border/70 px-4 py-2.5", className)}>
      <Icon className="size-4 text-muted-foreground" />
      {description ? (
        <div className="min-w-0">
          <span className="text-sm font-medium">{title}</span>
          <p className="truncate text-[11px] text-muted-foreground/60">{description}</p>
        </div>
      ) : (
        <span className="text-sm font-medium">{title}</span>
      )}
      {children}
    </div>
  );
}
