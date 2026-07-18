"use client";

// ── CoCode Workspace Shell ───────────────────────────────────────────────────
// Parts 1-13 UX Redesign + Engineering Bible Phases 71-80
// Layout: Explorer | Editor | Adaptive Right Panel
// Developer Mode: hides advanced systems by default

import { useEffect, useState, useRef, useMemo, lazy, Suspense, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  PanelLeftClose, PanelLeftOpen, GitBranch,
  Loader2, Upload, Zap, X, Hammer,
  ChevronDown, Terminal, Code2, ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { useUIStore } from "@/store/ui-store";
import { useCodeStore } from "@/store/code-store";
import { extractDiffs } from "@/lib/cocode/diff";
import { getAdaptivePanels, PANEL_DEFS, PANEL_GROUP_ORDER, type PanelDef } from "@/lib/cocode/adaptive-panels";
import { analyzeFiles } from "@/lib/cocode/diagnostics";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { CommandPalette } from "./command-palette";
import { WorkspaceStatusBar } from "./status-bar";
import { useSmartContextMenu, SmartContextMenu } from "./smart-context-menu";
import { SimpleTooltip } from "./ide-tooltip";
import { BuildPanel } from "./build-panel";
import type { IDEPanel } from "@/store/cocode-ide-store";

// ── Core panels ───────────────────────────────────────────────────────────────
const FileExplorer    = lazy(() => import("./file-explorer").then((m) => ({ default: m.FileExplorer })));
const MonacoEditor    = lazy(() => import("./monaco-editor").then((m) => ({ default: m.MonacoEditor })));
const DiffViewer      = lazy(() => import("./diff-viewer").then((m) => ({ default: m.DiffViewer })));
const LivePreview     = lazy(() => import("./live-preview").then((m) => ({ default: m.LivePreview })));
const KnowledgeGraphView = lazy(() => import("./knowledge-graph-view").then((m) => ({ default: m.KnowledgeGraphView })));
const CheckpointPanel = lazy(() => import("./checkpoint-panel").then((m) => ({ default: m.CheckpointPanel })));
const GitHubPanel     = lazy(() => import("./github-panel").then((m) => ({ default: m.GitHubPanel })));
const RefactorMenu    = lazy(() => import("./refactor-menu").then((m) => ({ default: m.RefactorMenu })));
const TestingAgent    = lazy(() => import("./testing-agent").then((m) => ({ default: m.TestingAgent })));
const MultiPreview    = lazy(() => import("./multi-preview").then((m) => ({ default: m.MultiPreview })));
const DependencyPanel = lazy(() => import("./dependency-panel").then((m) => ({ default: m.DependencyPanel })));
const DocsGenerator   = lazy(() => import("./docs-generator").then((m) => ({ default: m.DocsGenerator })));
const DiagnosticsPanel = lazy(() => import("./diagnostics-panel").then((m) => ({ default: m.DiagnosticsPanel })));
const PairPanel       = lazy(() => import("./pair-panel").then((m) => ({ default: m.PairPanel })));
const DeploymentPanel = lazy(() => import("./deployment-panel").then((m) => ({ default: m.DeploymentPanel })));
const CICDBuilder     = lazy(() => import("./cicd-builder").then((m) => ({ default: m.CICDBuilder })));
const CollaborationPanel = lazy(() => import("./collaboration-panel").then((m) => ({ default: m.CollaborationPanel })));
const EnvManager      = lazy(() => import("./env-manager").then((m) => ({ default: m.EnvManager })));
const PerformancePanel = lazy(() => import("./performance-panel").then((m) => ({ default: m.PerformancePanel })));
const SecurityPanel   = lazy(() => import("./security-panel").then((m) => ({ default: m.SecurityPanel })));
const ApiStudio       = lazy(() => import("./api-studio").then((m) => ({ default: m.ApiStudio })));
const DatabaseStudio  = lazy(() => import("./database-studio").then((m) => ({ default: m.DatabaseStudio })));
const AIReviewPanel   = lazy(() => import("./ai-review-panel").then((m) => ({ default: m.AIReviewPanel })));
const MobilePreview   = lazy(() => import("./mobile-preview").then((m) => ({ default: m.MobilePreview })));
const TestGeneratorPanel = lazy(() => import("./test-generator-panel").then((m) => ({ default: m.TestGeneratorPanel })));
const SemanticSearchPanel = lazy(() => import("./semantic-search-panel").then((m) => ({ default: m.SemanticSearchPanel })));
const CodeTranslatorPanel = lazy(() => import("./code-translator-panel").then((m) => ({ default: m.CodeTranslatorPanel })));
const ChangelogPanel  = lazy(() => import("./changelog-panel").then((m) => ({ default: m.ChangelogPanel })));
const ArchitecturePanel = lazy(() => import("./architecture-panel").then((m) => ({ default: m.ArchitecturePanel })));
const RuntimeMonitor  = lazy(() => import("./runtime-monitor").then((m) => ({ default: m.RuntimeMonitor })));
const AccessibilityPanel = lazy(() => import("./accessibility-panel").then((m) => ({ default: m.AccessibilityPanel })));
const I18nPanel       = lazy(() => import("./i18n-panel").then((m) => ({ default: m.I18nPanel })));
const CoveragePanel   = lazy(() => import("./coverage-panel").then((m) => ({ default: m.CoveragePanel })));
const ScaffolderPanel = lazy(() => import("./scaffolder-panel").then((m) => ({ default: m.ScaffolderPanel })));

// ── Loader fallback ────────────────────────────────────────────────────────────
function PanelLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
    </div>
  );
}

