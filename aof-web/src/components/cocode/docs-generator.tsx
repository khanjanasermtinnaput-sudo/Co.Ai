"use client";

// ── AI Documentation Engine (Phase 27) ────────────────────────────────────────
// Generates README, Architecture, API docs, Component docs, Deployment Guide.
// Each doc type prompts the AI with relevant file context.
// Generated docs appear in a preview + can be saved to the virtual FS.

import { useState } from "react";
import { BookOpen, Loader2, Download, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

type DocKind =
  | "readme"
  | "architecture"
  | "api"
  | "database"
  | "components"
  | "hooks"
  | "utils"
  | "deployment"
  | "changelog";

const DOC_TYPES: Array<{ id: DocKind; label: string; emoji: string; filename: string }> = [
  { id: "readme", label: "README", emoji: "📖", filename: "README.md" },
  { id: "architecture", label: "Architecture", emoji: "🏗️", filename: "ARCHITECTURE.md" },
  { id: "api", label: "API Docs", emoji: "🔌", filename: "API.md" },
  { id: "database", label: "Database", emoji: "🗄️", filename: "DATABASE.md" },
  { id: "components", label: "Components", emoji: "🧩", filename: "docs/COMPONENTS.md" },
  { id: "hooks", label: "Hooks", emoji: "🪝", filename: "docs/HOOKS.md" },
  { id: "utils", label: "Utilities", emoji: "🔧", filename: "docs/UTILS.md" },
  { id: "deployment", label: "Deployment", emoji: "🚀", filename: "DEPLOYMENT.md" },
  { id: "changelog", label: "Changelog", emoji: "📋", filename: "CHANGELOG.md" },
];

function buildPrompt(kind: DocKind, projectName: string, files: Array<{ path: string; content: string }>): string {
  const relevant = files
    .filter((f) => {
      if (kind === "api") return f.path.includes("/api/") || f.path.includes("route");
      if (kind === "components") return /\.(tsx|jsx)$/.test(f.path);
      if (kind === "hooks") return f.path.includes("hook") || /use[A-Z]/.test(f.path);
      if (kind === "utils") return f.path.includes("util") || f.path.includes("lib/");
      if (kind === "database") return f.path.includes("schema") || f.path.includes("migration") || f.path.includes("supabase");
      return true;
    })
    .slice(0, 15)
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 600)}\n\`\`\``)
    .join("\n\n");

  const prompts: Record<DocKind, string> = {
    readme: `Generate a comprehensive README.md for the project "${projectName}". Include: project overview, features, tech stack, quick start, environment variables, available scripts, and license. Use Markdown.`,
    architecture: `Generate an ARCHITECTURE.md for "${projectName}". Cover: system design, directory structure, data flow, key architectural decisions, and component relationships.`,
    api: `Generate API.md documentation. For each API route, document: method, path, request body, response schema, auth requirements, and example.`,
    database: `Generate DATABASE.md. Document: schema, tables, relationships, indexes, and any migration notes.`,
    components: `Generate COMPONENTS.md. For each React component, document: purpose, props, usage example, and any important notes.`,
    hooks: `Generate HOOKS.md. For each custom hook, document: purpose, parameters, return value, and example usage.`,
    utils: `Generate UTILS.md. For each utility function, document: purpose, parameters, return type, and example.`,
    deployment: `Generate DEPLOYMENT.md. Cover: build process, environment variables, deployment platforms, CI/CD setup, and troubleshooting.`,
    changelog: `Generate a CHANGELOG.md using Keep a Changelog format. Infer recent changes from the codebase structure.`,
  };

  return `${prompts[kind]}\n\nProject: ${projectName}\nFiles:\n${relevant}`;
}

export function DocsGenerator({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const projectName = useCocodeIDEStore((s) => s.projectName);
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const [selected, setSelected] = useState<DocKind>("readme");
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);

  const allFiles = flattenFiles(fs).map((f) => ({ path: f.path, content: f.content }));

  async function generate() {
    setGenerating(true);
    setContent("");

    const prompt = buildPrompt(selected, projectName, allFiles);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          history: [],
          agent: "cocode",
          route: "docs",
        }),
      });

      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        setContent(full);
      }
    } finally {
      setGenerating(false);
    }
  }

  function saveToFS() {
    const docType = DOC_TYPES.find((d) => d.id === selected)!;
    upsertFile(docType.filename, content);
    openTab(docType.filename);
  }

  function downloadMd() {
    const docType = DOC_TYPES.find((d) => d.id === selected)!;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = docType.filename.split("/").pop()!;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <BookOpen className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Documentation Generator</span>
        {content && (
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={saveToFS} title="Save to virtual FS">
              <FolderOpen className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadMd} title="Download .md">
              <Download className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border/50 p-2">
          {DOC_TYPES.map((dt) => (
            <button
              key={dt.id}
              type="button"
              onClick={() => { setSelected(dt.id); setContent(""); }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] transition-colors",
                selected === dt.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5",
              )}
            >
              <span className="text-sm">{dt.emoji}</span>
              {dt.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {content ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-[#0b0b0f] p-4">
              <pre className="whitespace-pre-wrap font-mono text-[12px] text-slate-300 leading-relaxed">
                {content}
              </pre>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <BookOpen className="size-10 text-muted-foreground/30" />
              <div>
                <p className="text-sm font-medium">
                  {DOC_TYPES.find((d) => d.id === selected)?.emoji}{" "}
                  {DOC_TYPES.find((d) => d.id === selected)?.label}
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground/60">
                  Generate {DOC_TYPES.find((d) => d.id === selected)?.filename}
                </p>
              </div>
              <Button onClick={() => void generate()} disabled={generating || !allFiles.length}>
                {generating
                  ? <><Loader2 className="size-3.5 animate-spin" /> Generating…</>
                  : <><BookOpen className="size-3.5" /> Generate</>}
              </Button>
            </div>
          )}

          {/* Bottom bar */}
          {content && (
            <div className="flex items-center justify-between border-t border-border/50 bg-card/30 px-4 py-2">
              <span className="text-[11px] text-muted-foreground/60">
                {DOC_TYPES.find((d) => d.id === selected)?.filename} · {content.split("\n").length} lines
              </span>
              <Button size="sm" onClick={() => void generate()} disabled={generating}>
                {generating
                  ? <><Loader2 className="size-3.5 animate-spin" /> Regenerating…</>
                  : "Regenerate"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
