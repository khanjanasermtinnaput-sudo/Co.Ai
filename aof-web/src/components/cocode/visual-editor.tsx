"use client";

// ── Visual Editing Engine (Phase 21) + DOM↔Source Mapping (Phase 22) ──────────
// Hover any element in the preview → highlight → show component info → click →
// auto-open source file in editor → generate diff for edits.

import { useState, useEffect, useRef, useCallback } from "react";
import { MousePointer2, Code2, FileCode, GitBranch, Layers, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { ComponentMeta } from "@/lib/cocode/dom-source-map";

// ── Overlay that wraps the preview iframe ─────────────────────────────────────

interface HoverInfo {
  x: number;
  y: number;
  name: string;
  kind: string;
  path: string;
  line: number;
  props: Record<string, string>;
  styles: string[];
  parent: string | null;
  children: string[];
}

export function VisualEditor({ iframeRef }: { iframeRef: React.RefObject<HTMLIFrameElement> }) {
  const domMap = useCocodeIDEStore((s) => s.domMap);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selected, setSelected] = useState<ComponentMeta | null>(null);
  const [active, setActive] = useState(false);

  // Listen for component hover messages from the injected relay script
  useEffect(() => {
    function handler(e: MessageEvent) {
      const d = e.data as {
        src?: string;
        type?: string;
        name?: string;
        x?: number;
        y?: number;
      } | null;
      if (!d || d.src !== "ccp-ve") return;

      if (d.type === "hover" && d.name && domMap) {
        const comp = domMap.components.find((c) => c.name === d.name);
        if (comp) {
          setHover({
            x: d.x ?? 0,
            y: d.y ?? 0,
            name: comp.name,
            kind: comp.kind,
            path: comp.path,
            line: comp.line,
            props: comp.props,
            styles: comp.styles,
            parent: comp.parentId,
            children: comp.childIds,
          });
        }
      }
      if (d.type === "leave") setHover(null);
      if (d.type === "select" && d.name && domMap) {
        const comp = domMap.components.find((c) => c.name === d.name);
        if (comp) {
          setSelected(comp);
          // Auto-open source file
          openTab(comp.path);
        }
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [domMap, openTab]);

  if (!domMap) return null;

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setActive((a) => !a)}
        title={active ? "Exit visual editor" : "Visual edit mode"}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          active
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <MousePointer2 className="size-4" />
      </button>

      {/* Hover tooltip */}
      {active && hover && (
        <div
          className="pointer-events-none fixed z-[200] rounded-xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur-xl"
          style={{ left: hover.x + 16, top: hover.y - 8, maxWidth: 320 }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <div className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              hover.kind === "component" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400",
            )}>
              {hover.kind}
            </div>
            <span className="text-sm font-semibold">{hover.name}</span>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <FileCode className="size-3" />
            <span className="truncate">{hover.path}</span>
            <span>:{hover.line}</span>
          </div>

          {hover.parent && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Layers className="size-3" />
              Parent: <span className="text-foreground/70">{hover.parent.split("@")[0]}</span>
            </div>
          )}

          {Object.keys(hover.props).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.keys(hover.props).slice(0, 6).map((p) => (
                <span key={p} className="rounded bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {p}
                </span>
              ))}
            </div>
          )}

          <p className="mt-2 text-[10px] text-primary/70">Click to open source</p>
        </div>
      )}

      {/* Selected component panel */}
      {active && selected && (
        <ComponentDetailPanel
          component={selected}
          allComponents={domMap.components}
          onClose={() => setSelected(null)}
          onOpenFile={(path) => openTab(path)}
        />
      )}
    </>
  );
}

// ── Component Detail Panel ────────────────────────────────────────────────────

function ComponentDetailPanel({
  component,
  allComponents,
  onClose,
  onOpenFile,
}: {
  component: ComponentMeta;
  allComponents: ComponentMeta[];
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const parent = component.parentId
    ? allComponents.find((c) => c.id === component.parentId)
    : null;
  const children = component.childIds
    .map((id) => allComponents.find((c) => c.id === id))
    .filter(Boolean) as ComponentMeta[];

  return (
    <div className="absolute right-4 top-12 z-[150] w-80 rounded-2xl border border-border/80 bg-card/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-primary" />
          <span className="font-semibold">{component.name}</span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{component.kind}</span>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3 p-4 text-[12px]">
        {/* Source */}
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Source</p>
          <button
            type="button"
            onClick={() => onOpenFile(component.path)}
            className="flex items-center gap-1.5 text-primary/80 hover:text-primary"
          >
            <FileCode className="size-3" />
            <span className="truncate">{component.path}</span>
            <ChevronRight className="size-3 shrink-0" />
            <span>:{component.line}</span>
          </button>
        </div>

        {/* Props */}
        {Object.keys(component.props).length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Props</p>
            <div className="flex flex-wrap gap-1">
              {Object.keys(component.props).map((p) => (
                <span key={p} className="rounded border border-border/50 bg-secondary/30 px-1.5 py-0.5 text-muted-foreground">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Styles */}
        {component.styles.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Styles</p>
            <div className="flex flex-wrap gap-1">
              {component.styles.slice(0, 8).map((s) => (
                <span key={s} className="rounded bg-slate-800/50 px-1 py-0.5 font-mono text-[10px] text-slate-400">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Hierarchy */}
        {(parent || children.length > 0) && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Hierarchy</p>
            {parent && (
              <div className="flex items-center gap-1 text-muted-foreground/70">
                <Layers className="size-3" />
                Parent: <span className="text-foreground/80">{parent.name}</span>
              </div>
            )}
            {children.length > 0 && (
              <div className="mt-1 flex items-center gap-1 text-muted-foreground/70">
                <ChevronRight className="size-3" />
                Children: {children.map((c) => c.name).join(", ")}
              </div>
            )}
          </div>
        )}

        {/* CSS */}
        {component.cssFile && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">CSS</p>
            <button
              type="button"
              onClick={() => onOpenFile(component.cssFile!)}
              className="flex items-center gap-1.5 text-primary/80 hover:text-primary"
            >
              <GitBranch className="size-3" />
              {component.cssFile}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
