"use client";

// ── CoCode Workspace Shell ───────────────────────────────────────────────────
// Layout: Explorer | Editor | Adaptive Right Panel (grouped Build/Understand/
// Verify/Ship). Developer Mode: hides advanced systems by default.
// Panel components, the tab strip/overflow menu, the collapsed rail, and the
// workspace's small standalone effects (keyboard shortcuts, GitHub OAuth
// callback, file upload) live in sibling modules — this file is composition.

import { useEffect, useState, useRef, useMemo, Suspense } from "react";
import Link from "next/link";
import {
  PanelLeftClose, PanelLeftOpen, GitBranch,
  Loader2, Upload, Zap, Hammer,
  Terminal, Code2, ArrowLeft, FolderKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { useUIStore } from "@/store/ui-store";
import { useCodeStore } from "@/store/code-store";
import { extractDiffs } from "@/lib/cocode/diff";
import { getAdaptivePanels } from "@/lib/cocode/adaptive-panels";
import { analyzeFiles } from "@/lib/cocode/diagnostics";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { WorkspaceStatusBar } from "./status-bar";
import { useSmartContextMenu, SmartContextMenu } from "./smart-context-menu";
import { SimpleTooltip } from "./ide-tooltip";
import { BuildPanel } from "./build-panel";
import { FileExplorer, MonacoEditor, ActivePanel, PanelLoader } from "./panel-host";
import { PanelTabStrip } from "./panel-tab-strip";
import { CollapsedRail } from "./collapsed-rail";
import { useWorkspaceKeyboard } from "./use-workspace-keyboard";
import { useGithubOAuthCallback } from "./use-github-callback";
import { useWorkspaceUpload } from "./use-workspace-upload";
import type { IDEPanel } from "@/store/cocode-ide-store";

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
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border/40 bg-card/40 p-3 text-body-sm">
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
          className="flex-1 resize-none rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-body-sm outline-none placeholder:text-muted-foreground/35 focus:border-primary/40 focus:bg-background/80 transition-colors"
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

  const developerMode = useUIStore((s) => s.developerMode);

  // Part 7 — Smart Context Menu
  const { position: ctxPos, selection: ctxSel, close: closeCtx } = useSmartContextMenu();

  // Adaptive panel list driven by current file context, grouped into
  // Build/Understand/Verify/Ship (adaptive-panels.ts).
  const { primary: primaryPanels, overflow: overflowPanels } = getAdaptivePanels(activeTab, developerMode);

  const activePanel = rightPanel as IDEPanel | null;
  const showRightPanel = activePanel !== null;

  // Below `md` the explorer/editor/panel columns can't fit side by side —
  // Files becomes a slide-over (Sheet), Editor/Panel share one pane picked by
  // a bottom switcher. Desktop layout above is untouched by this state.
  const [mobilePane, setMobilePane] = useState<"editor" | "panel">("editor");
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);

  // A panel opened from elsewhere (command palette, collapsed rail on
  // desktop) should be what a mobile user sees next, not silently behind
  // the Editor tab.
  useEffect(() => {
    if (activePanel) setMobilePane("panel");
  }, [activePanel]);

  useWorkspaceKeyboard(undo, redo);
  useGithubOAuthCallback();
  const handleFileUpload = useWorkspaceUpload();

  function handleSendToChat(text: string) {
    const fn = (window as unknown as Record<string, unknown>).__cocode_send;
    if (typeof fn === "function") (fn as (t: string) => void)(text);
  }

  return (
    <div className="cocode-workspace-outer flex h-full flex-col overflow-hidden">
      {/* Command palette is global — rendered by (app)/layout. */}

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
          <div className="flex h-10 items-center gap-1.5 overflow-x-auto border-b border-border/60 bg-card/50 px-3 no-scrollbar sm:gap-2">
            <Hammer className="size-3.5 shrink-0 text-primary" />
            <span className="hidden shrink-0 text-body-sm font-medium text-foreground sm:inline">Build</span>
            <span className="hidden shrink-0 text-muted-foreground sm:inline">·</span>
            <span className="min-w-0 flex-1 truncate text-body-sm text-muted-foreground sm:max-w-[160px] sm:flex-none">{projectName}</span>
            <SimpleTooltip label="Switch Project" description="Go to your projects list" side="bottom">
              <Link
                href="/projects"
                aria-label="Switch project"
                className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 px-1.5 py-1 text-caption text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground sm:px-2"
              >
                <FolderKanban className="size-3" />
                <span className="hidden sm:inline">Projects</span>
              </Link>
            </SimpleTooltip>
            <SimpleTooltip
              label="Open Editor"
              description={hasFiles ? "Switch to the file explorer and code editor" : "Switch to the file explorer — upload files or connect GitHub"}
              side="bottom"
            >
              <button
                type="button"
                onClick={() => setViewMode("editor")}
                aria-label="Open Editor"
                className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border/40 px-1.5 py-1 text-caption text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground sm:px-2"
              >
                <Code2 className="size-3" />
                <span className="hidden sm:inline">Open Editor</span>
              </button>
            </SimpleTooltip>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <BuildPanel />
          </div>
        </>
      ) : (
        <>
      {/* ── Workspace Titlebar ────────────────────────────────────────────── */
      /* Responsive: text labels drop below `sm`, every button stays icon-only
         so the bar never wraps; `overflow-x-auto` is a safety net, not the
         primary strategy (matches panel-tab-strip.tsx's own overflow rule). */}
      <div className="flex h-10 items-center gap-1 overflow-x-auto border-b border-border/60 bg-card/50 px-2 no-scrollbar sm:gap-1.5 sm:px-3">
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
            aria-label={explorerOpen ? "Hide Explorer" : "Show Explorer"}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {explorerOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
        </SimpleTooltip>

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

        {/* Part 5 — Developer Mode toggle. Only shown here (not duplicated in
           the status bar) so there's one discoverable place to see/change it. */}
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

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          {/* Undo */}
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

          {/* Redo — hidden below `sm`, reachable via Ctrl+Y, to keep the core
             row (name/undo/back/palette) from crowding out on a phone. */}
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

          {/* Upload — hidden below `sm`; still reachable via the mobile Files sheet. */}
          <SimpleTooltip label="Upload Files" description="Import local files into the workspace" side="bottom">
            <label aria-label="Upload files" className="hidden cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground sm:block">
              <Upload className="size-3.5" />
              <input type="file" multiple className="hidden" onChange={handleFileUpload} />
            </label>
          </SimpleTooltip>

          {/* Back to CoCode */}
          <SimpleTooltip label="Back to CoCode" description="Return to the CoCode chat/build view" side="bottom">
            <button
              type="button"
              onClick={() => setViewMode("build")}
              aria-label="Back to CoCode"
              className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 px-1.5 py-1 text-caption text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground sm:px-2"
            >
              <ArrowLeft className="size-3" />
              <span className="hidden sm:inline">Back to CoCode</span>
            </button>
          </SimpleTooltip>

          {/* Command Palette button */}
          <SimpleTooltip label="Command Palette" description="Search all commands, panels, and actions" shortcut="Ctrl+Shift+P" side="bottom">
            <button
              type="button"
              onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}
              aria-label="Command Palette"
              className="flex shrink-0 items-center gap-1 rounded-md border border-border/40 px-1.5 py-1 text-caption text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground sm:px-2"
            >
              <Terminal className="size-3" />
              <span className="hidden lg:inline">Ctrl+Shift+P</span>
            </button>
          </SimpleTooltip>

          {/* Diff badge */}
          {diff && diff.files.length > 0 && (
            <SimpleTooltip label="Pending Changes" description={`${diff.files.length} file(s) with AI-generated changes awaiting review`} side="bottom">
              <button
                type="button"
                onClick={() => setRightPanel("diff")}
                aria-label={`${diff.files.length} pending change${diff.files.length !== 1 ? "s" : ""} — view diff`}
                className="flex shrink-0 items-center gap-1 rounded-md bg-accent-warm/15 px-1.5 py-0.5 text-caption text-accent-warm hover:bg-accent-warm/25 transition-colors sm:px-2"
              >
                <Zap className="size-3" />
                {diff.files.length}<span className="hidden sm:inline">&nbsp;change{diff.files.length !== 1 ? "s" : ""}</span>
              </button>
            </SimpleTooltip>
          )}
        </div>
      </div>

      {/* ── Main area — desktop: Explorer | Editor | Panel side by side ─────── */}
      <div className="hidden min-h-0 flex-1 md:flex">
        {explorerOpen && (
          <div className="w-[clamp(180px,18vw,224px)] shrink-0 border-r border-border/60">
            <Suspense fallback={<PanelLoader />}>
              <FileExplorer />
            </Suspense>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<PanelLoader />}>
            <MonacoEditor className="min-h-0 flex-1" />
          </Suspense>
          <WorkspaceChatInput />
        </div>

        {showRightPanel && (
          <div className="flex w-[clamp(280px,28vw,384px)] min-w-0 shrink-0 flex-col border-l border-border/60">
            <PanelTabStrip
              primaryPanels={primaryPanels}
              overflowPanels={overflowPanels}
              activePanel={activePanel}
              onSelect={setRightPanel}
              onClose={() => setRightPanel(null)}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<PanelLoader />}>
                <ActivePanel panel={activePanel!} />
              </Suspense>
            </div>
          </div>
        )}

        {!showRightPanel && (
          <CollapsedRail primaryPanels={primaryPanels} onSelect={setRightPanel} />
        )}
      </div>

      {/* ── Main area — mobile: one pane at a time + bottom switcher ────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <div className="min-h-0 flex-1">
          {mobilePane === "panel" && showRightPanel ? (
            <div className="flex h-full flex-col">
              <PanelTabStrip
                primaryPanels={primaryPanels}
                overflowPanels={overflowPanels}
                activePanel={activePanel}
                onSelect={setRightPanel}
                onClose={() => setRightPanel(null)}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                <Suspense fallback={<PanelLoader />}>
                  <ActivePanel panel={activePanel!} />
                </Suspense>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <Suspense fallback={<PanelLoader />}>
                <MonacoEditor className="min-h-0 flex-1" />
              </Suspense>
              <WorkspaceChatInput />
            </div>
          )}
        </div>

        {/* Bottom segmented switcher — Files opens a slide-over, Editor/Panel swap the pane above */}
        <div className="flex items-center gap-1 border-t border-border/60 bg-card/50 p-1.5">
          <button
            type="button"
            onClick={() => setMobileExplorerOpen(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <PanelLeftOpen className="size-3.5" />
            Files
          </button>
          <button
            type="button"
            onClick={() => setMobilePane("editor")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-caption font-medium transition-colors",
              mobilePane === "editor" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <Code2 className="size-3.5" />
            Editor
          </button>
          <button
            type="button"
            onClick={() => showRightPanel && setMobilePane("panel")}
            disabled={!showRightPanel}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-caption font-medium transition-colors disabled:opacity-30",
              mobilePane === "panel" && showRightPanel ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <PanelLeftClose className="size-3.5" />
            Panel
          </button>
        </div>
      </div>

      <Sheet open={mobileExplorerOpen} onOpenChange={setMobileExplorerOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs p-0">
          <SheetHeader className="border-b border-border p-3">
            <SheetTitle className="text-sm">Files</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100%-3.5rem)] overflow-hidden">
            <Suspense fallback={<PanelLoader />}>
              <FileExplorer />
            </Suspense>
          </div>
        </SheetContent>
      </Sheet>

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
