// ── Conversation export helpers ───────────────────────────────────────────────
import type { Conversation, ProjectBrief } from "@/lib/types";
import { ExportError, type ExportFormat, type ExportStage } from "@/lib/export-types";
import { detectProjectKind, canBuildHtml } from "@/lib/project-detect";

/** Format a conversation as clean Markdown. */
export function toMarkdown(conv: Conversation): string {
  const lines: string[] = [
    `# ${conv.title}`,
    ``,
    `> Exported from CoAgentix · ${new Date(conv.createdAt).toLocaleString()}`,
    ``,
  ];

  for (const msg of conv.messages) {
    if (msg.role === "system") continue;
    const who = msg.role === "user" ? "**You**" : "**CoAI**";
    const ts = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    lines.push(`---`);
    lines.push(``);
    lines.push(`${who} · ${ts}`);
    lines.push(``);

    if (msg.attachments?.length) {
      for (const a of msg.attachments) {
        lines.push(`_📎 ${a.name} (${a.kind})_`);
      }
      lines.push(``);
    }

    if (msg.error) {
      lines.push(`> ⚠ Provider error: ${msg.error.code} — ${msg.error.problem}`);
    } else if (msg.content) {
      lines.push(msg.content);
    }

    lines.push(``);
  }

  return lines.join("\n");
}

/** Serialise conversation as structured JSON (omit raw binary data URLs). */
export function toJSON(conv: Conversation): string {
  const clean = {
    id: conv.id,
    title: conv.title,
    model: conv.model,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: conv.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        route: m.route?.target,
        style: m.style,
        createdAt: m.createdAt,
        attachments: m.attachments?.map((a) => ({
          name: a.name,
          kind: a.kind,
          size: a.size,
          mime: a.mime,
        })),
      })),
  };
  return JSON.stringify(clean, null, 2);
}

/** Trigger a browser file download. */
export function downloadFile(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Slugify a title for use as a filename. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "chat";
}

export function exportConversation(conv: Conversation, format: "md" | "json"): void {
  const slug = slugify(conv.title);
  if (format === "md") {
    downloadFile(toMarkdown(conv), `${slug}.md`, "text/markdown");
  } else {
    downloadFile(toJSON(conv), `${slug}.json`, "application/json");
  }
}

/** Rough token estimate: ~4 chars per token (GPT family heuristic). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

// ── Aof Code output export ────────────────────────────────────────────────────

export interface ExtractedFile {
  path: string;
  content: string;
}

/** True when a token looks like a real filename: has an extension or a path. */
function isFilenameLike(token: string): boolean {
  if (!token || /\s/.test(token)) return false;
  return /^[\w./\-]+\.[A-Za-z0-9]+$/.test(token) || /^[\w.\-]+\/[\w./\-]+$/.test(token);
}

/** Pull a filename out of a fence info string: `path=foo.js`, `foo.js`, or a
 *  bare language token (returns null so a default name is chosen later). */
