// ── Conversation export helpers ───────────────────────────────────────────────
import type { Conversation, ProjectBrief } from "@/lib/types";
import { ExportError, type ExportFormat, type ExportStage } from "@/lib/export-types";
import { detectProjectKind, hasHtmlEntry } from "@/lib/project-detect";

/** Format a conversation as clean Markdown. */
export function toMarkdown(conv: Conversation): string {
  const lines: string[] = [
    `# ${conv.title}`,
    ``,
    `> Exported from Aof · ${new Date(conv.createdAt).toLocaleString()}`,
    ``,
  ];

  for (const msg of conv.messages) {
    if (msg.role === "system") continue;
    const who = msg.role === "user" ? "**You**" : "**Aof**";
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

/** Pull individual files out of Aof Code's generated output. The Coder agent
 *  emits one fenced block per file with `path=<file path>` as the info string
 *  (see tmap-v2/src/core/agents.ts CODER_SYS) — e.g. ```path=src/main.js. */
export function extractGeneratedFiles(buildLog: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  const re = /```path=([^\s`]+)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buildLog))) {
    files.push({ path: m[1].trim(), content: m[2] });
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

/** Merge a project's HTML/CSS/JS into one self-contained, offline-ready file. */
function buildSingleHtml(files: ExtractedFile[]): string {
  const norm = (p: string) => p.replace(/^\.\//, "").replace(/^\//, "");
  const byPath = new Map(files.map((f) => [norm(f.path), f.content]));

  const entry = files.find((f) => /(^|\/)index\.html$/.test(norm(f.path)));
  if (!entry) throw new ExportError("NO_HTML_ENTRY");

  const baseDir = norm(entry.path).includes("/")
    ? norm(entry.path).slice(0, norm(entry.path).lastIndexOf("/") + 1)
    : "";

  const resolve = (ref: string): string | undefined => {
    const clean = ref.split("?")[0].split("#")[0];
    if (/^https?:\/\//.test(clean)) return undefined;
    return byPath.get(norm(baseDir + clean)) ?? byPath.get(norm(clean));
  };

  let html = entry.content;

  html = html.replace(
    /<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,
    (tag, href) => {
      const css = resolve(href);
      return css !== undefined ? `<style>\n${css}\n</style>` : tag;
    },
  );

  html = html.replace(
    /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi,
    (tag, src) => {
      const js = resolve(src);
      return js !== undefined ? `<script>\n${js}\n</script>` : tag;
    },
  );

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
    const name = brief?.project ?? "Aof Code project";
    zip.file(
      "README.md",
      [
        `# ${name}`,
        "",
        `Generated by Aof Code${kind !== "unknown" ? ` · ${kind} project` : ""}.`,
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

  const slug = slugify(brief?.project ?? "aof-code-project");

  onProgress?.("building");
  if (format === "html") {
    const html = buildSingleHtml(files);
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

export { hasHtmlEntry, detectProjectKind };
