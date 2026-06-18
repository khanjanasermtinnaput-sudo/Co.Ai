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

/** Whether the project can be rendered to a single self-contained HTML page —
 *  true when there is any .html file, or any CSS/JS we can wrap in a shell.
 *  Gates both "Export as HTML" and the in-browser Preview. */
export function canBuildHtml(files: ExtractedFile[]): boolean {
  return files.some((f) => /\.html?$/i.test(f.path) || /\.(css|m?js)$/i.test(f.path));
}
