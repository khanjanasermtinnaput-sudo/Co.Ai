// ── DOM ↔ Source Mapping Engine (Phase 22) ────────────────────────────────────
// Maintains a registry from rendered DOM elements back to their React component,
// source file, line number, parent/child hierarchy, props, and styles.
// Updated after every virtual FS write (simulates hot-reload awareness).

export interface ComponentMeta {
  /** Unique stable id — e.g. "Button@src/components/ui/button.tsx:12" */
  id: string;
  name: string;
  kind: "component" | "hook" | "function" | "class" | "native";
  path: string;
  line: number;
  column: number;
  parentId: string | null;
  childIds: string[];
  props: Record<string, string>;
  styles: string[];
  cssFile: string | null;
  gitHistory: string[];
  owner: string | null;
  /** Selector used to locate DOM element in preview iframe (if known) */
  selector: string | null;
}

export interface DOMSourceMap {
  components: ComponentMeta[];
  /** Map from selector → component id */
  selectorIndex: Map<string, string>;
  /** Map from path → component ids */
  fileIndex: Map<string, string[]>;
  builtAt: number;
}

// ── Regex patterns ─────────────────────────────────────────────────────────────

const COMPONENT_DEF = /(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)\s*[({=<]/g;
const HOOK_DEF = /(?:function|const)\s+(use[A-Z][A-Za-z0-9_]*)\s*[({=]/g;
const PROP_EXTRACT = /([a-zA-Z][a-zA-Z0-9_]*)(?:\s*:\s*[^,;\n]+)?/g;
const CSS_MODULE = /import\s+(?:\w+\s+from\s+)?['"]([^'"]+\.(?:css|scss|module\.css|module\.scss))['"]/g;
const TAILWIND_CLASS = /className=['"`]([^'"`]+)['"`]/g;

// ── Builder ────────────────────────────────────────────────────────────────────

export function buildDOMSourceMap(
  files: Array<{ path: string; content: string }>,
): DOMSourceMap {
  const components: ComponentMeta[] = [];
  const selectorIndex = new Map<string, string>();
  const fileIndex = new Map<string, string[]>();

  for (const { path, content } of files) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    if (path.includes("node_modules") || path.includes(".next")) continue;

    const lines = content.split("\n");
    const ids: string[] = [];

    // Find component definitions
    let match: RegExpExecArray | null;
    const patterns: Array<[RegExp, ComponentMeta["kind"]]> = [
      [COMPONENT_DEF, "component"],
      [HOOK_DEF, "hook"],
    ];

    for (const [pattern, kind] of patterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        const charIdx = match.index;
        const line = content.slice(0, charIdx).split("\n").length;
        const col = charIdx - content.lastIndexOf("\n", charIdx - 1) - 1;

        // Extract props from the nearby function signature
        const sigStart = charIdx;
        const sigEnd = Math.min(charIdx + 300, content.length);
        const sig = content.slice(sigStart, sigEnd);
        const props: Record<string, string> = {};
        let propMatch: RegExpExecArray | null;
        const propRegion = sig.match(/\(\s*\{([^}]*)\}/);
        if (propRegion) {
          PROP_EXTRACT.lastIndex = 0;
          while ((propMatch = PROP_EXTRACT.exec(propRegion[1])) !== null) {
            const pname = propMatch[1].trim();
            if (pname && pname !== "children") props[pname] = "unknown";
          }
        }

        // Extract CSS imports near this file
        const cssFiles: string[] = [];
        CSS_MODULE.lastIndex = 0;
        let cssMatch: RegExpExecArray | null;
        while ((cssMatch = CSS_MODULE.exec(content)) !== null) {
          cssFiles.push(cssMatch[1]);
        }

        // Extract Tailwind classes from the component body
        const bodyEnd = Math.min(charIdx + 800, content.length);
        const body = content.slice(charIdx, bodyEnd);
        const styles: string[] = [];
        TAILWIND_CLASS.lastIndex = 0;
        let twMatch: RegExpExecArray | null;
        while ((twMatch = TAILWIND_CLASS.exec(body)) !== null) {
          styles.push(...twMatch[1].split(/\s+/).slice(0, 8));
        }

        const id = `${name}@${path}:${line}`;
        const selector = kind === "component" ? `[data-cocode="${name}"]` : null;

        const meta: ComponentMeta = {
          id,
          name,
          kind,
          path,
          line,
          column: col,
          parentId: null,
          childIds: [],
          props,
          styles: [...new Set(styles)].slice(0, 20),
          cssFile: cssFiles[0] ?? null,
          gitHistory: [],
          owner: null,
          selector,
        };

        components.push(meta);
        ids.push(id);
        if (selector) selectorIndex.set(selector, id);
      }
    }

    fileIndex.set(path, ids);
  }

  // Build parent-child from import analysis
  const nameToId = new Map(components.map((c) => [c.name, c.id]));
  for (const { path, content } of files) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    const ids = fileIndex.get(path) ?? [];
    const JSX_TAG = /<([A-Z][A-Za-z0-9_]*)[\s/>]/g;
    let m: RegExpExecArray | null;
    JSX_TAG.lastIndex = 0;
    while ((m = JSX_TAG.exec(content)) !== null) {
      const childName = m[1];
      const childId = nameToId.get(childName);
      if (!childId) continue;
      for (const parentId of ids) {
        const parent = components.find((c) => c.id === parentId);
        if (!parent) continue;
        if (!parent.childIds.includes(childId)) parent.childIds.push(childId);
        const child = components.find((c) => c.id === childId);
        if (child && child.parentId === null) child.parentId = parentId;
      }
    }
  }

  return { components, selectorIndex, fileIndex, builtAt: Date.now() };
}

// ── Lookup helpers ─────────────────────────────────────────────────────────────

export function findComponentByName(map: DOMSourceMap, name: string): ComponentMeta | undefined {
  return map.components.find((c) => c.name === name);
}

export function findComponentsByFile(map: DOMSourceMap, path: string): ComponentMeta[] {
  const ids = map.fileIndex.get(path) ?? [];
  return map.components.filter((c) => ids.includes(c.id));
}

export function getComponentContext(map: DOMSourceMap, id: string): {
  component: ComponentMeta;
  parent: ComponentMeta | null;
  children: ComponentMeta[];
} | null {
  const component = map.components.find((c) => c.id === id);
  if (!component) return null;
  return {
    component,
    parent: component.parentId ? (map.components.find((c) => c.id === component.parentId) ?? null) : null,
    children: component.childIds.map((cid) => map.components.find((c) => c.id === cid)).filter(Boolean) as ComponentMeta[],
  };
}
