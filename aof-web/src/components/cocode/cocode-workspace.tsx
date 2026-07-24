"use client";

// ── CoCode Workspace Shell ───────────────────────────────────────────────────
// Agent / Editor / Preview coexist in one workspace: a resizable Agent | Stage
// split on desktop, a segmented Agent/Editor/Preview/Diff switch on narrow
// screens. Panel components, the tab strip/overflow menu, the collapsed rail,
// and small standalone effects (keyboard shortcuts, GitHub OAuth callback,
// file upload) live in sibling modules — this file is composition. Developer
// Mode reveals the advanced Developer Tools drawer (~30 panels, grouped
// Build/Understand/Verify/Ship).

import { useEffect, useState, useRef, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  PanelLeftClose, PanelLeftOpen, GitBranch, Upload,
  Terminal, Code2, Eye, SplitSquareHorizontal, Wrench,
  PanelRightClose, FolderKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { useUIStore } from "@/store/ui-store";
import { useCodeStore } from "@/store/code-store";
import { getAdaptivePanels } from "@/lib/cocode/adaptive-panels";
import { analyzeFiles } from "@/lib/cocode/diagnostics";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { ensureWorkspaceLoaded, ensureProjectForWorkspace } from "@/lib/cocode/open-project";
import { WorkspaceStatusBar } from "./status-bar";
import { useSmartContextMenu, SmartContextMenu } from "./smart-context-menu";
import { SimpleTooltip } from "./ide-tooltip";
import { AgentPanel } from "./agent-panel";
import { FileExplorer, MonacoEditor, ActivePanel, PanelLoader } from "./panel-host";
import { PanelTabStrip } from "./panel-tab-strip";
import { CollapsedRail } from "./collapsed-rail";
import { useWorkspaceKeyboard } from "./use-workspace-keyboard";
import { useGithubOAuthCallback } from "./use-github-callback";
import { useWorkspaceUpload } from "./use-workspace-upload";
import type { IDEPanel } from "@/store/cocode-ide-store";

// ── Developer Tools drawer — overlay housing the advanced panel set ──────────
// Reuses the shared PanelTabStrip (grouped Build/Understand/Verify/Ship
// overflow menu) rather than a bespoke tab strip.

function DevToolsDrawer({
  activePanel,
  primaryPanels,
  overflowPanels,
  onSelect,
  onClose,
}: {
  activePanel: IDEPanel;
  primaryPanels: ReturnType<typeof getAdaptivePanels>["primary"];
  overflowPanels: ReturnType<typeof getAdaptivePanels>["overflow"];
  onSelect: (id: IDEPanel | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border/60 bg-card/98 shadow-2xl backdrop-blur-2xl sm:w-96">
      <PanelTabStrip
        primaryPanels={primaryPanels}
        overflowPanels={overflowPanels}
        activePanel={activePanel}
        onSelect={onSelect}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<PanelLoader />}>
          <ActivePanel panel={activePanel} />
        </Suspense>
      </div>
    </div>
  );
}

// ── Workspace stage — Editor / Preview / Diff content ─────────────────────────

function StageBody({
  stage,
  explorerOpen,
}: {
  stage: "editor" | "preview" | "diff";
  explorerOpen: boolean;
}) {
  if (stage === "diff") {
    return (
      <Suspense fallback={<PanelLoader />}>
        <ActivePanel panel="diff" />
      </Suspense>
    );
  }
  if (stage === "preview") {
    return (
      <Suspense fallback={<PanelLoader />}>
        <ActivePanel panel="preview" />
      </Suspense>
    );
  }
  return (
    <div className="flex h-full min-w-0">
      {explorerOpen && (
        <div className="w-[clamp(180px,18vw,224px)] shrink-0 border-r border-border/60">
          <Suspense fallback={<PanelLoader />}>
            <FileExplorer />
          </Suspense>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<PanelLoader />}>
          <MonacoEditor className="h-full" />
        </Suspense>
      </div>
    </div>
  );
}

// ── Stage switch — the Editor/Preview/Diff segmented control ─────────────────

function StageSwitch({
  stage,
  onChange,
  diffCount,
}: {
  stage: "editor" | "preview" | "diff";
  onChange: (stage: "editor" | "preview" | "diff") => void;
  diffCount: number;
}) {
  const items: Array<{ id: "editor" | "preview" | "diff"; label: string; icon: typeof Code2 }> = [
    { id: "editor", label: "Editor", icon: Code2 },
    { id: "preview", label: "Preview", icon: Eye },
    { id: "diff", label: "Diff", icon: SplitSquareHorizontal },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
      {items.map((it) => {
        const Icon = it.icon;
        const active = stage === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            aria-label={it.label}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-medium transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {it.label}
            {it.id === "diff" && diffCount > 0 && (
              <span className="rounded-full bg-accent-warm/20 px-1.5 py-0 text-micro font-semibold text-accent-warm">
                {diffCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Narrow segmented view — Agent/Editor/Preview/Diff ─────────────────────────

function MobileSegmented({
  mobileView,
  onChange,
  diffCount,
}: {
  mobileView: "agent" | "editor" | "preview" | "diff";
  onChange: (view: "agent" | "editor" | "preview" | "diff") => void;
  diffCount: number;
}) {
  const items: Array<{ id: "agent" | "editor" | "preview" | "diff"; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "editor", label: "Editor" },
    { id: "preview", label: "Preview" },
    { id: "diff", label: `Diff${diffCount > 0 ? ` (${diffCount})` : ""}` },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          aria-label={it.label}
          className={cn(
            "flex-1 rounded-md px-2 py-1.5 text-caption font-medium transition-colors",
            mobileView === it.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.label}
        </button>
      ))}
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
  const activeTab      = useCocodeIDEStore((s) => s.activeTab);
  const fs             = useCocodeIDEStore((s) => s.fs);
  const projectId      = useCocodeIDEStore((s) => s.projectId);

  // Reconcile persistence on every project-identity / fs change:
  //  - a project is open → load its saved files if this session hasn't yet
  //    (a direct landing on /code: localStorage restores `projectId` via
  //    cocode-ide-store's partialize, but never `fs` — too large to persist
  //    there — so a hard reload otherwise leaves the workspace pointed at a
  //    project whose real files were never fetched);
  //  - no project is open but the session has real files (built directly at
  //    /code, never routed through the Projects list) → lazily create one so
  //    this work has somewhere to be saved, per lib/cocode/open-project.ts.
  // Both are no-ops once already satisfied, and no-op entirely in demo mode /
  // when signed out.
  useEffect(() => {
    if (projectId) {
      ensureWorkspaceLoaded(projectId);
    } else if (fs.children.length > 0) {
      void ensureProjectForWorkspace();
    }
    // Only re-run when the project identity or the file set actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, fs]);

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

  // Workspace stage — the center pane's content, alongside the always-
  // available Agent pane (desktop resizable split) or as one of the
  // segmented views (narrow). See cocode-ide-store.ts for the full model.
  const stage        = useCocodeIDEStore((s) => s.stage);
  const setStage     = useCocodeIDEStore((s) => s.setStage);
  const agentOpen    = useCocodeIDEStore((s) => s.agentOpen);
  const setAgentOpen = useCocodeIDEStore((s) => s.setAgentOpen);
  const agentPaneSize = useCocodeIDEStore((s) => s.agentPaneSize);
  const setAgentPaneSize = useCocodeIDEStore((s) => s.setAgentPaneSize);
  const mobileView    = useCocodeIDEStore((s) => s.mobileView);
  const setMobileView = useCocodeIDEStore((s) => s.setMobileView);

  const agentPanelRef = useRef<ImperativePanelHandle>(null);
  const toggleAgentPane = useCallback(() => {
    const panel = agentPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, []);

  function goToStage(next: "editor" | "preview" | "diff") {
    setStage(next);
    setMobileView(next);
  }

  const developerMode = useUIStore((s) => s.developerMode);

  // Part 7 — Smart Context Menu
  const { position: ctxPos, selection: ctxSel, close: closeCtx } = useSmartContextMenu();

  // Adaptive panel list driven by current file context, grouped into
  // Build/Understand/Verify/Ship (adaptive-panels.ts). "diff" and "preview"
  // are primary workspace stages now, not drawer panels, so they're excluded
  // from the drawer's tab strip.
  const { primary: rawPrimary, overflow: rawOverflow } = getAdaptivePanels(activeTab, developerMode);
  const primaryPanels = useMemo(() => rawPrimary.filter((p) => p.id !== "diff" && p.id !== "preview"), [rawPrimary]);
  const overflowPanels = useMemo(() => rawOverflow.filter((p) => p.id !== "diff" && p.id !== "preview"), [rawOverflow]);

  const activePanel = rightPanel as IDEPanel | null;
  const showDrawer = activePanel !== null;

  useWorkspaceKeyboard(undo, redo);
  useGithubOAuthCallback();
  const handleFileUpload = useWorkspaceUpload();

  const diffCount = diff?.files.length ?? 0;

  return (
    <div className="cocode-workspace-outer flex h-full flex-col overflow-hidden">
      {/* Command palette is global — rendered by (app)/layout. */}

      {/* ── Smart Context Menu (Part 7) ───────────────────────────────────── */}
      <SmartContextMenu
        position={ctxPos}
        selection={ctxSel}
        onClose={closeCtx}
        onSendToChat={(text) => void useCodeStore.getState().sendMessage(text)}
      />

      {/* ── Shared Titlebar ───────────────────────────────────────────────── */}
      {/* Responsive: text labels drop below `sm`, every button stays icon-only
         so the bar never wraps; `overflow-x-auto` is a safety net. */}
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-card/50 px-2 no-scrollbar sm:gap-1.5 sm:px-3">
        {(stage === "editor" || mobileView === "editor") && (
          <SimpleTooltip
            label={explorerOpen ? "Hide Explorer" : "Show Explorer"}
            description="Toggle the file explorer panel"
            shortcut="Ctrl+B"
            side="bottom"
          >
            <button
              type="button"
              onClick={toggleExplorer}
              aria-label={explorerOpen ? "Hide Explorer" : "Show Explorer"}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              {explorerOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
          </SimpleTooltip>
        )}

        <span className="min-w-[3.5rem] flex-1 truncate text-body-sm font-medium text-muted-foreground sm:max-w-[160px] sm:flex-none">
          {projectName}
        </span>

        <SimpleTooltip label="Switch Project" description="Go to your projects list" side="bottom">
          <Link
            href="/projects"
            aria-label="Switch project"
            className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 px-1.5 py-0.5 text-caption text-muted-foreground/70 transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <FolderKanban className="size-3" />
          </Link>
        </SimpleTooltip>

        {github.repo && (
          <SimpleTooltip label="Git Branch" description={`Active branch: ${github.repo.branch}`} side="bottom">
            <button
              type="button"
              onClick={() => setRightPanel("github")}
              aria-label={`Git branch: ${github.repo.branch}`}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 px-1.5 py-0.5 text-caption text-muted-foreground/70 hover:border-primary/30 hover:text-foreground transition-colors"
            >
              <GitBranch className="size-3" />
              <span className="hidden max-w-[100px] truncate sm:inline">{github.repo.branch}</span>
            </button>
          </SimpleTooltip>
        )}

        {developerMode && (
          <SimpleTooltip
            label="Developer Mode ON"
            description="Advanced AI tools are visible. Press Ctrl+Shift+` to toggle."
            shortcut="Ctrl+Shift+`"
            side="bottom"
          >
            <button
              type="button"
              onClick={() => useUIStore.getState().toggleDeveloperMode()}
              aria-label="Developer Mode on — click to turn off"
              className="flex shrink-0 items-center gap-1 rounded-md border border-accent-warm/30 bg-accent-warm/10 px-1.5 py-0.5 text-micro font-semibold text-accent-warm hover:bg-accent-warm/20 transition-colors"
            >
              <Code2 className="size-3" />
              <span className="hidden sm:inline">DEV</span>
            </button>
          </SimpleTooltip>
        )}

        <div className="hidden md:block">
          <StageSwitch stage={stage} onChange={goToStage} diffCount={diffCount} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          <SimpleTooltip
            label={agentOpen ? "Hide Agent" : "Show Agent"}
            description="Toggle the Ask CoCode panel"
            side="bottom"
          >
            <button
              type="button"
              onClick={toggleAgentPane}
              aria-label={agentOpen ? "Hide Agent" : "Show Agent"}
              className={cn(
                "hidden rounded-md p-1.5 transition-colors hover:bg-foreground/5 md:block",
                agentOpen ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PanelRightClose className="size-3.5" />
            </button>
          </SimpleTooltip>

          <SimpleTooltip label="Undo" description="Undo last change" shortcut="Ctrl+Z" side="bottom">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-25"
            >
              <svg viewBox="0 0 16 16" className="size-3.5 fill-current"><path d="M3.5 3.5v3h3V5h-1.5l1.5-1.5L8 5v1h-2v2H7.5L9 6.5l1.5 1.5H9v1h-1.5v3h5v-3h-1.5l-1.5 1.5V8.5H7V6.5h3v-2L8.5 3 7 4.5V3.5h-3z" /></svg>
            </button>
          </SimpleTooltip>

          <SimpleTooltip label="Redo" description="Redo last undone change" shortcut="Ctrl+Y" side="bottom">
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
              className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-25 sm:block"
            >
              <svg viewBox="0 0 16 16" className="size-3.5 fill-current scale-x-[-1]"><path d="M3.5 3.5v3h3V5h-1.5l1.5-1.5L8 5v1h-2v2H7.5L9 6.5l1.5 1.5H9v1h-1.5v3h5v-3h-1.5l-1.5 1.5V8.5H7V6.5h3v-2L8.5 3 7 4.5V3.5h-3z" /></svg>
            </button>
          </SimpleTooltip>

          <SimpleTooltip label="Upload Files" description="Import local files into the workspace" side="bottom">
            <label aria-label="Upload files" className="hidden cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground sm:block">
              <Upload className="size-3.5" />
              <input type="file" multiple className="hidden" onChange={handleFileUpload} />
            </label>
          </SimpleTooltip>

          <SimpleTooltip label="Developer Tools" description="GitHub, deploy, tests, and other workspace tools" side="bottom">
            <button
              type="button"
              onClick={() => setRightPanel(showDrawer ? null : ((primaryPanels[0]?.id as IDEPanel) ?? "github"))}
              aria-label="Developer Tools"
              className={cn(
                "rounded-md p-1.5 transition-colors hover:bg-foreground/5",
                showDrawer ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Wrench className="size-3.5" />
            </button>
          </SimpleTooltip>

          <SimpleTooltip label="Command Palette" description="Search all commands, panels, and actions" shortcut="Ctrl+Shift+P" side="bottom">
            <button
              type="button"
              onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}
              aria-label="Command Palette"
              className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 px-1.5 py-1 text-caption text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground sm:px-2"
            >
              <Terminal className="size-3" />
              <span className="hidden md:inline">Ctrl+Shift+P</span>
            </button>
          </SimpleTooltip>
        </div>
      </div>

      {/* ── Desktop: resizable Agent | Stage split ──────────────────────────── */}
      <div className="relative hidden min-h-0 flex-1 md:flex">
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={(sizes) => { if (sizes[0] > 1) setAgentPaneSize(sizes[0]); }}
        >
          <ResizablePanel
            ref={agentPanelRef}
            defaultSize={agentPaneSize}
            minSize={22}
            maxSize={60}
            collapsible
            collapsedSize={0}
            onCollapse={() => setAgentOpen(false)}
            onExpand={() => setAgentOpen(true)}
          >
            <AgentPanel className="h-full" />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize={30}>
            <StageBody stage={stage} explorerOpen={explorerOpen} />
          </ResizablePanel>
        </ResizablePanelGroup>

        {!showDrawer && (
          <CollapsedRail primaryPanels={primaryPanels} onSelect={setRightPanel} />
        )}

        {showDrawer && activePanel && (
          <DevToolsDrawer
            activePanel={activePanel}
            primaryPanels={primaryPanels}
            overflowPanels={overflowPanels}
            onSelect={(id) => setRightPanel(id)}
            onClose={() => setRightPanel(null)}
          />
        )}
      </div>

      {/* ── Narrow: segmented Agent/Editor/Preview/Diff ─────────────────────── */}
      <div className="relative flex min-h-0 flex-1 flex-col md:hidden">
        <div className="border-b border-border/60 px-2 py-1.5">
          <MobileSegmented
            mobileView={mobileView}
            onChange={(v) => { setMobileView(v); if (v !== "agent") setStage(v); }}
            diffCount={diffCount}
          />
        </div>
        <div className="min-h-0 flex-1">
          {mobileView === "agent" ? (
            <AgentPanel className="h-full" />
          ) : (
            <StageBody stage={mobileView} explorerOpen={explorerOpen} />
          )}
        </div>

        {showDrawer && activePanel && (
          <DevToolsDrawer
            activePanel={activePanel}
            primaryPanels={primaryPanels}
            overflowPanels={overflowPanels}
            onSelect={(id) => setRightPanel(id)}
            onClose={() => setRightPanel(null)}
          />
        )}
      </div>

      {/* ── Status Bar (Part 8) ──────────────────────────────────────────────── */}
      <WorkspaceStatusBar
        tsErrorCount={tsErrorCount}
        buildStatus={buildStatus}
        aiStatus={aiStreaming ? "streaming" : "idle"}
      />
    </div>
  );
}
