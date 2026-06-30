"use client";

// ── CoCode IDE Shell (Phases 1–20) ────────────────────────────────────────────
// Full IDE layout: Explorer | Editor | Right Panel
// Right panel: Diff | Preview | Graph | Checkpoints | GitHub | Refactor | Tests
// AI chat is context-aware — repo files injected into every request.

import { useEffect, useState, lazy, Suspense } from "react";
import {
  PanelLeftClose, PanelLeftOpen, GitBranch, Network,
  History, Eye, Github, Wrench, FlaskConical,
  SplitSquareHorizontal, Loader2, Hammer, Upload, Zap, X,
  MousePointer2, Palette, Laptop, Package2, BookOpen,
  AlertCircle, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { WorkflowIndicator } from "./workflow-indicator";
import { extractDiffs } from "@/lib/cocode/diff";

// Lazy-load heavy components
const FileExplorer = lazy(() => import("./file-explorer").then((m) => ({ default: m.FileExplorer })));
const MonacoEditor = lazy(() => import("./monaco-editor").then((m) => ({ default: m.MonacoEditor })));
const DiffViewer = lazy(() => import("./diff-viewer").then((m) => ({ default: m.DiffViewer })));
const LivePreview = lazy(() => import("./live-preview").then((m) => ({ default: m.LivePreview })));
const KnowledgeGraphView = lazy(() => import("./knowledge-graph-view").then((m) => ({ default: m.KnowledgeGraphView })));
const CheckpointPanel = lazy(() => import("./checkpoint-panel").then((m) => ({ default: m.CheckpointPanel })));
const GitHubPanel = lazy(() => import("./github-panel").then((m) => ({ default: m.GitHubPanel })));
const RefactorMenu = lazy(() => import("./refactor-menu").then((m) => ({ default: m.RefactorMenu })));
const TestingAgent = lazy(() => import("./testing-agent").then((m) => ({ default: m.TestingAgent })));
const DesignInspector = lazy(() => import("./design-inspector").then((m) => ({ default: m.DesignInspector })));
const MultiPreview = lazy(() => import("./multi-preview").then((m) => ({ default: m.MultiPreview })));
const DependencyPanel = lazy(() => import("./dependency-panel").then((m) => ({ default: m.DependencyPanel })));
const DocsGenerator = lazy(() => import("./docs-generator").then((m) => ({ default: m.DocsGenerator })));
const DiagnosticsPanel = lazy(() => import("./diagnostics-panel").then((m) => ({ default: m.DiagnosticsPanel })));
const PairPanel = lazy(() => import("./pair-panel").then((m) => ({ default: m.PairPanel })));

// ── AI Chat with Repo Context (Phase 6) ──────────────────────────────────────

function IDEChatInput() {
  const [message, setMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState("");
  const allFiles = useCocodeIDEStore((s) => s.allFiles);
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const classifyRequest = useCocodeIDEStore((s) => s.classifyRequest);
  const workflow = useCocodeIDEStore((s) => s.workflow);

  async function send() {
    const msg = message.trim();
    if (!msg || streaming) return;

    // Phase 11: classify workflow before sending
    classifyRequest(msg);

    setStreaming(true);
    setResponse("");
    setMessage("");

    // Build repo context for Phase 6 — inject relevant files via knowledge graph
    const files = allFiles();
    const contextFiles = files.slice(0, 10).map((f) => `// ${f.path}\n${f.content.slice(0, 500)}`).join("\n\n---\n\n");

    const systemContext = files.length > 0
      ? `You are CoCode AI. You have access to this repository (${files.length} files). When generating code changes, always output unified git diffs. Never output full file rewrites — only diffs.\n\nRepository context:\n${contextFiles}`
      : "You are CoCode AI, an expert AI software engineer. When generating code changes, output unified git diffs.";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: [],
          system: systemContext,
          agent: "cocode",
          route: "code",
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setResponse((err as { error?: string }).error ?? "Request failed");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setResponse(full);
      }

      // Auto-extract diffs from response
      const diffs = extractDiffs(full);
      if (diffs.length) setDiff(diffs[0]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border/70 bg-background/60 px-4 py-3 backdrop-blur-xl">
      {/* Workflow indicator */}
      {workflow && <WorkflowIndicator />}

      {/* Response */}
      {response && (
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/40 p-3 text-[13px]">
          <pre className="whitespace-pre-wrap font-sans">{response}</pre>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder="Ask CoCode to modify the repository… (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/40 focus:border-primary/40 focus:bg-background/80"
        />
        <Button onClick={() => void send()} disabled={streaming || !message.trim()}>
          {streaming ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

// ── Right panel tab config ────────────────────────────────────────────────────

const RIGHT_PANELS = [
  { id: "diff" as const, icon: SplitSquareHorizontal, label: "Diff" },
  { id: "preview" as const, icon: Eye, label: "Preview" },
  { id: "multi-preview" as const, icon: Laptop, label: "Devices" },
  { id: "github" as const, icon: Github, label: "GitHub" },
  { id: "graph" as const, icon: Network, label: "Graph" },
  { id: "checkpoints" as const, icon: History, label: "History" },
  { id: "explorer" as const, icon: Wrench, label: "Refactor" },
  { id: "tests" as const, icon: FlaskConical, label: "Tests" },
  { id: "design" as const, icon: Palette, label: "Design" },
  { id: "deps" as const, icon: Package2, label: "Deps" },
  { id: "docs" as const, icon: BookOpen, label: "Docs" },
  { id: "diagnostics" as const, icon: AlertCircle, label: "Issues" },
  { id: "pair" as const, icon: Bot, label: "Pair" },
] as const;

type PanelId = typeof RIGHT_PANELS[number]["id"];

// ── Main IDE layout ────────────────────────────────────────────────────────────

export function CocodeIDE() {
  const explorerOpen = useCocodeIDEStore((s) => s.explorerOpen);
  const toggleExplorer = useCocodeIDEStore((s) => s.toggleExplorer);
  const rightPanel = useCocodeIDEStore((s) => s.rightPanel);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);
  const projectName = useCocodeIDEStore((s) => s.projectName);
  const github = useCocodeIDEStore((s) => s.github);
  const diff = useCocodeIDEStore((s) => s.diff);
  const canUndo = useCocodeIDEStore((s) => s.canUndo);
  const undo = useCocodeIDEStore((s) => s.undo);
  const canRedo = useCocodeIDEStore((s) => s.canRedo);
  const redo = useCocodeIDEStore((s) => s.redo);
  const importFiles = useCocodeIDEStore((s) => s.importFiles);

  // Handle GitHub OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
      // Fetch user to confirm connection
      fetch("/api/github?path=/user")
        .then((r) => r.json())
        .then((user: { login?: string; name?: string; avatar_url?: string }) => {
          if (user.login) {
            useCocodeIDEStore.setState((s) => ({
              github: { ...s.github, connected: true, user: {
                login: user.login!,
                name: user.name ?? null,
                avatar_url: user.avatar_url ?? "",
              }},
            }));
          }
        })
        .catch(() => {});
    }
  }, []);

  // File upload (Phase 5)
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const loaded = await Promise.all(
      files.map(async (f) => {
        const content = await f.text();
        return { path: f.name, content };
      }),
    );
    importFiles(loaded);
  }

  const activePanel = rightPanel as PanelId | null;
  const showRightPanel = activePanel !== null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── IDE Titlebar ───────────────────────────────────────────────────── */}
      <div className="flex h-10 items-center gap-2 border-b border-border/70 bg-card/50 px-3">
        <button
          type="button"
          onClick={toggleExplorer}
          className="rounded p-1.5 text-muted-foreground hover:text-foreground"
          title={explorerOpen ? "Hide Explorer" : "Show Explorer"}
        >
          {explorerOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>

        <span className="text-[13px] font-medium text-muted-foreground">{projectName}</span>

        {github.repo && (
          <div className="flex items-center gap-1 rounded-md border border-border/50 px-1.5 py-0.5 text-[11px] text-muted-foreground/70">
            <GitBranch className="size-3" />
            {github.repo.branch}
          </div>
        )}

        {/* Undo/Redo (Phase 20) */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          >
            <svg viewBox="0 0 16 16" className="size-3.5 fill-current"><path d="M3.5 3.5v3h3V5h-1.5l1.5-1.5L8 5v1h-2v2H7.5L9 6.5l1.5 1.5H9v1h-1.5v3h5v-3h-1.5l-1.5 1.5V8.5H7V6.5h3v-2L8.5 3 7 4.5V3.5h-3z"/></svg>
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Redo (Ctrl+Y)"
          >
            <svg viewBox="0 0 16 16" className="size-3.5 fill-current scale-x-[-1]"><path d="M3.5 3.5v3h3V5h-1.5l1.5-1.5L8 5v1h-2v2H7.5L9 6.5l1.5 1.5H9v1h-1.5v3h5v-3h-1.5l-1.5 1.5V8.5H7V6.5h3v-2L8.5 3 7 4.5V3.5h-3z"/></svg>
          </button>

          {/* Upload files */}
          <label className="cursor-pointer rounded p-1.5 text-muted-foreground hover:text-foreground" title="Upload files">
            <Upload className="size-3.5" />
            <input type="file" multiple className="hidden" onChange={handleFileUpload} />
          </label>

          {/* Diff badge */}
          {diff && diff.files.length > 0 && (
            <button
              type="button"
              onClick={() => setRightPanel("diff")}
              className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-400 hover:bg-amber-500/25"
            >
              <Zap className="size-3" />
              {diff.files.length} change{diff.files.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* File Explorer (Phase 5) */}
        {explorerOpen && (
          <div className="w-56 shrink-0">
            <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}>
              <FileExplorer />
            </Suspense>
          </div>
        )}

        {/* Editor + Chat (Phase 5, 6) */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
            <MonacoEditor className="min-h-0 flex-1" />
          </Suspense>
          <IDEChatInput />
        </div>

        {/* Right panel (Diff, Preview, GitHub, Graph, etc.) */}
        {showRightPanel && (
          <div className="flex w-96 min-w-0 shrink-0 flex-col border-l border-border/70">
            {/* Panel tab strip */}
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/70 bg-card/30 px-1 py-1 no-scrollbar">
              {RIGHT_PANELS.map((p) => {
                const Icon = p.icon;
                const isActive = activePanel === p.id;
                // Map "explorer" panel id to tests, refactor etc.
                const panelId = p.id === "explorer" ? "explorer" : p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setRightPanel(isActive ? null : panelId as typeof rightPanel)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3" />
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setRightPanel(null)}
                className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Panel content — lazy loaded */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}>
                {activePanel === "diff" && <DiffViewer />}
                {activePanel === "preview" && <LivePreview className="h-full" />}
                {activePanel === "multi-preview" && <MultiPreview className="h-full" />}
                {activePanel === "github" && <GitHubPanel />}
                {activePanel === "graph" && <KnowledgeGraphView />}
                {activePanel === "checkpoints" && <CheckpointPanel />}
                {activePanel === "explorer" && <RefactorMenu className="overflow-y-auto" />}
                {activePanel === "tests" && <TestingAgent />}
                {activePanel === "design" && <DesignInspector className="h-full" />}
                {activePanel === "deps" && <DependencyPanel className="h-full" />}
                {activePanel === "docs" && <DocsGenerator className="h-full" />}
                {activePanel === "diagnostics" && <DiagnosticsPanel className="h-full" />}
                {activePanel === "pair" && <PairPanel className="h-full" />}
              </Suspense>
            </div>
          </div>
        )}

        {/* Collapsed right panel — show tab strip vertically */}
        {!showRightPanel && (
          <div className="flex w-10 flex-col items-center gap-1 border-l border-border/70 bg-sidebar/50 py-2">
            {RIGHT_PANELS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setRightPanel(p.id as typeof rightPanel)}
                  title={p.label}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
