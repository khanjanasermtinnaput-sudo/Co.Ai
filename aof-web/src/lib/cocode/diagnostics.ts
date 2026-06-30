// ── Live Diagnostics Engine (Phase 28) ────────────────────────────────────────
// Monitors TypeScript errors, runtime errors, ESLint-style warnings,
// hydration errors, and other build/runtime issues.
// Each diagnostic has: severity, message, file, line, root cause, recommended fix.

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";
export type DiagnosticCategory =
  | "typescript"
  | "runtime"
  | "hydration"
  | "eslint"
  | "bundle"
  | "accessibility"
  | "performance"
  | "network"
  | "memory";

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  rootCause: string;
  impact: string;
  recommendedFix: string;
  /** If true, a diff can be generated to fix this */
  autoFixable: boolean;
  createdAt: number;
  /** Stack trace if this was a runtime error */
  stack?: string;
}

// ── Static analysis patterns ──────────────────────────────────────────────────

interface Pattern {
  regex: RegExp;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  rootCause: (m: RegExpMatchArray) => string;
  impact: string;
  fix: (m: RegExpMatchArray) => string;
  autoFixable: boolean;
}

const PATTERNS: Pattern[] = [
  {
    regex: /Property '(.+?)' does not exist on type/,
    severity: "error",
    category: "typescript",
    rootCause: (m) => `Type does not have property '${m[1]}'. May be using wrong type or missing interface field.`,
    impact: "Will fail to compile",
    fix: (m) => `Add '${m[1]}' to the interface or use optional chaining (?.)`,
    autoFixable: true,
  },
  {
    regex: /Cannot find module '(.+?)'/,
    severity: "error",
    category: "typescript",
    rootCause: (m) => `Module '${m[1]}' is not installed or path is incorrect.`,
    impact: "Import will fail at build time",
    fix: (m) => `Run: npm install ${m[1].replace(/^@types\//, "")} — or verify the import path`,
    autoFixable: false,
  },
  {
    regex: /is declared but its value is never read/,
    severity: "warning",
    category: "typescript",
    rootCause: () => "Variable or import is unused.",
    impact: "Increases bundle size unnecessarily",
    fix: () => "Remove the unused declaration or prefix with _ to suppress",
    autoFixable: true,
  },
  {
    regex: /Expected (.+?) arguments?, but got (.+?)\./,
    severity: "error",
    category: "typescript",
    rootCause: (m) => `Function called with ${m[2]} args but expects ${m[1]}.`,
    impact: "Runtime error or silent wrong behavior",
    fix: () => "Pass the correct number of arguments",
    autoFixable: false,
  },
  {
    regex: /Hydration failed because the initial UI does not match/i,
    severity: "error",
    category: "hydration",
    rootCause: () => "Server-rendered HTML differs from client-rendered HTML.",
    impact: "Page flickers or renders incorrectly on first load",
    fix: () => "Wrap the mismatching part in a <ClientOnly> component or use useEffect for client-only state",
    autoFixable: true,
  },
  {
    regex: /Warning: Each child in a list should have a unique "key" prop/i,
    severity: "warning",
    category: "runtime",
    rootCause: () => "React list items missing stable key prop.",
    impact: "React diff algorithm cannot correctly update list items; may cause visual glitches",
    fix: () => 'Add key={item.id} (or another unique identifier) to each list element',
    autoFixable: true,
  },
  {
    regex: /Warning: Can't perform a React state update on an unmounted component/i,
    severity: "warning",
    category: "runtime",
    rootCause: () => "setState called after component unmount — likely a missing useEffect cleanup.",
    impact: "Memory leak; may cause unexpected state mutations",
    fix: () => "Return a cleanup function from useEffect: return () => { cancelled = true; }",
    autoFixable: true,
  },
  {
    regex: /FATAL ERROR: (.*?) Allocation failed/i,
    severity: "error",
    category: "memory",
    rootCause: (m) => `Node.js ran out of heap memory: ${m[1]}`,
    impact: "Process crash",
    fix: () => "Increase Node memory: NODE_OPTIONS=--max-old-space-size=4096",
    autoFixable: false,
  },
  {
    regex: /net::ERR_|Failed to fetch|NetworkError/i,
    severity: "error",
    category: "network",
    rootCause: () => "Network request failed.",
    impact: "Feature unavailable; may cause cascading failures",
    fix: () => "Check CORS headers, endpoint availability, and auth tokens",
    autoFixable: false,
  },
  {
    regex: /Circular dependency detected/i,
    severity: "warning",
    category: "bundle",
    rootCause: () => "Two or more modules import each other, creating a cycle.",
    impact: "Unpredictable module initialization order; may cause undefined imports",
    fix: () => "Extract shared logic to a third module that neither imports",
    autoFixable: false,
  },
];

// ── Analyzer ──────────────────────────────────────────────────────────────────

let _id = 0;
function nextId() { return `diag_${Date.now()}_${++_id}`; }

export function analyzeText(
  text: string,
  file: string | null = null,
  line: number | null = null,
): Diagnostic[] {
  const results: Diagnostic[] = [];
  for (const p of PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      results.push({
        id: nextId(),
        severity: p.severity,
        category: p.category,
        message: m[0].slice(0, 200),
        file,
        line,
        column: null,
        rootCause: p.rootCause(m),
        impact: p.impact,
        recommendedFix: p.fix(m),
        autoFixable: p.autoFixable,
        createdAt: Date.now(),
      });
    }
  }
  return results;
}

export function analyzeFiles(
  files: Array<{ path: string; content: string }>,
): Diagnostic[] {
  const all: Diagnostic[] = [];
  for (const { path, content } of files) {
    const lines = content.split("\n");
    lines.forEach((lineText, i) => {
      const diags = analyzeText(lineText, path, i + 1);
      all.push(...diags);
    });
  }
  return deduplicateDiagnostics(all);
}

function deduplicateDiagnostics(diags: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diags.filter((d) => {
    const key = `${d.category}:${d.message.slice(0, 60)}:${d.file}:${d.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Console relay parser (captures from iframe postMessage) ──────────────────

export function parseConsoleMessage(
  level: "log" | "info" | "warn" | "error",
  text: string,
  file?: string | null,
): Diagnostic[] {
  if (level === "log" || level === "info") return [];
  return analyzeText(text, file ?? null, null).map((d) => ({
    ...d,
    severity: level === "error" ? "error" : "warning",
  }));
}
