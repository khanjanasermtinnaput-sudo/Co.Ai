"use client";

// ── Architecture Diagram Panel (Phase 45) ────────────────────────────────────
// Generates Mermaid flowchart from import analysis, renders interactively.

import { useState, useMemo, useEffect, useRef } from "react";
import { Network, RefreshCw, Download, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { buildArchitectureDiagram } from "@/lib/cocode/architecture-diagram";
import { PanelHeader } from "@/components/cocode/panel-header";

const KIND_LEGEND = [
  { kind: "component", color: "#3b82f6", label: "Component" },
  { kind: "page", color: "#f97316", label: "Page" },
  { kind: "lib", color: "#8b5cf6", label: "Lib/Util" },
  { kind: "api", color: "#10b981", label: "API Route" },
  { kind: "store", color: "#ec4899", label: "Store" },
  { kind: "external", color: "#475569", label: "External" },
];

export function ArchitecturePanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);
  const diagram = useMemo(() => buildArchitectureDiagram(allFiles), [allFiles]);

  const [view, setView] = useState<"diagram" | "mermaid">("diagram");
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);

  const { nodes, edges } = diagram;

  // Simple SVG force-layout approximation
  const nodePositions = useMemo(() => {
    if (nodes.length === 0) return new Map<string, { x: number; y: number }>();
    const positions = new Map<string, { x: number; y: number }>();
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const W = 140;
    const H = 80;
    nodes.forEach((n, i) => {
      positions.set(n.id, { x: (i % cols) * W + 80, y: Math.floor(i / cols) * H + 60 });
    });
    return positions;
  }, [nodes]);

  const kindColor: Record<string, string> = {
    component: "#3b82f6", page: "#f97316", lib: "#8b5cf6",
    api: "#10b981", store: "#ec4899", external: "#475569", config: "#64748b",
  };

  const svgWidth = Math.max(600, (Math.ceil(Math.sqrt(nodes.length)) * 140) + 160);
  const svgHeight = Math.max(300, (Math.ceil(nodes.length / Math.ceil(Math.sqrt(nodes.length))) * 80) + 120);

  async function copyMermaid() {
    await navigator.clipboard.writeText(diagram.mermaid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadSVG() {
    const svgEl = svgRef.current?.querySelector("svg");
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "architecture.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={Network} title="Architecture Diagram">
        <span className="text-[11px] text-muted-foreground/50">{nodes.length} nodes · {edges.length} edges</span>
      </PanelHeader>

      {/* Controls */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex rounded-lg border border-border/40 overflow-hidden">
          <button type="button" onClick={() => setView("diagram")}
            className={cn("px-3 py-1 text-[11px] font-medium transition-colors", view === "diagram" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
            Diagram
          </button>
          <button type="button" onClick={() => setView("mermaid")}
            className={cn("px-3 py-1 text-[11px] font-medium transition-colors", view === "mermaid" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
            Mermaid
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {view === "diagram" && (
            <>
              <button type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
                <ZoomOut className="size-3.5" />
              </button>
              <span className="text-[11px] text-muted-foreground/60 w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
                <ZoomIn className="size-3.5" />
              </button>
              <button type="button" onClick={downloadSVG} className="rounded p-1.5 text-muted-foreground hover:text-foreground" title="Download SVG">
                <Download className="size-3.5" />
              </button>
            </>
          )}
          {view === "mermaid" && (
            <Button size="sm" variant="ghost" onClick={() => void copyMermaid()}>
              {copied ? "Copied!" : "Copy"}
            </Button>
          )}
        </div>
      </div>

      {nodes.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground/50">
          <div>
            <Network className="size-10 mx-auto mb-3 opacity-20" />
            <p>No source files found.</p>
            <p className="mt-1">Add TypeScript/JavaScript files to see the architecture diagram.</p>
          </div>
        </div>
      )}

      {view === "diagram" && nodes.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <div ref={svgRef}>
              <svg width={svgWidth} height={svgHeight} xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="rgba(148,163,184,0.4)" />
                  </marker>
                </defs>
                {/* Edges */}
                {edges.map((e, i) => {
                  const from = nodePositions.get(e.from);
                  const to = nodePositions.get(e.to);
                  if (!from || !to) return null;
                  return (
                    <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke="rgba(148,163,184,0.2)" strokeWidth="1" markerEnd="url(#arrow)" />
                  );
                })}
                {/* Nodes */}
                {nodes.map((n) => {
                  const pos = nodePositions.get(n.id);
                  if (!pos) return null;
                  const color = kindColor[n.kind] ?? "#475569";
                  return (
                    <g key={n.id} transform={`translate(${pos.x - 50},${pos.y - 18})`}>
                      <rect width="100" height="36" rx="6" fill={`${color}22`} stroke={color} strokeWidth="1.5" />
                      <text x="50" y="13" textAnchor="middle" fontSize="10" fontFamily="monospace" fill={color} fontWeight="600">
                        {n.kind[0].toUpperCase()}
                      </text>
                      <text x="50" y="27" textAnchor="middle" fontSize="9" fontFamily="sans-serif" fill="rgba(226,232,240,0.8)">
                        {n.label.slice(0, 14)}{n.label.length > 14 ? "…" : ""}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 p-3">
            {KIND_LEGEND.map((l) => (
              <div key={l.kind} className="flex items-center gap-1.5 text-[11px]">
                <div className="size-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
                <span className="text-muted-foreground/60">{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "mermaid" && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <pre className="font-mono text-[12px] text-slate-300 whitespace-pre-wrap">
            {diagram.mermaid}
          </pre>
        </div>
      )}
    </div>
  );
}
