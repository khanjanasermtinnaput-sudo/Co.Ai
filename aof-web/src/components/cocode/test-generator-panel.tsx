"use client";

// ── AI Test Generator Panel (Phase 41) ───────────────────────────────────────
// Selects a file, chooses framework + test type, generates test via AI, saves.

import { useState, useMemo } from "react";
import { FlaskConical, Loader2, Download, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import {
  extractExports, buildTestPrompt, testFilePath,
  type TestFramework, type TestType,
} from "@/lib/cocode/test-generator";

const FRAMEWORKS: Array<{ id: TestFramework; label: string }> = [
  { id: "vitest", label: "Vitest" },
  { id: "jest", label: "Jest" },
  { id: "playwright", label: "Playwright" },
];

const TEST_TYPES: Array<{ id: TestType; label: string }> = [
  { id: "unit", label: "Unit" },
  { id: "integration", label: "Integration" },
  { id: "e2e", label: "E2E" },
];

export function TestGeneratorPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const allFiles = useMemo(() => flattenFiles(fs), [fs]);
  const sourceFiles = allFiles.filter((f) => /\.(tsx?|jsx?)$/.test(f.path) && !f.path.includes(".test.") && !f.path.includes(".spec."));

  const [selectedPath, setSelectedPath] = useState(sourceFiles[0]?.path ?? "");
  const [framework, setFramework] = useState<TestFramework>("vitest");
  const [testType, setTestType] = useState<TestType>("unit");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const selectedFile = allFiles.find((f) => f.path === selectedPath);
  const exports = useMemo(() => selectedFile ? extractExports(selectedFile.content, selectedFile.path) : [], [selectedFile]);

  async function generate() {
    if (!selectedFile) return;
    setGenerating(true);
    setResult("");
    setSavedPath(null);

    const prompt = buildTestPrompt({ framework, type: testType, filePath: selectedFile.path, fileContent: selectedFile.content }, exports);

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
        setResult(full);
      }
      // Strip markdown fences
      const cleaned = full.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
      setResult(cleaned);
    }
    setGenerating(false);
  }

  function save() {
    if (!result || !selectedPath) return;
    const outPath = testFilePath(selectedPath, framework, testType);
    upsertFile(outPath, result);
    setSavedPath(outPath);
    openTab(outPath);
  }

  const GRADE_COLOR: Record<string, string> = {
    function: "text-blue-400", component: "text-violet-400", hook: "text-emerald-400", class: "text-amber-400", const: "text-slate-400",
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <FlaskConical className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">AI Test Generator</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {/* File selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Source File</label>
            {sourceFiles.length === 0 ? (
              <p className="text-[12px] text-muted-foreground/50">No source files in workspace.</p>
            ) : (
              <div className="relative">
                <select
                  value={selectedPath}
                  onChange={(e) => setSelectedPath(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-border/50 bg-background/50 px-3 py-2 pr-8 text-[12px] outline-none focus:border-primary/40"
                >
                  {sourceFiles.map((f) => (
                    <option key={f.path} value={f.path}>{f.path}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Detected exports */}
          {exports.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Detected Exports ({exports.length})</label>
              <div className="flex flex-wrap gap-1.5">
                {exports.map((e) => (
                  <span key={e.name} className={cn("rounded-md px-2 py-0.5 text-[11px] font-mono bg-secondary/30", GRADE_COLOR[e.kind] ?? "text-foreground")}>
                    {e.kind[0].toUpperCase()} {e.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Framework */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Framework</label>
            <div className="flex gap-2">
              {FRAMEWORKS.map((f) => (
                <button key={f.id} type="button"
                  onClick={() => setFramework(f.id)}
                  className={cn("flex-1 rounded-lg border py-2 text-[12px] font-medium transition-colors",
                    framework === f.id ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground")}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Test type */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Test Type</label>
            <div className="flex gap-2">
              {TEST_TYPES.map((t) => (
                <button key={t.id} type="button"
                  onClick={() => setTestType(t.id)}
                  className={cn("flex-1 rounded-lg border py-2 text-[12px] font-medium transition-colors",
                    testType === t.id ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground")}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={() => void generate()} disabled={generating || !selectedPath} className="w-full">
            {generating ? <><Loader2 className="size-3.5 animate-spin" /> Generating…</> : <><FlaskConical className="size-3.5" /> Generate Tests</>}
          </Button>

          {/* Output */}
          {result && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/60">{testFilePath(selectedPath, framework, testType)}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={save}>
                    <Download className="size-3.5" /> Save
                  </Button>
                </div>
              </div>
              {savedPath && (
                <p className="mb-2 text-[11px] text-emerald-400">✓ Saved to {savedPath}</p>
              )}
              <pre className="max-h-80 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] text-foreground">
                {result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
