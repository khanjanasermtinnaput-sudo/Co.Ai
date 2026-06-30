// ── Architecture Diagram (Phase 45) ──────────────────────────────────────────
// Generates Mermaid flowchart and component diagrams from import analysis.
// Groups files by directory, detects external deps, renders relationships.

export interface DiagramNode {
  id: string;
  label: string;
  group: string;
  kind: "component" | "lib" | "api" | "page" | "store" | "external" | "config";
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ArchitectureDiagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  mermaid: string;
}

const EXT_RE = /\.(tsx?|jsx?|mjs|cjs)$/;
const IMPORT_RE = /(?:import|require)\s*(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)?\s*(?:from\s+)?['"]([^'"]+)['"]/g;

function nodeKind(path: string): DiagramNode["kind"] {
  if (path.includes("/components/")) return "component";
  if (path.includes("/lib/") || path.includes("/utils/")) return "lib";
  if (path.includes("/api/") || path.includes("route")) return "api";
  if (path.includes("/app/") || path.includes("/pages/")) return "page";
  if (path.includes("/store") || path.includes("zustand") || path.includes("redux")) return "store";
  if (path.startsWith("next") || path.startsWith("react") || path.startsWith("@")) return "external";
  return "lib";
}

function fileGroup(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 3) return parts.slice(0, -1).join("/");
  if (parts.length === 2) return parts[0];
  return "root";
}

function safeId(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
}

export function buildArchitectureDiagram(
  files: Array<{ path: string; content: string }>,
): ArchitectureDiagram {
  const sourceFiles = files.filter((f) => EXT_RE.test(f.path));
  const pathSet = new Set(sourceFiles.map((f) => f.path));

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const externalDeps = new Set<string>();

  for (const { path, content } of sourceFiles) {
    const id = safeId(path);
    if (!nodeIds.has(id)) {
      nodes.push({ id, label: path.split("/").pop() ?? path, group: fileGroup(path), kind: nodeKind(path) });
      nodeIds.add(id);
    }

    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(content)) !== null) {
      const imp = m[1];
      if (!imp) continue;

      if (imp.startsWith(".")) {
        // Resolve relative import
        const base = path.split("/").slice(0, -1).join("/");
        const resolved = `${base}/${imp}`.replace(/\/\.\//g, "/").replace(/[^/]+\/\.\.\//g, "");
        // Find actual file
        const actual = sourceFiles.find((f) =>
          f.path === resolved || f.path === `${resolved}.ts` || f.path === `${resolved}.tsx` ||
          f.path === `${resolved}/index.ts` || f.path === `${resolved}/index.tsx`
        );
        if (actual) {
          const toId = safeId(actual.path);
          if (!nodeIds.has(toId)) {
            nodes.push({ id: toId, label: actual.path.split("/").pop() ?? actual.path, group: fileGroup(actual.path), kind: nodeKind(actual.path) });
            nodeIds.add(toId);
          }
          const edgeKey = `${id}→${toId}`;
          if (!edgeKeys.has(edgeKey)) {
            edges.push({ from: id, to: toId });
            edgeKeys.add(edgeKey);
          }
        }
      } else if (!imp.startsWith("node:")) {
        // External dep
        const pkg = imp.startsWith("@") ? imp.split("/").slice(0, 2).join("/") : imp.split("/")[0];
        if (pkg) externalDeps.add(pkg);
      }
    }
  }

  // Add top external deps as nodes (limit to 8)
  const topExternal = Array.from(externalDeps).slice(0, 8);
  for (const dep of topExternal) {
    const id = safeId(`ext_${dep}`);
    if (!nodeIds.has(id)) {
      nodes.push({ id, label: dep, group: "external", kind: "external" });
      nodeIds.add(id);
    }
  }

  const mermaid = generateMermaid(nodes, edges);
  return { nodes, edges, mermaid };
}

function generateMermaid(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const KIND_STYLE: Record<DiagramNode["kind"], string> = {
    component: "fill:#3b82f6,color:#fff",
    lib: "fill:#8b5cf6,color:#fff",
    api: "fill:#10b981,color:#fff",
    page: "fill:#f97316,color:#fff",
    store: "fill:#ec4899,color:#fff",
    external: "fill:#475569,color:#cbd5e1",
    config: "fill:#64748b,color:#fff",
  };

  const lines = ["flowchart LR"];

  // Group by directory using subgraphs
  const groups: Record<string, DiagramNode[]> = {};
  for (const n of nodes) {
    if (!groups[n.group]) groups[n.group] = [];
    groups[n.group].push(n);
  }

  for (const [group, groupNodes] of Object.entries(groups)) {
    if (group === "external") {
      for (const n of groupNodes) {
        lines.push(`  ${n.id}["${n.label}"]`);
      }
    } else {
      const sgId = safeId(`sg_${group}`);
      lines.push(`  subgraph ${sgId}["${group}"]`);
      for (const n of groupNodes) {
        lines.push(`    ${n.id}["${n.label}"]`);
      }
      lines.push("  end");
    }
  }

  // Edges
  for (const e of edges.slice(0, 60)) {
    lines.push(`  ${e.from} --> ${e.to}`);
  }

  // Styles
  const styleGroups: Partial<Record<DiagramNode["kind"], string[]>> = {};
  for (const n of nodes) {
    if (!styleGroups[n.kind]) styleGroups[n.kind] = [];
    styleGroups[n.kind]!.push(n.id);
  }
  for (const [kind, ids] of Object.entries(styleGroups)) {
    const style = KIND_STYLE[kind as DiagramNode["kind"]];
    if (style) lines.push(`  style ${ids[0]} ${style}`);
  }

  return lines.join("\n");
}