// ── AI Chat (Part 11 — Context-Aware AI) ─────────────────────────────────────

function WorkspaceChatInput({ onSend }: { onSend?: (msg: string) => void }) {
  const [message, setMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState("");
  const allFiles = useCocodeIDEStore((s) => s.allFiles);
  const activeTab = useCocodeIDEStore((s) => s.activeTab);
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const github = useCocodeIDEStore((s) => s.github);
  const diff = useCocodeIDEStore((s) => s.diff);
  const setAiStreaming = useUIStore((s) => s.setAiStreaming);

  async function send(text?: string) {
    const msg = (text ?? message).trim();
    if (!msg || streaming) return;
    setStreaming(true);
    setAiStreaming(true);
    setResponse("");
    if (!text) setMessage("");

    // Part 11: inject everything visible — file, git state, errors, tabs
    const files = allFiles();
    const contextFiles = files.slice(0, 10).map((f) => `// ${f.path}\n${f.content.slice(0, 500)}`).join("\n\n---\n\n");
    const activeContext = activeTab ? `\nCurrently editing: ${activeTab}` : "";
    const gitContext = github.connected && github.repo ? `\nGit branch: ${github.repo.branch}` : "";
    const diffContext = diff ? `\n${diff.files.length} pending change(s) awaiting review.` : "";

    const systemContext = files.length > 0
      ? `You are CoCode AI. Repository: ${files.length} files.${activeContext}${gitContext}${diffContext}\nOutput unified git diffs only — no full file rewrites.\n\nContext:\n${contextFiles}`
      : `You are CoCode AI, expert AI software engineer. Output unified git diffs only.${activeContext}${gitContext}`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: [], system: systemContext, agent: "cocode", route: "code" }),
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
      const diffs = extractDiffs(full);
      if (diffs.length) setDiff(diffs[0]);
    } finally {
      setStreaming(false);
      setAiStreaming(false);
    }
  }

  // Expose send for context menu integration
  useEffect(() => {
    if (onSend) {
      (window as unknown as Record<string, unknown>).__cocode_send = send;
    }
  });

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 bg-background/60 px-4 py-3 backdrop-blur-xl">
      {response && (
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border/40 bg-card/40 p-3 text-[13px]">
          <pre className="whitespace-pre-wrap font-sans text-foreground/80">{response}</pre>
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder="Ask CoCode… (Enter to send)"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/35 focus:border-primary/40 focus:bg-background/80 transition-colors"
        />
        <SimpleTooltip label="Send" description="Send message to CoCode AI" shortcut="Enter" side="top">
          <Button onClick={() => void send()} disabled={streaming || !message.trim()} size="icon" className="size-10 shrink-0">
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
          </Button>
        </SimpleTooltip>
      </div>
    </div>
  );
}

// ── Panel renderer ─────────────────────────────────────────────────────────────

