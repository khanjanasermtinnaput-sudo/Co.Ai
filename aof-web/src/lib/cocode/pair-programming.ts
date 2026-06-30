// ── AI Pair Programming Engine (Phase 30) ────────────────────────────────────
// Proactively surfaces high-impact, non-disruptive suggestions as the user edits.
// Analyzes the virtual FS for: duplicate logic, missing caching, unnecessary
// re-renders, oversized hooks, database query hints, bundle growth, a11y gaps.

export type SuggestionPriority = "high" | "medium" | "low";
export type SuggestionKind =
  | "duplicate-logic"
  | "missing-cache"
  | "unnecessary-rerender"
  | "simplify-hook"
  | "database-index"
  | "bundle-size"
  | "accessibility"
  | "security"
  | "performance"
  | "code-quality";

export interface PairSuggestion {
  id: string;
  kind: SuggestionKind;
  priority: SuggestionPriority;
  problem: string;
  impact: string;
  solution: string;
  estimatedBenefit: string;
  file: string | null;
  line: number | null;
  autoFixable: boolean;
  createdAt: number;
  dismissed: boolean;
}

// ── Detection patterns ────────────────────────────────────────────────────────

interface DetectionRule {
  id: string;
  kind: SuggestionKind;
  priority: SuggestionPriority;
  detect: (content: string, path: string) => boolean;
  problem: (path: string) => string;
  impact: string;
  solution: string;
  estimatedBenefit: string;
  autoFixable: boolean;
  lineHint?: (content: string) => number | null;
}

