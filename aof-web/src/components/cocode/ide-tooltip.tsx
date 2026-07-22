"use client";

import { type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ExternalLink, AlertTriangle, Gauge, GitBranch } from "lucide-react";

export interface TooltipMeta {
  name: string;
  description?: string;
  shortcut?: string;
  status?: "ready" | "active" | "warning" | "error" | "disabled" | "deprecated";
  source?: string;
  refs?: number;
  lastModified?: string;
  docUrl?: string;
  suggestion?: string;
  // Part 2 — Function Intelligence
  signature?: string;
  returnType?: string;
  params?: { name: string; type: string; optional?: boolean }[];
  securityWarning?: string;
  performanceNote?: string;
  isDeprecated?: boolean;
  callHierarchy?: string[];
}

const STATUS_COLORS: Record<string, string> = {
  ready:      "text-success",
  active:     "text-info",
  warning:    "text-warning",
  error:      "text-destructive",
  disabled:   "text-muted-foreground",
  deprecated: "text-muted-foreground/50",
};

interface IDETooltipProps {
  meta: TooltipMeta;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  className?: string;
}

export function IDETooltip({
  meta,
  children,
  side = "bottom",
  delay = 600,
  className,
}: IDETooltipProps) {
  return (
    <TooltipProvider delayDuration={delay}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={8}
          className={cn(
            "z-[200] max-w-[260px] overflow-hidden rounded-xl border border-border/60 bg-card/95 p-0 text-xs shadow-2xl backdrop-blur-xl",
            className,
          )}
        >
          {/* Header */}
          <div className="border-b border-border/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{meta.name}</span>
              {meta.status && (
                <span className={cn("text-micro font-medium uppercase tracking-wide", STATUS_COLORS[meta.status] ?? "text-muted-foreground")}>
                  {meta.status}
                </span>
              )}
            </div>
            {meta.description && (
              <p className="mt-0.5 text-caption leading-relaxed text-muted-foreground">
                {meta.description}
              </p>
            )}
          </div>

          {/* Function signature (Part 2) */}
          {meta.signature && (
            <div className="border-b border-border/30 px-3 py-2">
              <p className="font-mono text-micro text-primary/80 break-all">{meta.signature}</p>
            </div>
          )}

          {/* Params (Part 2) */}
          {meta.params && meta.params.length > 0 && (
            <div className="border-b border-border/30 px-3 py-2 space-y-0.5">
              <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1">Parameters</p>
              {meta.params.map((p) => (
                <div key={p.name} className="flex items-center gap-1.5 text-micro">
                  <span className="font-mono text-info">{p.name}{p.optional ? "?" : ""}</span>
                  <span className="text-muted-foreground/40">:</span>
                  <span className="font-mono text-success/80">{p.type}</span>
                </div>
              ))}
            </div>
          )}

          {/* Return type (Part 2) */}
          {meta.returnType && (
            <div className="border-b border-border/30 flex items-center justify-between px-3 py-1.5">
              <span className="text-micro text-muted-foreground">Returns</span>
              <span className="font-mono text-micro text-success">{meta.returnType}</span>
            </div>
          )}

          {/* Call hierarchy (Part 2) */}
          {meta.callHierarchy && meta.callHierarchy.length > 0 && (
            <div className="border-b border-border/30 px-3 py-2">
              <p className="text-micro font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1">Called by</p>
              {meta.callHierarchy.slice(0, 3).map((fn) => (
                <div key={fn} className="flex items-center gap-1 text-micro text-muted-foreground/70">
                  <GitBranch className="size-2.5 shrink-0" />
                  <span className="font-mono truncate">{fn}</span>
                </div>
              ))}
            </div>
          )}

          {/* Detail rows */}
          <div className="divide-y divide-border/30">
            {meta.shortcut && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-micro text-muted-foreground">Shortcut</span>
                <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-micro text-foreground/80">
                  {meta.shortcut}
                </kbd>
              </div>
            )}
            {meta.source && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-micro text-muted-foreground">Source</span>
                <span className="max-w-[150px] truncate text-right font-mono text-micro text-info">
                  {meta.source}
                </span>
              </div>
            )}
            {meta.refs !== undefined && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-micro text-muted-foreground">References</span>
                <span className="text-micro text-foreground">{meta.refs} files</span>
              </div>
            )}
            {meta.lastModified && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-micro text-muted-foreground">Modified</span>
                <span className="text-micro text-foreground">{meta.lastModified}</span>
              </div>
            )}

            {/* Security Warning (Part 2) */}
            {meta.securityWarning && (
              <div className="px-3 py-2">
                <div className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />
                  <span className="text-micro leading-relaxed text-destructive/90">{meta.securityWarning}</span>
                </div>
              </div>
            )}

            {/* Performance Note (Part 2) */}
            {meta.performanceNote && (
              <div className="px-3 py-2">
                <div className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2">
                  <Gauge className="mt-0.5 size-3 shrink-0 text-warning" />
                  <span className="text-micro leading-relaxed text-warning/90">{meta.performanceNote}</span>
                </div>
              </div>
            )}

            {/* AI Suggestion (Part 2) */}
            {meta.suggestion && (
              <div className="px-3 py-2">
                <div className="flex items-start gap-1.5 rounded-lg bg-primary/10 px-2.5 py-2">
                  <span className="text-primary text-sm">💡</span>
                  <span className="text-micro leading-relaxed text-primary/90">{meta.suggestion}</span>
                </div>
              </div>
            )}

            {meta.docUrl && (
              <div className="px-3 py-1.5">
                <a
                  href={meta.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-micro text-primary hover:underline"
                >
                  <ExternalLink className="size-2.5" />
                  Documentation
                </a>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Lightweight one-liner tooltip for simple cases */
export function SimpleTooltip({
  label,
  shortcut,
  description,
  children,
  side = "bottom",
  delay = 500,
}: {
  label: string;
  shortcut?: string;
  description?: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}) {
  return (
    <IDETooltip
      meta={{ name: label, shortcut, description }}
      side={side}
      delay={delay}
    >
      {children}
    </IDETooltip>
  );
}
