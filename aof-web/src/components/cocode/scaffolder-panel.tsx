"use client";

// ── AI Project Scaffolder Panel (Phase 50) ────────────────────────────────────
// Generate complete project file structures from templates + AI enhancement.

import { useState } from "react";
import { Wand2, Loader2, ChevronRight, FolderOpen, Plus, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import {
  TEMPLATES, generateScaffold, buildAIScaffoldPrompt,
  type ScaffoldTemplate, type ScaffoldOptions,
} from "@/lib/cocode/scaffolder";

const PM_OPTIONS = ["npm", "pnpm", "yarn", "bun"] as const;

export function ScaffolderPanel({ className }: { className?: string }) {
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const [step, setStep] = useState<"config" | "preview" | "done">("config");
  const [template, setTemplate] = useState<ScaffoldTemplate>("nextjs-app");
  const [projectName, setProjectName] = useState("my-project");
  const [typescript, setTypescript] = useState(true);
  const [includeTests, setIncludeTests] = useState(true);
  const [pm, setPm] = useState<ScaffoldOptions["packageManager"]>("pnpm");
  const [extras, setExtras] = useState<string[]>(["tailwind", "eslint"]);
  const [description, setDescription] = useState("");
  const [aiEnhance, setAiEnhance] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [aiFiles, setAiFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [loadedCount, setLoadedCount] = useState(0);

  const selectedTemplate = TEMPLATES.find((t) => t.id === template) ?? TEMPLATES[0];

  function toggleExtra(ext: string) {
    setExtras((prev) => prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext]);
  }

  async function scaffold() {
    setGenerating(true);
    setStep("preview");

    const opts: ScaffoldOptions = { template, projectName, typescript, includeTests, packageManager: pm, extras };
    const files = generateScaffold(opts);
    setGeneratedFiles(files);

    if (aiEnhance && description.trim()) {
      const prompt = buildAIScaffoldPrompt(opts, description);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, history: [], agent: "cocode", route: "code" }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += dec.decode(value, { stream: true });
        }
        // Parse code blocks: ```path/to/file\ncontent```
        const blockRe = /```([^\n`]+)\n([\s\S]*?)```/g;
        const extra: Array<{ path: string; content: string }> = [];
        let m: RegExpExecArray | null;
        blockRe.lastIndex = 0;
        while ((m = blockRe.exec(full)) !== null) {
          const possiblePath = m[1].trim();
          if (possiblePath.includes("/") || possiblePath.includes(".")) {
            extra.push({ path: possiblePath, content: m[2] });
          }
        }
        setAiFiles(extra);
      }
    }

    setGenerating(false);
  }

  function loadAll() {
    const all = [...generatedFiles, ...aiFiles];
    for (const f of all) {
      upsertFile(f.path, f.content);
    }
    setLoadedCount(all.length);
    if (all.length > 0) openTab(all[0].path);
    setStep("done");
  }

  const allFiles = [...generatedFiles, ...aiFiles];

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Wand2 className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Project Scaffolder</span>
        {step !== "config" && (
          <button type="button" onClick={() => { setStep("config"); setGeneratedFiles([]); setAiFiles([]); }}
            className="ml-auto text-[11px] text-primary hover:underline">
            ← New Project
          </button>
        )}
      </div>

      {step === "config" && (
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4 p-4">
          {/* Project name */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Project Name</label>
            <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value.replace(/\s+/g, "-").toLowerCase())}
              className="w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-[12px] outline-none focus:border-primary/40"
            />
          </div>

          {/* Template */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Template</label>
            <div className="space-y-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => { setTemplate(t.id); setExtras(t.defaultExtras); }}
                  className={cn("w-full rounded-xl border p-3 text-left transition-colors",
                    template === t.id ? "border-primary/50 bg-primary/10" : "border-border/50 hover:border-border hover:bg-white/5")}>
                  <p className={cn("text-[13px] font-medium", template === t.id && "text-primary")}>{t.label}</p>
                  <p className="text-[11px] text-muted-foreground/60">{t.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Extras */}
          {selectedTemplate.availableExtras.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Extras</label>
              <div className="flex flex-wrap gap-2">
                {selectedTemplate.availableExtras.map((ext) => (
                  <button key={ext} type="button" onClick={() => toggleExtra(ext)}
                    className={cn("rounded-lg border px-3 py-1.5 text-[12px] transition-colors",
                      extras.includes(ext) ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground")}>
                    {ext}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setTypescript((v) => !v)}
              className={cn("rounded-lg border py-2 text-[12px] font-medium transition-colors",
                typescript ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground")}>
              TypeScript {typescript ? "✓" : "✗"}
            </button>
            <button type="button" onClick={() => setIncludeTests((v) => !v)}
              className={cn("rounded-lg border py-2 text-[12px] font-medium transition-colors",
                includeTests ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground")}>
              Tests {includeTests ? "✓" : "✗"}
            </button>
          </div>

          {/* Package manager */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Package Manager</label>
            <div className="flex gap-2">
              {PM_OPTIONS.map((p) => (
                <button key={p} type="button" onClick={() => setPm(p)}
                  className={cn("flex-1 rounded-lg border py-2 text-[12px] font-mono transition-colors",
                    pm === p ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground")}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* AI enhancement */}
          <div className="rounded-xl border border-border/40 bg-card/30 p-3">
            <div className="mb-2 flex items-center gap-2">
              <button type="button" onClick={() => setAiEnhance((v) => !v)}
                className={cn("size-4 rounded border-2 flex items-center justify-center transition-colors",
                  aiEnhance ? "border-primary bg-primary" : "border-border/60")}>
                {aiEnhance && <span className="text-[9px] text-primary-foreground font-bold">✓</span>}
              </button>
              <span className="text-[12px] font-medium">AI Enhancement</span>
            </div>
            {aiEnhance && (
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="Describe what your project does… (e.g. 'A SaaS dashboard for tracking customer orders with real-time updates')"
                className="w-full resize-none rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-[12px] outline-none focus:border-primary/40"
              />
            )}
          </div>

          <Button onClick={() => void scaffold()} className="w-full" disabled={!projectName.trim()}>
            <Wand2 className="size-3.5" /> Generate Project
          </Button>
        </div>
      )}

      {step === "preview" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {generating ? (
            <div className="flex flex-col items-center gap-4 py-16">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-[13px] text-muted-foreground/60">
                {aiEnhance ? "Generating files + AI enhancements…" : "Generating project files…"}
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-muted-foreground/60">{allFiles.length} files ready</p>
                <Button onClick={loadAll}>
                  <FolderOpen className="size-3.5" /> Load into Workspace
                </Button>
              </div>
              <div className="rounded-xl border border-border/40 overflow-hidden">
                {allFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 border-b border-border/20 px-3 py-2 last:border-0">
                    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/40" />
                    <code className="flex-1 text-[12px] font-mono truncate">{f.path}</code>
                    <span className="text-[10px] text-muted-foreground/40">{f.content.split("\n").length}L</span>
                    {aiFiles.includes(f) && (
                      <span className="text-[10px] text-purple-400 bg-purple-500/10 rounded px-1 py-0.5">AI</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <CheckCircle2 className="size-12 text-emerald-400" />
          <div>
            <p className="text-[15px] font-semibold text-emerald-400">Project Created!</p>
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              {loadedCount} files loaded into workspace for <strong>{projectName}</strong>.
            </p>
          </div>
          <Button variant="secondary" onClick={() => { setStep("config"); setGeneratedFiles([]); setAiFiles([]); }}>
            <Plus className="size-3.5" /> Create Another Project
          </Button>
        </div>
      )}
    </div>
  );
}
