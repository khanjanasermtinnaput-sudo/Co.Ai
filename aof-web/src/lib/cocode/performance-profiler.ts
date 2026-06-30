// ── Performance Profiler (Phase 35) ───────────────────────────────────────────
// Analyzes virtual FS for Core Web Vitals risk factors, bundle size estimates,
// slow component patterns, and optimization opportunities.

export interface BundleEntry {
  path: string;
  sizeBytes: number;
  sizeKB: number;
  kind: "component" | "lib" | "api" | "page" | "style" | "other";
  treeshakeable: boolean;
  lazyLoaded: boolean;
}

export interface CWVRisk {
  metric: "LCP" | "FID" | "CLS" | "INP" | "TTFB" | "FCP";
  riskLevel: "high" | "medium" | "low";
  reason: string;
  recommendation: string;
}

export interface SlowComponent {
  path: string;
  name: string;
  issues: string[];
  estimatedImpact: "high" | "medium" | "low";
}

export interface PerformanceReport {
  totalSizeKB: number;
  largestFiles: BundleEntry[];
  cwvRisks: CWVRisk[];
  slowComponents: SlowComponent[];
  unusedDynamicImports: string[];
  missingOptimizations: string[];
  score: number; // 0-100 (higher = better)
  builtAt: number;
}

// ── Analysis ───────────────────────────────────────────────────────────────────

function classifyFile(path: string): BundleEntry["kind"] {
  if (path.includes("/api/")) return "api";
  if (path.includes("/pages/") || path.includes("/app/")) return "page";
  if (/\.(css|scss|sass)$/.test(path)) return "style";
  if (/\.(tsx|jsx)$/.test(path)) return "component";
  if (path.includes("/lib/") || path.includes("/utils/")) return "lib";
  return "other";
}

export function profilePerformance(
  files: Array<{ path: string; content: string }>,
): PerformanceReport {
  const entries: BundleEntry[] = [];

  for (const { path, content } of files) {
    if (path.includes("node_modules") || path.includes(".next")) continue;
    const sizeBytes = new TextEncoder().encode(content).length;
    entries.push({
      path,
      sizeBytes,
      sizeKB: Math.round(sizeBytes / 1024 * 10) / 10,
      kind: classifyFile(path),
      treeshakeable: !content.includes("module.exports") && content.includes("export"),
      lazyLoaded: content.includes("dynamic(") || content.includes("React.lazy(") || content.includes("lazy("),
    });
  }

  const totalSizeKB = entries.reduce((acc, e) => acc + e.sizeKB, 0);
  const largestFiles = [...entries].sort((a, b) => b.sizeKB - a.sizeKB).slice(0, 10);

  // CWV risk detection
  const cwvRisks: CWVRisk[] = [];
  const allContent = files.map((f) => f.content).join("\n");

  if (/<img(?![^>]*loading=["']lazy["'])/i.test(allContent)) {
    cwvRisks.push({
      metric: "LCP",
      riskLevel: "high",
      reason: "Images without loading='lazy' block LCP",
      recommendation: "Add loading='lazy' to below-the-fold images. Use next/image for automatic optimization.",
    });
  }
  if (!allContent.includes("next/image") && /<img/i.test(allContent)) {
    cwvRisks.push({
      metric: "LCP",
      riskLevel: "medium",
      reason: "Using raw <img> instead of next/image",
      recommendation: "Use next/image for automatic WebP conversion, lazy loading, and size optimization.",
    });
  }
  if (allContent.includes("useEffect") && !allContent.includes("Suspense")) {
    cwvRisks.push({
      metric: "FCP",
      riskLevel: "medium",
      reason: "Data fetching in useEffect delays first content paint",
      recommendation: "Use React Suspense + server components or SWR/React Query for streamed data.",
    });
  }
  if (totalSizeKB > 500) {
    cwvRisks.push({
      metric: "TTFB",
      riskLevel: "high",
      reason: `Large total bundle (${Math.round(totalSizeKB)}KB) increases server response time`,
      recommendation: "Implement code splitting, lazy loading, and tree shaking to reduce bundle size.",
    });
  }
  if (/position:\s*fixed|position:\s*sticky/.test(allContent) && !/transform/.test(allContent)) {
    cwvRisks.push({
      metric: "CLS",
      riskLevel: "medium",
      reason: "Fixed/sticky elements without transform may cause layout shifts",
      recommendation: "Reserve space for fixed elements. Use CSS transform for animations instead of layout properties.",
    });
  }

  // Slow component detection
  const slowComponents: SlowComponent[] = [];
  for (const { path, content } of files) {
    if (!/\.(tsx|jsx)$/.test(path)) continue;
    const issues: string[] = [];
    const lineCount = content.split("\n").length;

    if (lineCount > 300) issues.push(`Very large component (${lineCount} lines)`);
    if (!content.includes("memo(") && content.includes("props") && /useState|useEffect/.test(content))
      issues.push("Not memoized — re-renders on every parent render");
    if ((content.match(/useEffect/g) ?? []).length > 5)
      issues.push("Excessive useEffect usage (>5) — consider consolidating");
    if (/fetch\(/.test(content) && !content.includes("cache:"))
      issues.push("fetch() without cache — repeated network requests on every render");
    if (/\.map\([^)]*\)\s*\.\s*map\(/g.test(content))
      issues.push("Chained .map() — O(n²) complexity risk");

    if (issues.length > 0) {
      const nameMatch = content.match(/(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/);
      slowComponents.push({
        path,
        name: nameMatch?.[1] ?? path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        issues,
        estimatedImpact: issues.length >= 3 ? "high" : issues.length === 2 ? "medium" : "low",
      });
    }
  }

  // Missing optimizations
  const missingOptimizations: string[] = [];
  if (!files.some((f) => f.path.includes("next.config")))
    missingOptimizations.push("No next.config — enable image optimization, compression, headers");
  if (!allContent.includes("Suspense"))
    missingOptimizations.push("No React Suspense — add for streaming SSR and lazy loading");
  if (!allContent.includes("useMemo") && allContent.includes("filter(") && allContent.includes("map("))
    missingOptimizations.push("Expensive array operations not memoized with useMemo");
  if (!allContent.includes("dynamic(") && entries.filter((e) => e.kind === "component").length > 20)
    missingOptimizations.push("No dynamic imports — large component count without code splitting");

  // Score: start at 100, deduct for issues
  let score = 100;
  score -= cwvRisks.filter((r) => r.riskLevel === "high").length * 15;
  score -= cwvRisks.filter((r) => r.riskLevel === "medium").length * 8;
  score -= slowComponents.filter((c) => c.estimatedImpact === "high").length * 10;
  score -= slowComponents.filter((c) => c.estimatedImpact === "medium").length * 5;
  score -= missingOptimizations.length * 5;
  if (totalSizeKB > 1000) score -= 20;
  else if (totalSizeKB > 500) score -= 10;
  score = Math.max(0, Math.min(100, score));

  return {
    totalSizeKB: Math.round(totalSizeKB * 10) / 10,
    largestFiles: largestFiles.slice(0, 8),
    cwvRisks,
    slowComponents: slowComponents.slice(0, 10),
    unusedDynamicImports: [],
    missingOptimizations,
    score,
    builtAt: Date.now(),
  };
}
