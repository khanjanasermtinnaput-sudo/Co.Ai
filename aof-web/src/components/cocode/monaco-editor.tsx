"use client";

// ── Monaco Editor (Phase 5) ───────────────────────────────────────────────────
// Lazy-loaded Monaco editor with language detection, dark theme, keyboard shortcuts.
// Never remounts on content change — updates via setValue to preserve cursor position.

import { useEffect, useRef, memo } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { VirtualFile } from "@/lib/cocode/virtual-fs";

// Lazy load Monaco — it's 5MB+, we never want it in the initial bundle
const MonacoEditorCore = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

// ── Language map (Monaco uses different names than our VirtualFile.language) ──
const MONACO_LANG: Record<string, string> = {
  typescript: "typescript",
  tsx: "typescript",
  javascript: "javascript",
  jsx: "javascript",
  css: "css",
  scss: "scss",
  html: "html",
  json: "json",
  markdown: "markdown",
  python: "python",
  rust: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  yaml: "yaml",
  toml: "ini",
  sql: "sql",
  shell: "shell",
  plaintext: "plaintext",
};

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar() {
  const tabs = useCocodeIDEStore((s) => s.tabs);
  const activeTab = useCocodeIDEStore((s) => s.activeTab);
  const closeTab = useCocodeIDEStore((s) => s.closeTab);
  const setActiveTab = useCocodeIDEStore((s) => s.setActiveTab);
  const pinTab = useCocodeIDEStore((s) => s.pinTab);
  const fs = useCocodeIDEStore((s) => s.fs);

  if (!tabs.length) return null;

  return (
    <div className="flex items-center overflow-x-auto border-b border-border/70 bg-card/30 no-scrollbar">
      {tabs.map((tab) => {
        const name = tab.path.split("/").pop() ?? tab.path;
        const isActive = tab.path === activeTab;
        // Check dirty state
        const dirty = false; // Would check fs

        return (
          <div
            key={tab.path}
            className={[
              "group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border/50 px-3 py-1.5",
              "text-[12px] transition-colors",
              isActive
                ? "bg-background/80 text-foreground"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
            ].join(" ")}
            onClick={() => setActiveTab(tab.path)}
            onDoubleClick={() => pinTab(tab.path)}
            title={tab.path}
          >
            {tab.pinned && (
              <span className="size-1.5 rounded-full bg-primary/60" />
            )}
            <span className="max-w-[120px] truncate">{name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
              className="size-4 shrink-0 rounded opacity-0 hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
            >
              <span className="flex items-center justify-center text-[10px]">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

interface MonacoEditorProps {
  className?: string;
}

export const MonacoEditor = memo(function MonacoEditor({ className }: MonacoEditorProps) {
  const activeFile = useCocodeIDEStore((s) => s.activeFile());
  const updateFile = useCocodeIDEStore((s) => s.updateFile);
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const currentPathRef = useRef<string | null>(null);

  // When active file changes, update editor content without full remount
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;
    if (currentPathRef.current === activeFile.path) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (model) {
      model.setValue(activeFile.content);
    }
    currentPathRef.current = activeFile.path;
  }, [activeFile]);

  function handleMount(
    editor: import("monaco-editor").editor.IStandaloneCodeEditor,
    monaco: typeof import("monaco-editor"),
  ) {
    editorRef.current = editor;

    // Configure TypeScript — use numeric enum values for cross-version compat
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ts = (monaco.languages.typescript as any);
    ts.typescriptDefaults.setCompilerOptions({
      target: 99,           // ESNext
      moduleResolution: 2,  // NodeJs
      module: 99,           // ESNext
      jsx: 4,               // ReactJSX
      strict: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    });

    // Format on save (Ctrl+S)
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        editor.getAction("editor.action.formatDocument")?.run();
      },
    );

    // Navigate back (Alt+Left)
    editor.addCommand(
      monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow,
      () => { window.history.back(); },
    );
  }

  if (!activeFile) {
    return (
      <div className={["flex h-full flex-col", className].filter(Boolean).join(" ")}>
        <TabBar />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <div className="text-center">
            <p className="text-base font-medium">No file open</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Select a file from the explorer or connect a GitHub repo</p>
          </div>
        </div>
      </div>
    );
  }

  const monacoLang = MONACO_LANG[activeFile.language] ?? "plaintext";

  return (
    <div className={["flex h-full flex-col bg-[#1e1e1e]", className].filter(Boolean).join(" ")}>
      <TabBar />
      <div className="min-h-0 flex-1">
        <MonacoEditorCore
          height="100%"
          language={monacoLang}
          value={activeFile.content}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
            fontLigatures: true,
            lineNumbers: "on",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            wrappingIndent: "indent",
            tabSize: 2,
            insertSpaces: true,
            renderLineHighlight: "gutter",
            cursorBlinking: "smooth",
            smoothScrolling: true,
            formatOnPaste: true,
            formatOnType: false,
            suggest: { preview: true },
            inlineSuggest: { enabled: true },
            padding: { top: 12, bottom: 12 },
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            stickyScroll: { enabled: true },
            bracketPairColorization: { enabled: true },
          }}
          onChange={(value) => {
            if (value !== undefined && activeFile) {
              updateFile(activeFile.path, value);
            }
          }}
          onMount={handleMount}
          path={activeFile.path} // Monaco uses this as model URI — prevents language bleed between files
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-border/50 bg-card/20 px-3 py-0.5 text-[11px] text-muted-foreground/60">
        <span className="truncate">{activeFile.path}</span>
        <div className="flex items-center gap-3">
          <span>{monacoLang}</span>
          <span>UTF-8</span>
          <span>{activeFile.content.split("\n").length} lines</span>
        </div>
      </div>
    </div>
  );
});
