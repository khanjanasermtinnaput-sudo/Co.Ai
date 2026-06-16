// ── Project type detection ────────────────────────────────────────────────────
// Determines the generated project's framework by inspecting actual file paths
// and the contents of package.json, rather than trusting the AI's free-text
// ProjectBrief.techStack — that field is descriptive, not a reliable contract.

import type { ExtractedFile } from "./export";
import type { ProjectKind } from "./export-types";

export function detectProjectKind(files: ExtractedFile[]): ProjectKind {
  const paths = files.map((f) => f.path.replace(/^\.\//, ""));
  const pkgFile = files.find((f) => f.path.replace(/^\.\//, "") === "package.json");

  let deps: Record<string, string> = {};
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      // malformed package.json — fall through to path-based detection
    }
  }

  const hasAny = (re: RegExp) => paths.some((p) => re.test(p));

  if (deps.next || hasAny(/^app\/|^pages\/_app\.|next\.config\./)) return "nextjs";
  if (deps.vue || hasAny(/\.vue$/)) return "vue";
  if (deps.react || hasAny(/^src\/App\.(jsx|tsx)$/)) return "react";
  if (hasAny(/(^|\/)index\.html$/)) return "html";
  return "unknown";
}

/** Export-as-HTML only makes sense for projects with a single static entry page. */
export function hasHtmlEntry(files: ExtractedFile[]): boolean {
  return files.some((f) => /(^|\/)index\.html$/.test(f.path.replace(/^\.\//, "")));
}