function ActivePanel({ panel }: { panel: IDEPanel }) {
  const map: Partial<Record<IDEPanel, React.ReactNode>> = {
    diff:               <DiffViewer />,
    preview:            <LivePreview className="h-full" />,
    "multi-preview":    <MultiPreview className="h-full" />,
    github:             <GitHubPanel />,
    graph:              <KnowledgeGraphView />,
    checkpoints:        <CheckpointPanel />,
    explorer:           <RefactorMenu className="overflow-y-auto" />,
    tests:              <TestingAgent />,
    deps:               <DependencyPanel className="h-full" />,
    docs:               <DocsGenerator className="h-full" />,
    diagnostics:        <DiagnosticsPanel className="h-full" />,
    pair:               <PairPanel className="h-full" />,
    deploy:             <DeploymentPanel className="h-full" />,
    cicd:               <CICDBuilder className="h-full" />,
    collab:             <CollaborationPanel className="h-full" />,
    env:                <EnvManager className="h-full" />,
    perf:               <PerformancePanel className="h-full" />,
    security:           <SecurityPanel className="h-full" />,
    api:                <ApiStudio className="h-full" />,
    db:                 <DatabaseStudio className="h-full" />,
    mobile:             <MobilePreview className="h-full" />,
    review:             <AIReviewPanel className="h-full" />,
    testgen:            <TestGeneratorPanel className="h-full" />,
    search:             <SemanticSearchPanel className="h-full" />,
    translate:          <CodeTranslatorPanel className="h-full" />,
    changelog:          <ChangelogPanel className="h-full" />,
    arch:               <ArchitecturePanel className="h-full" />,
    runtime:            <RuntimeMonitor className="h-full" />,
    a11y:               <AccessibilityPanel className="h-full" />,
    i18n:               <I18nPanel className="h-full" />,
    coverage:           <CoveragePanel className="h-full" />,
    scaffold:           <ScaffolderPanel className="h-full" />,
  };
  return <>{map[panel] ?? null}</>;
}

// ── Overflow panel picker (Part 3 — Adaptive Sidebar) ─────────────────────────

