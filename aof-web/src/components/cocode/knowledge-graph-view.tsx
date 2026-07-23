"use client";

// ── Knowledge Graph View (Phase 18) ──────────────────────────────────────────
// SVG-based interactive graph of repository dependencies.
// Nodes: files by kind. Edges: imports. Hover to see connections.
// Click to open file in editor.

import { useEffect, useRef, useState, useCallback, memo } from "react";
import { Network, RefreshCw, Search, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { KGNode, KGEdge } from "@/lib/cocode/knowledge-graph";
import { PanelHeader } from "@/components/cocode/panel-header";

const KIND_COLOR: Record<string, string> = {
  component: "#60a5fa",  // blue
  hook: "#a78bfa",       // purple
  function: "#34d399",   // emerald
  class: "#f59e0b",      // amber
  route: "#f97316",      // orange
  api: "#ef4444",        // red
  store: "#8b5cf6",      // violet
  type: "#6b7280",       // gray
  util: "#10b981",       // teal
  file: "#94a3b8",       // slate
};

function NodeCircle({
  node,
  highlighted,
  faded,
  onClick,
  onHover,
}: {
  node: KGNode;
  highlighted: boolean;
  faded: boolean;
  onClick: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const color = KIND_COLOR[node.kind] ?? "#94a3b8";
  return (
    <g
      transform={`translate(${node.x ?? 0},${node.y ?? 0})`}
      style={{ cursor: "pointer", opacity: faded ? 0.2 : 1 }}
      onClick={() => onClick(node.id)}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      <circle
        r={highlighted ? 8 : 6}
        fill={color}
        stroke={highlighted ? "#fff" : "transparent"}
        strokeWidth={1.5}
        style={{ transition: "r 0.15s, stroke 0.15s" }}
      />
      <text
        x={10}
        y={4}
        fontSize={9}
        fill={highlighted ? "#f1f5f9" : "#94a3b8"}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {node.label.slice(0, 20)}
      </text>
    </g>
  );
}

function EdgeLine({
  edge,
  nodes,
  highlighted,
  faded,
}: {
  edge: KGEdge;
  nodes: Map<string, KGNode>;
  highlighted: boolean;
  faded: boolean;
}) {
  const src = nodes.get(edge.source);
  const tgt = nodes.get(edge.target);
  if (!src || !tgt || src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) return null;

  return (
    <line
      x1={src.x}
      y1={src.y}
      x2={tgt.x}
      y2={tgt.y}
      stroke={highlighted ? "#60a5fa" : "#334155"}
      strokeWidth={highlighted ? 1.5 : 0.8}
      strokeOpacity={faded ? 0.1 : 1}
      style={{ transition: "stroke 0.15s, stroke-opacity 0.15s" }}
    />
  );
}

export function KnowledgeGraphView() {
  const graph = useCocodeIDEStore((s) => s.graph);
  const buildGraph = useCocodeIDEStore((s) => s.buildGraph);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const graphSearch = useCocodeIDEStore((s) => s.graphSearch);
  const allFiles = useCocodeIDEStore((s) => s.allFiles);

  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const isPanning = useRef(false);
  const lastPan = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!graph && allFiles().length > 0) buildGraph();
  }, [graph, allFiles, buildGraph]);

  const handleNodeClick = useCallback((id: string) => {
    openTab(id);
  }, [openTab]);

  const searchResults = query ? new Set(graphSearch(query).map((n) => n.id)) : null;

  // Pan
  const onMouseDown = (e: React.MouseEvent) => {
    isPanning.current = true;
    lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y });
  };
  const onMouseUp = () => { isPanning.current = false; };

  // Zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(3, z - e.deltaY * 0.001)));
  };

  if (!graph) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <Network className="size-10 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium">Knowledge Graph</p>
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            Visualizes file dependencies across your repository.
          </p>
        </div>
        <Button size="sm" onClick={buildGraph} disabled={!allFiles().length}>
          <RefreshCw className="size-3.5" /> Build Graph
        </Button>
        {!allFiles().length && (
          <p className="text-[11px] text-muted-foreground/40">Load a project first.</p>
        )}
      </div>
    );
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // Highlighted: hovered node + its edges
  const hoveredEdges = hovered
    ? new Set(
        graph.edges
          .filter((e) => e.source === hovered || e.target === hovered)
          .flatMap((e) => [e.source, e.target]),
      )
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Controls */}
      <PanelHeader icon={Network} title="Knowledge Graph">
        <div className="relative ml-2 flex-1 max-w-48">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            className="w-full rounded-md border border-border/50 bg-background/30 py-1 pl-6 pr-2 text-[12px] outline-none focus:border-primary/30"
          />
        </div>
        <span className="text-[11px] text-muted-foreground/60">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
        <Button size="icon-sm" variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
          <ZoomIn className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))}>
          <ZoomOut className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={buildGraph} title="Rebuild graph">
          <RefreshCw className="size-3.5" />
        </Button>
      </PanelHeader>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border/50 px-4 py-1.5">
        {Object.entries(KIND_COLOR).slice(0, 6).map(([kind, color]) => (
          <div key={kind} className="flex items-center gap-1">
            <div className="size-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[10px] text-muted-foreground/60 capitalize">{kind}</span>
          </div>
        ))}
      </div>

      {/* SVG canvas */}
      <div className="console-surface min-h-0 flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className="size-full"
          style={{ cursor: isPanning.current ? "grabbing" : "grab" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {graph.edges.map((edge) => {
              const isHighlighted = hovered !== null && (edge.source === hovered || edge.target === hovered);
              const isFaded = hovered !== null && !isHighlighted;
              const isSearchFiltered = searchResults !== null && !searchResults.has(edge.source) && !searchResults.has(edge.target);
              return (
                <EdgeLine
                  key={edge.id}
                  edge={edge}
                  nodes={nodeMap}
                  highlighted={isHighlighted}
                  faded={isFaded || isSearchFiltered}
                />
              );
            })}

            {/* Nodes */}
            {graph.nodes.map((node) => {
              const isHighlighted = hovered === node.id || (hoveredEdges?.has(node.id) ?? false);
              const isSearchFaded = searchResults !== null && !searchResults.has(node.id);
              const isHoverFaded = hovered !== null && !isHighlighted;
              return (
                <NodeCircle
                  key={node.id}
                  node={node}
                  highlighted={isHighlighted}
                  faded={isSearchFaded || isHoverFaded}
                  onClick={handleNodeClick}
                  onHover={setHovered}
                />
              );
            })}
          </g>
        </svg>
      </div>

      {/* Hover tooltip */}
      {hovered && nodeMap.get(hovered) && (() => {
        const n = nodeMap.get(hovered)!;
        const edges = graph.edges.filter((e) => e.source === hovered || e.target === hovered);
        return (
          <div className="border-t border-border/70 bg-card/60 px-4 py-2 text-[12px]">
            <span className="font-medium text-foreground">{n.label}</span>
            <span className="ml-2 capitalize text-muted-foreground/60">{n.kind}</span>
            <span className="ml-2 text-muted-foreground/40">{n.path}</span>
            <span className="ml-2 text-muted-foreground/60">{edges.length} connection{edges.length !== 1 ? "s" : ""}</span>
          </div>
        );
      })()}
    </div>
  );
}
