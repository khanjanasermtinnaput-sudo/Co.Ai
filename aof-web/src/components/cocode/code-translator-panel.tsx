"use client";

// ── Code Translator Panel (Phase 43) ─────────────────────────────────────────
// Translates the active file or pasted code between languages/frameworks.

import { useState, useMemo } from "react";
import { Languages, Loader2, Download, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import {
  TRANSLATION_TARGETS, detectLanguage, detectUIFramework,
  buildTranslationPrompt, targetFileExtension,
  type TranslationTarget,
} from "@/lib/cocode/code-translator";
import { PanelHeader } from "@/components/cocode/panel-header";

export function CodeTranslatorPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const getActiveFile = useCocodeIDEStore((s) => s.activeFile);

  const activeFile = getActiveFile();

  const [customCode, setCustomCode] = useState("");
  const [targetId, setTargetId] = useState<string>(TRANSLATION_TARGETS[0].language + TRANSLATION_TARGETS[0].framework);
  const [translating, setTranslating] = useState(false);
  const [result, setResult] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [useCustom, setUseCustom] = useState(false);

  const sourceCode = useCustom ? customCode : (activeFile?.content ?? "");
  const sourcePath = useCustom ? "input.ts" : (activeFile?.path ?? "input.ts");

  const sourceLang = useMemo(() => detectLanguage(sourcePath, sourceCode), [sourcePath, sourceCode]);
  const sourceFramework = useMemo(() => detectUIFramework(sourceCode, sourceLang), [sourceCode, sourceLang]);

  const target = TRANSLATION_TARGETS.find((t) => `${t.language}${t.framework}` === targetId) ?? TRANSLATION_TARGETS[0];

  async function translate() {
    if (!sourceCode.trim()) return;
    setTranslating(true);
    setResult("");
    setSavedPath(null);

    const prompt = buildTranslationPrompt(sourceCode, sourceLang, sourceFramework, target);
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
      const cleaned = full.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "").trim();
      setResult(cleaned);
    }
    setTranslating(false);
  }

  function save() {
    if (!result) return;
    const baseName = sourcePath.replace(/\.[^.]+$/, "").split("/").pop() ?? "translated";
    const ext = targetFileExtension(target);
    const outPath = `${baseName}_${target.language}.${ext}`;
    upsertFile(outPath, result);
    setSavedPath(outPath);
    openTab(outPath);
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={Languages} title="Code Translator" />

      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {/* Source */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Source</label>
            <button type="button" onClick={() => setUseCustom((v) => !v)}
              className="text-[11px] text-primary hover:underline">
              {useCustom ? "Use active file" : "Paste code"}
            </button>
          </div>
          {useCustom ? (
            <textarea
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              rows={8}
              placeholder="Paste code to translate…"
              className="w-full resize-none rounded-lg border border-border/50 console-surface p-3 font-mono text-[12px] outline-none focus:border-primary/40"
            />
          ) : (
            <div className="rounded-lg border border-border/40 bg-card/30 p-3 text-[12px]">
              {activeFile ? (
                <>
                  <p className="mb-1 font-mono text-muted-foreground/60">{activeFile.path}</p>
                  <p className="text-muted-foreground/50">{activeFile.content.split("\n").length} lines · detected: <span className="text-primary">{sourceLang}{sourceFramework !== "none" ? ` + ${sourceFramework}` : ""}</span></p>
                </>
              ) : (
                <p className="text-muted-foreground/50">No file open. Open a file in the editor or paste code.</p>
              )}
            </div>
          )}
        </div>

        {/* Direction */}
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-center text-[12px] text-muted-foreground/70">
            {sourceLang}{sourceFramework !== "none" ? ` + ${sourceFramework}` : ""}
          </div>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" />
          <div className="flex-1">
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-[12px] outline-none focus:border-primary/40"
            >
              {TRANSLATION_TARGETS.map((t) => (
                <option key={`${t.language}${t.framework}`} value={`${t.language}${t.framework}`}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <Button onClick={() => void translate()} disabled={translating || !sourceCode.trim()} className="w-full">
          {translating ? <><Loader2 className="size-3.5 animate-spin" /> Translating…</> : <><Languages className="size-3.5" /> Translate</>}
        </Button>

        {/* Output */}
        {result && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/60">Translated — {target.label}</span>
              <Button size="sm" variant="ghost" onClick={save}><Download className="size-3.5" /> Save</Button>
            </div>
            {savedPath && <p className="mb-2 text-[11px] text-emerald-400">✓ Saved to {savedPath}</p>}
            <pre className="max-h-80 overflow-auto console-surface rounded-lg p-3 font-mono text-[11px]">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