function OverflowPanelMenu({
  panels,
  activePanel,
  onSelect,
}: {
  panels: PanelDef[];
  activePanel: IDEPanel | null;
  onSelect: (id: IDEPanel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  return (
    <div className="relative">
      <SimpleTooltip label="More panels" description="Show all available panels" side="bottom">
        <button
          ref={buttonRef}
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          More <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </SimpleTooltip>
      {open && coords && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div
            style={{ top: coords.top, right: coords.right }}
            className="fixed z-[160] w-52 max-h-[70vh] overflow-y-auto rounded-xl border border-border/60 bg-card/98 py-1.5 shadow-2xl backdrop-blur-2xl"
          >
            {PANEL_GROUP_ORDER.map((group) => {
              const groupPanels = panels.filter((p) => p.group === group);
              if (groupPanels.length === 0) return null;
              return (
                <div key={group}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                    {group}
                  </div>
                  {groupPanels.map((p) => {
                    const Icon = p.icon;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { onSelect(p.id as IDEPanel); setOpen(false); }}
                        className={cn(
                          "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5",
                          activePanel === p.id && "bg-primary/10",
                        )}
                      >
                        <Icon className={cn("size-3.5 mt-0.5 shrink-0", activePanel === p.id ? "text-primary" : "text-muted-foreground/70")} />
                        <span className="flex flex-col gap-0.5">
                          <span className={cn("text-[12px] font-medium", activePanel === p.id ? "text-primary" : "text-foreground/80")}>{p.label}</span>
                          <span className="text-[10px] text-muted-foreground/50 leading-tight">{p.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── Main Workspace ────────────────────────────────────────────────────────────

export function CoCodeWorkspace() {
  const explorerOpen   = useCocodeIDEStore((s) => s.explorerOpen);
  const toggleExplorer = useCocodeIDEStore((s) => s.toggleExplorer);
  const rightPanel     = useCocodeIDEStore((s) => s.rightPanel);
  const setRightPanel  = useCocodeIDEStore((s) => s.setRightPanel);
  const projectName    = useCocodeIDEStore((s) => s.projectName);
  const github         = useCocodeIDEStore((s) => s.github);
  const diff           = useCocodeIDEStore((s) => s.diff);
  const canUndo        = useCocodeIDEStore((s) => s.canUndo);
  const undo           = useCocodeIDEStore((s) => s.undo);
  const canRedo        = useCocodeIDEStore((s) => s.canRedo);
  const redo           = useCocodeIDEStore((s) => s.redo);
  const importFiles    = useCocodeIDEStore((s) => s.importFiles);
  const activeTab      = useCocodeIDEStore((s) => s.activeTab);
  const hasFiles        = useCocodeIDEStore((s) => s.fs.children.length > 0);
  const fs              = useCocodeIDEStore((s) => s.fs);

  const aiStreaming = useUIStore((s) => s.aiStreaming);
  const codeBuilding = useCodeStore((s) => s.building);
  const codeBuildError = useCodeStore((s) => s.buildError);
  const codePhase = useCodeStore((s) => s.phase);
  const buildStatus = codeBuilding ? "building" : codeBuildError ? "error" : codePhase === "done" ? "success" : "idle";

  // Debounce so typing doesn't re-run the diagnostics scan on every keystroke.
  const [debouncedFs, setDebouncedFs] = useState(fs);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFs(fs), 800);
    return () => clearTimeout(t);
  }, [fs]);
  const tsErrorCount = useMemo(() => {
    const files = flattenFiles(debouncedFs).map((f) => ({ path: f.path, content: f.content }));
    return analyzeFiles(files).filter((d) => d.severity === "error").length;
  }, [debouncedFs]);

  // Build (conversational + Titan) is a full-view mode inside the workspace,
  // not a side panel — the conversation UI needs full width. New/empty
  // projects land here by default; existing projects open to the editor.
  // Lives in the shared store (not local state) so generation completing
  // can switch the workspace into the editor automatically.
  const viewMode    = useCocodeIDEStore((s) => s.viewMode);
  const setViewMode = useCocodeIDEStore((s) => s.setViewMode);

  const developerMode       = useUIStore((s) => s.developerMode);
  const toggleDeveloperMode = useUIStore((s) => s.toggleDeveloperMode);
  const commandPaletteOpen  = useUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);

  // Part 7 — Smart Context Menu
  const { position: ctxPos, selection: ctxSel, close: closeCtx } = useSmartContextMenu();

  // Part 3 — Adaptive panel list driven by current file context
  const { primary: primaryPanels, overflow: overflowPanels } = getAdaptivePanels(activeTab, developerMode);

  const activePanel = rightPanel as IDEPanel | null;
  const showRightPanel = activePanel !== null;

  // Part 9 — Command Palette keyboard shortcut (Ctrl+Shift+P)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "`") {
        e.preventDefault();
        toggleDeveloperMode();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        // Monaco handles its own undo; only intercept when editor not focused
        const active = document.activeElement;
        if (active?.tagName === "BODY" || active?.closest(".cocode-workspace-outer")) {
          e.preventDefault();
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        const active = document.activeElement;
        if (active?.tagName === "BODY" || active?.closest(".cocode-workspace-outer")) {
          e.preventDefault();
          redo();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandPaletteOpen, toggleDeveloperMode, undo, redo]);

  // Handle GitHub OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
      fetch("/api/github?path=/user")
        .then((r) => r.json())
        .then((user: { login?: string; name?: string; avatar_url?: string }) => {
          if (user.login) {
            useCocodeIDEStore.setState((s) => ({
              github: { ...s.github, connected: true, user: { login: user.login!, name: user.name ?? null, avatar_url: user.avatar_url ?? "" } },
            }));
          }
        })
        .catch(() => {});
    }
  }, []);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const loaded = await Promise.all(files.map(async (f) => ({ path: f.name, content: await f.text() })));
    importFiles(loaded);
  }

  function handleSendToChat(text: string) {
    const fn = (window as unknown as Record<string, unknown>).__cocode_send;
    if (typeof fn === "function") (fn as (t: string) => void)(text);
  }

  return (
    <div className="cocode-workspace-outer flex h-full flex-col overflow-hidden">
      {/* ── Command Palette (Part 9) ──────────────────────────────────────── */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        developerMode={developerMode}
        onToggleDeveloperMode={toggleDeveloperMode}
      />

      {/* ── Smart Context Menu (Part 7) ───────────────────────────────────── */}
      <SmartContextMenu
        position={ctxPos}
        selection={ctxSel}
        onClose={closeCtx}
        onSendToChat={handleSendToChat}
      />

      {viewMode === "build" ? (
        <>
          {/* ── Build Titlebar ───────────────────────────────────────────────── */}
          <div className="flex h-10 items-center gap-2 border-b border-border/60 bg-card/50 px-3">
            <Hammer className="size-3.5 text-primary" />
            <span className="text-[13px] font-medium text-foreground">Build</span>
            <span className="text-muted-foreground">·</span>
            <span className="max-w-[160px] truncate text-[13px] text-muted-foreground">{projectName}</span>
            <SimpleTooltip
              label="Open Editor"
              description={hasFiles ? "Switch to the file explorer and code editor" : "Switch to the file explorer — upload files or connect GitHub"}
              side="bottom"
            >
              <button
                type="button"
                onClick={() => setViewMode("editor")}
                className="ml-auto flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
              >
                <Code2 className="size-3" />
                Open Editor
              </button>
            </SimpleTooltip>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <BuildPanel />
          </div>
        </>
      ) : (
        <>
      {/* ── Workspace Titlebar ────────────────────────────────────────────── */}
      <div className="flex h-10 items-center gap-2 border-b border-border/60 bg-card/50 px-3">
        {/* Part 1 — Hover tooltips on every button */}
        <SimpleTooltip
          label={explorerOpen ? "Hide Explorer" : "Show Explorer"}
          description="Toggle the file explorer panel"
          shortcut="Ctrl+B"
          side="bottom"
        >
          <button
            type="button"
            onClick={toggleExplorer}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            {explorerOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
        </SimpleTooltip>

        <span className="text-[13px] font-medium text-muted-foreground truncate max-w-[120px]">{projectName}</span>

        {github.repo && (
          <SimpleTooltip label="Git Branch" description={`Active branch: ${github.repo.branch}`} side="bottom">
            <button
              type="button"
              onClick={() => setRightPanel("github")}
              className="flex items-center gap-1 rounded-md border border-border/40 px-1.5 py-0.5 text-[11px] text-muted-foreground/70 hover:border-primary/30 hover:text-foreground transition-colors"
            >
              <GitBranch className="size-3" />
              {github.repo.branch}
            </button>
          </SimpleTooltip>
        )}

        {/* Part 5 — Developer Mode badge */}
        {developerMode && (
          <SimpleTooltip
            label="Developer Mode ON"
            description="Advanced AI tools are visible. Press Ctrl+Shift+` to toggle."
            shortcut="Ctrl+Shift+`"
            side="bottom"
          >
            <button
              type="button"
              onClick={toggleDeveloperMode}
              className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              <Code2 className="size-3" />
              DEV
            </button>
          </SimpleTooltip>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Undo */}
          <SimpleTooltip label="Undo" description="Undo last change" shortcut="Ctrl+Z" side="bottom">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-25"
            >
              <svg viewBox="0 0 16 16" className="size-3.5 fill-current"><path d="M3.5 3.5v3h3V5h-1.5l1.5-1.5L8 5v1h-2v2H7.5L9 6.5l1.5 1.5H9v1h-1.5v3h5v-3h-1.5l-1.5 1.5V8.5H7V6.5h3v-2L8.5 3 7 4.5V3.5h-3z" /></svg>
            </button>
          </SimpleTooltip>

          {/* Redo */}
          <SimpleTooltip label="Redo" description="Redo last undone change" shortcut="Ctrl+Y" side="bottom">
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-25"
            >
              <svg viewBox="0 0 16 16" className="size-3.5 fill-current scale-x-[-1]"><path d="M3.5 3.5v3h3V5h-1.5l1.5-1.5L8 5v1h-2v2H7.5L9 6.5l1.5 1.5H9v1h-1.5v3h5v-3h-1.5l-1.5 1.5V8.5H7V6.5h3v-2L8.5 3 7 4.5V3.5h-3z" /></svg>
            </button>
          </SimpleTooltip>

          {/* Upload */}
          <SimpleTooltip label="Upload Files" description="Import local files into the workspace" side="bottom">
            <label className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground">
              <Upload className="size-3.5" />
              <input type="file" multiple className="hidden" onChange={handleFileUpload} />
            </label>
          </SimpleTooltip>

          {/* Back to CoCode */}
          <SimpleTooltip label="Back to CoCode" description="Return to the CoCode chat/build view" side="bottom">
            <button
              type="button"
              onClick={() => setViewMode("build")}
              className="flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              Back to CoCode
            </button>
          </SimpleTooltip>

          {/* Command Palette button */}
          <SimpleTooltip label="Command Palette" description="Search all commands, panels, and actions" shortcut="Ctrl+Shift+P" side="bottom">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              <Terminal className="size-3" />
              <span className="hidden sm:inline">Ctrl+Shift+P</span>
            </button>
          </SimpleTooltip>

          {/* Diff badge */}
          {diff && diff.files.length > 0 && (
            <SimpleTooltip label="Pending Changes" description={`${diff.files.length} file(s) with AI-generated changes awaiting review`} side="bottom">
              <button
                type="button"
                onClick={() => setRightPanel("diff")}
                className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-400 hover:bg-amber-500/25 transition-colors"
              >
                <Zap className="size-3" />
                {diff.files.length} change{diff.files.length !== 1 ? "s" : ""}
              </button>
            </SimpleTooltip>
          )}
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* File Explorer */}
        {explorerOpen && (
          <div className="w-56 shrink-0 border-r border-border/60">
            <Suspense fallback={<PanelLoader />}>
              <FileExplorer />
            </Suspense>
          </div>
        )}

        {/* Editor + Chat */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<PanelLoader />}>
            <MonacoEditor className="min-h-0 flex-1" />
          </Suspense>
          <WorkspaceChatInput />
        </div>

        {/* Right panel — adaptive (Part 3) */}
        {showRightPanel && (
          <div className="flex w-96 min-w-0 shrink-0 flex-col border-l border-border/60">
            {/* Part 3 — Adaptive tab strip */}
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-card/30 px-1 py-1 no-scrollbar">
              {primaryPanels.map((p) => {
                const def = PANEL_DEFS[p.id];
                if (!def) return null;
                const isActive = activePanel === p.id;
                const Icon = def.icon;
                return (
                  <SimpleTooltip
                    key={p.id}
                    label={def.label}
                    description={def.description}
                    shortcut={def.shortcut}
                    side="bottom"
                    delay={500}
                  >
                    <button
                      type="button"
                      onClick={() => setRightPanel(isActive ? null : p.id as IDEPanel)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
                        isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5",
                      )}
                    >
                      <Icon className="size-3" />
                      {p.label}
                    </button>
                  </SimpleTooltip>
                );
              })}

              {/* Overflow — non-primary panels */}
              {overflowPanels.length > 0 && (
                <OverflowPanelMenu
                  panels={overflowPanels}
                  activePanel={activePanel}
                  onSelect={(id) => setRightPanel(id)}
                />
              )}

              <button
                type="button"
                onClick={() => setRightPanel(null)}
                className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Panel content */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<PanelLoader />}>
                <ActivePanel panel={activePanel!} />
              </Suspense>
            </div>
          </div>
        )}

        {/* Collapsed right rail — icon strip */}
        {!showRightPanel && (
          <div className="flex w-10 flex-col items-center gap-0.5 border-l border-border/60 bg-sidebar/40 py-2">
            {primaryPanels.slice(0, 12).map((p) => {
              const def = PANEL_DEFS[p.id];
              if (!def) return null;
              const Icon = def.icon;
              return (
                <SimpleTooltip key={p.id} label={def.label} description={def.description} side="left" delay={300}>
                  <button
                    type="button"
                    onClick={() => setRightPanel(p.id as IDEPanel)}
                    className="flex w-8 items-center justify-center rounded-md py-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    <Icon className="size-4" />
                  </button>
                </SimpleTooltip>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Status Bar (Part 8) ──────────────────────────────────────────────── */}
      <WorkspaceStatusBar
        tsErrorCount={tsErrorCount}
        buildStatus={buildStatus}
        aiStatus={aiStreaming ? "streaming" : "idle"}
      />
        </>
      )}
    </div>
  );
}