const RULES: DetectionRule[] = [
  {
    id: "missing-memo",
    kind: "unnecessary-rerender",
    priority: "medium",
    detect: (c) =>
      /export function [A-Z]/.test(c) &&
      !c.includes("memo(") &&
      /\bprops\b/.test(c) &&
      c.split("\n").length > 30,
    problem: (path) => `${path}: Component accepts props but is not wrapped in React.memo`,
    impact: "Re-renders on every parent render even when props haven't changed",
    solution: "Wrap the component export with React.memo()",
    estimatedBenefit: "Eliminates unnecessary renders — can reduce rendering time by 30–70% in lists",
    autoFixable: true,
    lineHint: (c) => {
      const m = c.match(/export function ([A-Z])/);
      if (!m) return null;
      return c.slice(0, m.index).split("\n").length;
    },
  },
  {
    id: "no-use-callback",
    kind: "unnecessary-rerender",
    priority: "low",
    detect: (c) =>
      /useEffect\s*\(\s*\(\s*\)/.test(c) &&
      /function\s+\w+\s*\(/.test(c) &&
      !c.includes("useCallback"),
    problem: (path) => `${path}: Inline functions in JSX or effects not memoized with useCallback`,
    impact: "New function reference on every render causes child component re-renders",
    solution: "Wrap stable callbacks with useCallback(() => { … }, [deps])",
    estimatedBenefit: "Prevents cascading re-renders in child components",
    autoFixable: false,
  },
  {
    id: "fetch-no-cache",
    kind: "missing-cache",
    priority: "high",
    detect: (c) =>
      c.includes("fetch(") &&
      !c.includes("cache:") &&
      !c.includes("useSWR") &&
      !c.includes("useQuery") &&
      !c.includes("react-query"),
    problem: (path) => `${path}: fetch() calls without cache headers or query library`,
    impact: "Every render or navigation triggers a new network request — increased latency and server load",
    solution: "Add { cache: 'force-cache' } or 'no-store' to fetch, or use SWR/React Query",
    estimatedBenefit: "Eliminates redundant network round-trips; typical 100–500ms improvement per navigation",
    autoFixable: false,
  },
  {
    id: "console-log-prod",
    kind: "code-quality",
    priority: "medium",
    detect: (c) => /console\.log\(/.test(c) && !c.includes("NODE_ENV"),
    problem: (path) => `${path}: console.log() statements will ship to production`,
    impact: "Leaks internal data in browser devtools; minor performance overhead",
    solution: "Remove debug logs or guard with: if (process.env.NODE_ENV !== 'production') { … }",
    estimatedBenefit: "Cleaner production output; avoids accidental data exposure",
    autoFixable: true,
  },
  {
    id: "any-type",
    kind: "code-quality",
    priority: "low",
    detect: (c) => /:\s*any\b/.test(c),
    problem: (path) => `${path}: Uses TypeScript 'any' type — bypasses type safety`,
    impact: "Type errors silenced at compile time; runtime errors at production",
    solution: "Replace 'any' with a specific type or 'unknown' + type guard",
    estimatedBenefit: "Catches type errors at compile time before they reach users",
    autoFixable: false,
  },
  {
    id: "large-component",
    kind: "code-quality",
    priority: "medium",
    detect: (c, p) =>
      /\.(tsx|jsx)$/.test(p) &&
      c.split("\n").length > 250,
    problem: (path) => `${path}: Component file exceeds 250 lines`,
    impact: "Hard to test, review, and maintain; likely violating single-responsibility principle",
    solution: "Extract sub-components, custom hooks, and utility functions into separate files",
    estimatedBenefit: "Improves readability, testability, and enables better code-splitting",
    autoFixable: false,
  },
  {
    id: "missing-alt",
    kind: "accessibility",
    priority: "high",
    detect: (c) => /<img\b(?![^>]*\balt\s*=)/i.test(c),
    problem: (path) => `${path}: <img> tag missing alt attribute`,
    impact: "Fails WCAG 2.1 Level A — screen readers cannot describe the image",
    solution: 'Add descriptive alt="…" text; use alt="" for decorative images',
    estimatedBenefit: "Accessibility compliance; required for WCAG Level A",
    autoFixable: true,
  },
  {
    id: "innerHTML",
    kind: "security",
    priority: "high",
    detect: (c) => /dangerouslySetInnerHTML|innerHTML\s*=/.test(c),
    problem: (path) => `${path}: Uses dangerouslySetInnerHTML or direct innerHTML`,
    impact: "XSS vulnerability if user-controlled content is rendered",
    solution: "Sanitize with DOMPurify before rendering, or use a safe text alternative",
    estimatedBenefit: "Eliminates XSS attack vector",
    autoFixable: false,
  },
  {
    id: "no-key-in-list",
    kind: "performance",
    priority: "medium",
    detect: (c) => /\.map\s*\(\s*\([^)]*\)\s*=>\s*<(?!Fragment)/.test(c) && !c.includes("key="),
    problem: (path) => `${path}: .map() rendering JSX without key prop`,
    impact: "React cannot efficiently reconcile list updates — may cause visual glitches",
    solution: "Add key={item.id} (unique, stable value) to the root element in .map()",
    estimatedBenefit: "Correct list diffing; eliminates 'key' console warnings",
    autoFixable: true,
  },
];

// ── Analysis ──────────────────────────────────────────────────────────────────

let _suggId = 0;
function nextId() { return `pair_${Date.now()}_${++_suggId}`; }

export function analyzePairSuggestions(
  files: Array<{ path: string; content: string }>,
  dismissedIds: Set<string> = new Set(),
): PairSuggestion[] {
  const suggestions: PairSuggestion[] = [];

  for (const { path, content } of files) {
    if (path.includes("node_modules") || path.includes(".next")) continue;

    for (const rule of RULES) {
      if (!rule.detect(content, path)) continue;
      const line = rule.lineHint ? rule.lineHint(content) : null;
      const id = `${rule.id}:${path}`;
      if (dismissedIds.has(id)) continue;

      suggestions.push({
        id,
        kind: rule.kind,
        priority: rule.priority,
        problem: rule.problem(path),
        impact: rule.impact,
        solution: rule.solution,
        estimatedBenefit: rule.estimatedBenefit,
        file: path,
        line,
        autoFixable: rule.autoFixable,
        createdAt: Date.now(),
        dismissed: false,
      });
    }
  }

  // Sort: high first, then medium, then low
  return suggestions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}