function pathFromInfo(info: string): string | null {
  const pm = info.match(/path=([^\s]+)/);
  if (pm) return pm[1].replace(/["'`]/g, "");
  const first = (info.split(/\s+/)[0] || "").replace(/["'`]/g, "");
  return isFilenameLike(first) ? first : null;
}

/** Pull a filename from a heading / bold / "File:" label line that often
 *  precedes a code block (the AOF_CODE_GEN_SYSTEM format uses **`path`**). */
function filenameHint(line: string): string | null {
  let s = line.trim();
  if (!s) return null;
  s = s.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s+/, "");
  s = s.replace(/^(?:file|filename|path)\s*[:：]\s*/i, "");
  s = s.replace(/\*\*/g, "").replace(/`/g, "").replace(/[:：]\s*$/, "").trim();
  const token = s.split(/\s+/)[0] || "";
  return isFilenameLike(token) ? token : null;
}

/** Pull a filename from a leading comment inside a block, e.g. `// src/app.js`,
 *  `<!-- index.html -->`, `/* style.css *\/`, `# main.py`. */
function filenameFromComment(body: string[]): string | null {
  const first = body.find((l) => l.trim());
  if (!first) return null;
  const m = first
    .trim()
    .match(/^(?:\/\/|#|<!--|\/\*)\s*([\w./\-]+\.[A-Za-z0-9]+)/);
  return m && isFilenameLike(m[1]) ? m[1] : null;
}

const LANG_DEFAULT: Record<string, string> = {
  html: "index.html",
  css: "style.css",
  js: "script.js",
  javascript: "script.js",
  ts: "script.ts",
  typescript: "script.ts",
  jsx: "App.jsx",
  tsx: "App.tsx",
  json: "data.json",
  py: "main.py",
  python: "main.py",
  md: "README.md",
  markdown: "README.md",
};

function defaultName(info: string, idx: number): string {
  const lang = (info.split(/\s+/)[0] || "").toLowerCase();
  if (LANG_DEFAULT[lang]) return LANG_DEFAULT[lang];
  const ext = lang.replace(/[^a-z0-9]/g, "") || "txt";
  return idx === 0 ? `file.${ext}` : `file${idx}.${ext}`;
}

/** Ensure a unique path, appending -2, -3… before the extension on collision. */
function uniquePath(path: string, used: Set<string>): string {
  if (!used.has(path)) return path;
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n++;
  return `${stem}-${n}${ext}`;
}

/** Pull individual files out of Aof Code's generated output. Handles every
 *  format the pipeline can produce:
 *   - ```path=src/main.js          (live tmap-v2 Coder, agents.ts)
 *   - **`src/index.ts`** + block   (serverless AOF_CODE_GEN_SYSTEM, raa.ts)
 *   - ```html / ```css / ```js     (bare language → index.html/style.css/script.js)
 *   - leading // file.js comment   (filename embedded in the block)
 *  Uses a line-based scan so files whose content contains a ``` fence (e.g. a
 *  README) survive when emitted inside a longer outer fence. */
export function extractGeneratedFiles(buildLog: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  const used = new Set<string>();
  const lines = buildLog.split("\n");
  let pendingName: string | null = null;
  let idx = 0;

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!open) {
      const hint = filenameHint(lines[i]);
      if (hint) pendingName = hint;
      continue;
    }

    const fence = open[1];
    const info = open[2].trim();
    const closeRe = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !closeRe.test(lines[j]); j++) body.push(lines[j]);

    const content = body.join("\n");
    if (content.trim()) {
      const rawPath =
        pathFromInfo(info) ||
        pendingName ||
        filenameFromComment(body) ||
        defaultName(info, idx);
      const path = uniquePath(rawPath.replace(/^\.?\//, ""), used);
      used.add(path);
      files.push({ path, content });
      idx++;
    }
    pendingName = null;
    i = j;
  }

  return files;
}

// ── Export system (HTML / ZIP) ────────────────────────────────────────────────

/** Reject files that would escape the export root, plus duplicate / empty entries. */
function validateFiles(buildLog: string, files: ExtractedFile[]): void {
  if (!buildLog || !buildLog.trim()) throw new ExportError("EMPTY_PROJECT");
  if (!files.length) throw new ExportError("MISSING_FILES");

  const seen = new Set<string>();
  for (const f of files) {
    const normalized = f.path.replace(/^\.\//, "");
    if (!normalized || normalized.includes("..") || normalized.startsWith("/")) {
      throw new ExportError("INVALID_CODE");
    }
    if (seen.has(normalized)) throw new ExportError("INVALID_CODE");
    seen.add(normalized);
    if (!f.content.trim()) throw new ExportError("INVALID_CODE");
  }
}

const norm = (p: string) => p.replace(/^\.?\//, "");

/** Merge a project's HTML/CSS/JS into one self-contained, offline-ready file.
 *  Inlines referenced <link>/<script src> assets, injects any unreferenced CSS/JS
 *  the model produced, and synthesises a minimal page when there is no .html at
 *  all but renderable CSS/JS exist. Throws only when nothing is renderable. */
export function buildProjectHtml(files: ExtractedFile[]): string {
  const byPath = new Map(files.map((f) => [norm(f.path), f.content]));
  const cssFiles = files.filter((f) => /\.css$/i.test(f.path));
  const jsFiles = files.filter((f) => /\.(m?js)$/i.test(f.path));

  const entry =
    files.find((f) => /(^|\/)index\.html$/i.test(norm(f.path))) ||
    files.find((f) => /\.html?$/i.test(f.path));

  // No HTML page — synthesise a shell if we have something to render.
  if (!entry) {
    if (!cssFiles.length && !jsFiles.length) throw new ExportError("NO_HTML_ENTRY");
    const styles = cssFiles.map((f) => `<style>\n${f.content}\n</style>`).join("\n");
    const scripts = jsFiles.map((f) => `<script>\n${f.content}\n</script>`).join("\n");
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      "<title>CoAgentix Code Preview</title>",
      styles,
      "</head>",
      "<body>",
      scripts,
      "</body>",
      "</html>",
    ].join("\n");
  }

  const entryPath = norm(entry.path);
  const baseDir = entryPath.includes("/")
    ? entryPath.slice(0, entryPath.lastIndexOf("/") + 1)
    : "";
  const usedPaths = new Set<string>();

  const resolve = (ref: string): string | undefined => {
    const clean = ref.split("?")[0].split("#")[0];
    if (/^https?:\/\//.test(clean) || clean.startsWith("//")) return undefined;
    const key = byPath.has(norm(baseDir + clean)) ? norm(baseDir + clean) : norm(clean);
    const hit = byPath.get(key);
    if (hit !== undefined) usedPaths.add(key);
    return hit;
  };

  let html = entry.content;

  html = html.replace(
    /<link\b[^>]*rel=["']?stylesheet["']?[^>]*?href=["']([^"']+)["'][^>]*>/gi,
    (tag, href) => {
      const css = resolve(href);
      return css !== undefined ? `<style>\n${css}\n</style>` : tag;
    },
  );
  html = html.replace(
    /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']?stylesheet["']?[^>]*>/gi,
    (tag, href) => {
      const css = resolve(href);
      return css !== undefined ? `<style>\n${css}\n</style>` : tag;
    },
  );
  html = html.replace(
    /<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
    (tag, src) => {
      const js = resolve(src);
      return js !== undefined ? `<script>\n${js}\n</script>` : tag;
    },
  );

  // Inject any CSS/JS the model emitted but never linked from the HTML.
  const extraCss = cssFiles
    .filter((f) => !usedPaths.has(norm(f.path)))
    .map((f) => `<style>\n${f.content}\n</style>`)
    .join("\n");
  const extraJs = jsFiles
    .filter((f) => !usedPaths.has(norm(f.path)))
    .map((f) => `<script>\n${f.content}\n</script>`)
    .join("\n");

  if (extraCss) {
    html = html.includes("</head>")
      ? html.replace("</head>", `${extraCss}\n</head>`)
      : `${extraCss}\n${html}`;
  }
  if (extraJs) {
    html = html.includes("</body>")
      ? html.replace("</body>", `${extraJs}\n</body>`)
      : `${html}\n${extraJs}`;
  }

  return html;
}

/** Build a project ZIP, preserving the AI's generated folder structure and
 *  attaching a README when one wasn't generated. */
async function buildZip(files: ExtractedFile[], brief?: ProjectBrief | null): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.path.replace(/^\.\//, ""), f.content);
  }

  const hasReadme = files.some((f) => /^readme\.md$/i.test(f.path.replace(/^\.\//, "")));
  if (!hasReadme) {
    const kind = detectProjectKind(files);
    const name = brief?.project ?? "CoAgentix Code project";
    zip.file(
      "README.md",
      [
        `# ${name}`,
        "",
        `Generated by CoAgentix Code${kind !== "unknown" ? ` · ${kind} project` : ""}.`,
        brief?.techStack ? `\nStack: ${brief.techStack}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return zip.generateAsync({ type: "blob" });
}

/** Validate, build and download the latest generated project in the requested
 *  format, reporting progress through the four export stages. */
export async function exportProject(
  buildLog: string,
  format: ExportFormat,
  brief?: ProjectBrief | null,
  onProgress?: (stage: ExportStage) => void,
): Promise<void> {
  onProgress?.("preparing");
  const files = extractGeneratedFiles(buildLog);
  validateFiles(buildLog, files);

  const slug = slugify(brief?.project ?? "coagentix-code-project");

  onProgress?.("building");
  if (format === "html") {
    const html = buildProjectHtml(files);
    onProgress?.("done");
    downloadFile(html, "index.html", "text/html");
    return;
  }

  onProgress?.("compressing");
  const blob = await buildZip(files, brief);
  onProgress?.("done");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export { canBuildHtml, detectProjectKind };
