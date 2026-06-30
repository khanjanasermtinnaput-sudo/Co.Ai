// ── Repository Knowledge Graph (Phase 18) ────────────────────────────────────
// Build a continuously-updated dependency graph from the virtual file system.
// Nodes: files, components, hooks, functions, routes, APIs.
// Edges: imports, re-exports, call graph (static analysis via regex).

export type NodeKind =
  | "file" | "component" | "hook" | "function" | "class"
  | "route" | "api" | "util" | "type" | "store";

export interface KGNode {
  id: string;         // file path
  label: string;      // display name
  kind: NodeKind;
  path: string;
  exports: string[];  // named exports
  x?: number;         // layout position
  y?: number;
}

export interface KGEdge {
  id: string;
  source: string;     // node id
  target: string;     // node id
  kind: "import" | "re-export" | "dynamic-import";
}

export interface KnowledgeGraph {
  nodes: KGNode[];
  edges: KGEdge[];
  builtAt: number;
}

// ── Static analysis helpers ───────────────────────────────────────────────────

function detectKind(path: string, content: string): NodeKind {
  const name = path.split("/").pop() ?? "";
  if (path.includes("/api/") || path.includes("route.ts") || path.includes("route.tsx")) return "api";
  if (path.includes("/pages/")) return "route";
  if (path.includes("/app/") && (name === "page.tsx" || name === "page.ts")) return "route";
  if (/^use[A-Z]/.test(name.replace(/\.[^.]+$/, ""))) return "hook";
  if (path.includes("/store/") || path.includes("-store.")) return "store";
  if (path.includes("/types") || path.includes("/interfaces")) return "type";
  if (path.includes("/utils") || path.includes("/lib/")) return "util";
  if (/\.(tsx|jsx)$/.test(path) && /export\s+(default\s+)?function\s+[A-Z]/.test(content)) return "component";
  if (/class\s+[A-Z]/.test(content)) return "class";
  return "function";
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    /export\s+\{\s*([^}]+)\}/g,
    /export\s+type\s+(\w+)/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim());
      exports.push(...names.filter(Boolean));
    }
  }

  return [...new Set(exports)].slice(0, 20);
}

function extractImports(
  path: string,
  content: string,
): Array<{ from: string; kind: KGEdge["kind"] }> {
  const imports: Array<{ from: string; kind: KGEdge["kind"] }> = [];
  const dir = path.split("/").slice(0, -1).join("/");

  // Static imports
  const staticRe = /import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(content)) !== null) {
    const specifier = m[1];
    if (specifier.startsWith(".")) {
      // Resolve relative path
      const resolved = resolvePath(dir, specifier);
      imports.push({ from: resolved, kind: "import" });
    }
    // Skip node_modules imports
  }

  // Dynamic imports
  const dynamicRe = /import\(['"]([^'"]+)['"]\)/g;
  while ((m = dynamicRe.exec(content)) !== null) {
    const specifier = m[1];
    if (specifier.startsWith(".")) {
      imports.push({ from: resolvePath(dir, specifier), kind: "dynamic-import" });
    }
  }

  return imports;
}

function resolvePath(dir: string, relative: string): string {
  const parts = [...dir.split("/"), ...relative.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

// Normalise a resolved path to a known file path (add extension if missing)
function normalisePath(path: string, knownPaths: Set<string>): string {
  if (knownPaths.has(path)) return path;
  for (const ext of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
    if (knownPaths.has(path + ext)) return path + ext;
  }
  return path;
}

// ── Graph builder ─────────────────────────────────────────────────────────────

export function buildKnowledgeGraph(
  files: Array<{ path: string; content: string }>,
): KnowledgeGraph {
  const knownPaths = new Set(files.map((f) => f.path));
  const nodes: KGNode[] = [];
  const edges: KGEdge[] = [];
  const edgeSet = new Set<string>();

  for (const file of files) {
    const kind = detectKind(file.path, file.content);
    const label = file.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file.path;

    nodes.push({
      id: file.path,
      label,
      kind,
      path: file.path,
      exports: extractExports(file.content),
    });

    const imports = extractImports(file.path, file.content);
    for (const imp of imports) {
      const target = normalisePath(imp.from, knownPaths);
      if (!knownPaths.has(target) && !knownPaths.has(imp.from)) continue;
      const realTarget = knownPaths.has(target) ? target : imp.from;
      const edgeId = `${file.path}→${realTarget}`;
      if (!edgeSet.has(edgeId)) {
        edgeSet.add(edgeId);
        edges.push({ id: edgeId, source: file.path, target: realTarget, kind: imp.kind });
      }
    }
  }

  // Simple force-directed layout (circles by kind)
  const kindGroups: Record<NodeKind, KGNode[]> = {} as Record<NodeKind, KGNode[]>;
  for (const node of nodes) {
    if (!kindGroups[node.kind]) kindGroups[node.kind] = [];
    kindGroups[node.kind].push(node);
  }

  const kinds = Object.keys(kindGroups) as NodeKind[];
  kinds.forEach((kind, ki) => {
    const group = kindGroups[kind];
    const angleStep = (2 * Math.PI) / Math.max(group.length, 1);
    const radius = 150 + ki * 60;
    const baseAngle = (ki / kinds.length) * 2 * Math.PI;
    group.forEach((node, i) => {
      node.x = Math.cos(baseAngle + i * angleStep) * radius + 500;
      node.y = Math.sin(baseAngle + i * angleStep) * radius + 400;
    });
  });

  return { nodes, edges, builtAt: Date.now() };
}

// ── Semantic search over graph (Phase 3) ─────────────────────────────────────
// Simple BM25-style keyword search for relevant files given a query.

export function searchGraph(graph: KnowledgeGraph, query: string, topK = 10): KGNode[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = graph.nodes.map((node) => {
    let score = 0;
    const text = `${node.path} ${node.label} ${node.exports.join(" ")}`.toLowerCase();
    for (const term of terms) {
      if (text.includes(term)) score += 2;
      if (node.label.toLowerCase().includes(term)) score += 3;
    }
    return { node, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.node);
}

// Return direct dependencies and dependents of a node
export function getNodeContext(
  graph: KnowledgeGraph,
  nodeId: string,
): { deps: KGNode[]; dependents: KGNode[] } {
  const deps = graph.edges
    .filter((e) => e.source === nodeId)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is KGNode => !!n);

  const dependents = graph.edges
    .filter((e) => e.target === nodeId)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n): n is KGNode => !!n);

  return { deps, dependents };
}
