// ── CoCode IDE Store ─────────────────────────────────────────────────────────
// Unified Zustand store for all Phase 1-20 IDE state:
// • Virtual file system (Phase 2, 5)
// • Open tabs (Phase 5)
// • GitHub connection (Phase 4)
// • Diff engine state (Phase 7)
// • Apply engine (Phase 8)
// • Adaptive workflow (Phase 11)
// • Knowledge graph (Phase 18)
// • Checkpoints (Phase 20)

import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";

import {
  buildTree,
  flattenFiles,
  upsertFile,
  deleteFile,
  renameFile,
  findFile,
  type VirtualDir,
  type VirtualFile,
} from "@/lib/cocode/virtual-fs";
import {
  buildDOMSourceMap,
  type DOMSourceMap,
} from "@/lib/cocode/dom-source-map";
import {
  parseDiff,
  extractDiffs,
  applyAcceptedHunks,
  type ParsedDiff,
  type FileDiff,
  type DiffHunk,
} from "@/lib/cocode/diff";
import {
  buildKnowledgeGraph,
  searchGraph,
  type KnowledgeGraph,
  type KGNode,
} from "@/lib/cocode/knowledge-graph";
import {
  classifyWorkflow,
  createWorkflowSteps,
  type WorkflowDecision,
  type WorkflowStep,
  type RefactorKind,
} from "@/lib/cocode/adaptive-workflow";
import {
  createCheckpoint,
  pushCheckpoint,
  undoCheckpoint,
  redoCheckpoint,
  restoreCheckpoint,
  pruneStack,
  type Checkpoint,
  type CheckpointStack,
} from "@/lib/cocode/checkpoint";

// ── GitHub connection state ───────────────────────────────────────────────────

export interface GitHubConnection {
  connected: boolean;
  user: { login: string; name: string | null; avatar_url: string } | null;
  repo: {
    fullName: string;
    branch: string;
    defaultBranch: string;
    branches: string[];
    lastCommit?: string;
    protected: boolean;
  } | null;
  loading: boolean;
  error: string | null;
}

// ── Editor tab ────────────────────────────────────────────────────────────────

export interface EditorTab {
  path: string;
  pinned: boolean;
  scrollTop?: number;
  cursorLine?: number;
}

// ── IDE panel layout ──────────────────────────────────────────────────────────

export type IDEPanel =
  | "explorer" | "diff" | "preview" | "graph" | "checkpoints" | "github"
  | "design" | "multi-preview" | "deps" | "docs" | "diagnostics" | "pair"
  | "deploy" | "cicd" | "collab" | "env" | "perf" | "security" | "api" | "db" | "mobile" | "review";

// ── Full store interface ──────────────────────────────────────────────────────

interface CocodeIDEState {
  // ── Virtual FS (Phase 2, 5) ──────────────────────────────────────────────
  fs: VirtualDir;
  projectName: string;
  setProjectName: (n: string) => void;
  importFiles: (files: Array<{ path: string; content: string; sha?: string }>) => void;
  createFile: (path: string, content?: string) => void;
  updateFile: (path: string, content: string) => void;
  deleteFilePath: (path: string) => void;
  renameFilePath: (oldPath: string, newPath: string) => void;
  allFiles: () => VirtualFile[];

  // ── Editor tabs (Phase 5) ────────────────────────────────────────────────
  tabs: EditorTab[];
  activeTab: string | null;
  recentFiles: string[];
  pinnedFiles: string[];
  openTab: (path: string, pin?: boolean) => void;
  closeTab: (path: string) => void;
  pinTab: (path: string) => void;
  setActiveTab: (path: string | null) => void;
  activeFile: () => VirtualFile | null;

  // ── Panel layout (Phase 5, 9) ────────────────────────────────────────────
  rightPanel: IDEPanel | null;
  explorerOpen: boolean;
  setRightPanel: (panel: IDEPanel | null) => void;
  toggleExplorer: () => void;

  // ── GitHub (Phase 4) ─────────────────────────────────────────────────────
  github: GitHubConnection;
  connectGitHub: () => Promise<void>;
  disconnectGitHub: () => void;
  loadRepo: (fullName: string, branch?: string) => Promise<void>;
  switchBranch: (branch: string) => Promise<void>;
  commitFiles: (message: string, paths: string[]) => Promise<{ commitSha: string }>;
  createGitBranch: (name: string) => Promise<void>;
  openPR: (title: string, body: string, head: string, base: string) => Promise<string>;
  cloneProgress: number; // 0-100

  // ── Project Analysis (Phase 1) ───────────────────────────────────────────
  projectMap: Record<string, unknown> | null;
  analyzeProject: () => Promise<void>;
  analyzing: boolean;

  // ── Diff engine (Phase 7) ────────────────────────────────────────────────
  diff: ParsedDiff | null;
  diffSource: string;
  setDiff: (raw: string) => void;
  clearDiff: () => void;
  acceptHunk: (fileId: string, hunkId: string) => void;
  rejectHunk: (fileId: string, hunkId: string) => void;
  acceptAllHunks: (fileId: string) => void;
  rejectAllHunks: (fileId: string) => void;
  acceptAllDiffs: () => void;

  // ── Apply engine (Phase 8) ───────────────────────────────────────────────
  applying: boolean;
  lastApplyError: string | null;
  applyDiff: (prompt: string) => Promise<boolean>;

  // ── Adaptive workflow (Phase 11) ─────────────────────────────────────────
  workflow: WorkflowDecision | null;
  workflowSteps: WorkflowStep[];
  classifyRequest: (request: string) => WorkflowDecision;
  updateStepStatus: (stepId: string, status: WorkflowStep["status"], output?: string) => void;

  // ── Knowledge graph (Phase 18) ───────────────────────────────────────────
  graph: KnowledgeGraph | null;
  buildGraph: () => void;
  graphSearch: (query: string) => KGNode[];

  // ── Checkpoints (Phase 20) ───────────────────────────────────────────────
  checkpoints: CheckpointStack;
  currentCheckpoint: Checkpoint | null;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  restoreFromCheckpoint: (id: string) => void;
  allCheckpoints: () => Checkpoint[];

  // ── Refactoring (Phase 19) ───────────────────────────────────────────────
  refactoring: boolean;
  runRefactor: (kind: RefactorKind, options: {
    selection?: { start: number; end: number; text: string };
    symbol?: { name: string; newName: string };
  }) => Promise<void>;

  // ── DOM Source Map (Phase 22) ────────────────────────────────────────────
  domMap: DOMSourceMap | null;
  buildDOMMap: () => void;

  // ── Multi Preview (Phase 24) ─────────────────────────────────────────────
  previewWidth: number | null;
  setPreviewWidth: (width: number | null) => void;

  // ── Virtual FS upsert (for docs, etc.) ──────────────────────────────────
  upsertFile: (path: string, content: string) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const emptyFS: VirtualDir = { path: "", name: "/", children: [], expanded: true };
const emptyStack: CheckpointStack = { past: [], future: [] };

export const useCocodeIDEStore = create<CocodeIDEState>()(
  persist(
    subscribeWithSelector((set, get) => ({
      // ── Virtual FS ──────────────────────────────────────────────────────────
      fs: emptyFS,
      projectName: "Untitled Project",
      setProjectName: (n) => set({ projectName: n }),

      importFiles: (files) => {
        const fs = buildTree(files);
        set({ fs, graph: null, projectMap: null });
        // Auto-build graph in background
        setTimeout(() => get().buildGraph(), 100);
      },

      createFile: (path, content = "") => {
        set((s) => ({ fs: upsertFile(s.fs, path, content) }));
        get().openTab(path);
      },

      updateFile: (path, content) => {
        set((s) => ({ fs: upsertFile(s.fs, path, content) }));
      },

      deleteFilePath: (path) => {
        set((s) => ({
          fs: deleteFile(s.fs, path),
          tabs: s.tabs.filter((t) => t.path !== path),
          activeTab: s.activeTab === path
            ? (s.tabs.find((t) => t.path !== path)?.path ?? null)
            : s.activeTab,
        }));
      },

      renameFilePath: (oldPath, newPath) => {
        set((s) => ({
          fs: renameFile(s.fs, oldPath, newPath),
          tabs: s.tabs.map((t) => t.path === oldPath ? { ...t, path: newPath } : t),
          activeTab: s.activeTab === oldPath ? newPath : s.activeTab,
        }));
      },

      allFiles: () => flattenFiles(get().fs),

      // ── Tabs ────────────────────────────────────────────────────────────────
      tabs: [],
      activeTab: null,
      recentFiles: [],
      pinnedFiles: [],

      openTab: (path, pin = false) => {
        set((s) => {
          const exists = s.tabs.find((t) => t.path === path);
          const tabs = exists
            ? s.tabs
            : [...s.tabs, { path, pinned: pin }];
          const recent = [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, 20);
          return { tabs, activeTab: path, recentFiles: recent };
        });
      },

      closeTab: (path) => {
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.path === path);
          const tabs = s.tabs.filter((t) => t.path !== path);
          const nextActive =
            s.activeTab !== path
              ? s.activeTab
              : tabs[Math.max(0, idx - 1)]?.path ?? null;
          return { tabs, activeTab: nextActive };
        });
      },

      pinTab: (path) => {
        set((s) => ({
          tabs: s.tabs.map((t) => t.path === path ? { ...t, pinned: !t.pinned } : t),
          pinnedFiles: s.pinnedFiles.includes(path)
            ? s.pinnedFiles.filter((p) => p !== path)
            : [...s.pinnedFiles, path],
        }));
      },

      setActiveTab: (path) => set({ activeTab: path }),

      activeFile: () => {
        const { activeTab, fs } = get();
        if (!activeTab) return null;
        return findFile(fs, activeTab);
      },

      // ── Layout ──────────────────────────────────────────────────────────────
      rightPanel: null,
      explorerOpen: true,
      setRightPanel: (panel) => set({ rightPanel: panel }),
      toggleExplorer: () => set((s) => ({ explorerOpen: !s.explorerOpen })),

      // ── GitHub ──────────────────────────────────────────────────────────────
      github: { connected: false, user: null, repo: null, loading: false, error: null },
      cloneProgress: 0,

      connectGitHub: async () => {
        set((s) => ({ github: { ...s.github, loading: true, error: null } }));
        try {
          const res = await fetch("/api/github", { method: "PATCH" });
          const data = await res.json() as { url?: string; error?: string };
          if (data.url) {
            window.location.href = data.url;
          } else {
            set((s) => ({ github: { ...s.github, loading: false, error: data.error ?? "Failed" } }));
          }
        } catch (e) {
          set((s) => ({ github: { ...s.github, loading: false, error: String(e) } }));
        }
      },

      disconnectGitHub: () => {
        document.cookie = "gh_token=; Max-Age=0; path=/";
        set({ github: { connected: false, user: null, repo: null, loading: false, error: null } });
      },

      loadRepo: async (fullName, branch) => {
        set((s) => ({ github: { ...s.github, loading: true, error: null }, cloneProgress: 0 }));
        try {
          // Get repo metadata
          const repoRes = await fetch(`/api/github?path=/repos/${fullName}`);
          const repo = await repoRes.json() as {
            default_branch: string; name: string; full_name: string;
          };
          const targetBranch = branch ?? repo.default_branch;

          // Get branch list
          const branchRes = await fetch(`/api/github?path=/repos/${fullName}/branches?per_page=100`);
          const branches = await branchRes.json() as Array<{ name: string; protected: boolean }>;

          // Get file tree
          const treeRes = await fetch(`/api/github?path=/repos/${fullName}/git/trees/${targetBranch}?recursive=1`);
          const tree = await treeRes.json() as { tree: Array<{ path: string; type: string; size: number; sha: string }> };

          const eligible = (tree.tree ?? []).filter(
            (item) => item.type === "blob" && (item.size ?? 0) < 200_000 &&
              !item.path.includes("node_modules") && !item.path.includes(".next/"),
          ).slice(0, 200); // cap at 200 files for browser

          // Batch-fetch files
          const BATCH = 5;
          const allFiles: Array<{ path: string; content: string; sha: string }> = [];

          for (let i = 0; i < eligible.length; i += BATCH) {
            const batch = eligible.slice(i, i + BATCH);
            const results = await Promise.allSettled(
              batch.map(async (item) => {
                const r = await fetch(`/api/github?path=/repos/${fullName}/contents/${item.path}&ref=${targetBranch}`);
                const d = await r.json() as { content: string; encoding: string; sha: string };
                const content = d.encoding === "base64"
                  ? atob(d.content.replace(/\n/g, "")) : d.content;
                return { path: item.path, content, sha: d.sha };
              }),
            );
            for (const r of results) {
              if (r.status === "fulfilled") allFiles.push(r.value);
            }
            set({ cloneProgress: Math.round(((i + BATCH) / eligible.length) * 100) });
          }

          get().importFiles(allFiles);
          get().setProjectName(repo.name);

          set((s) => ({
            github: {
              ...s.github,
              connected: true,
              loading: false,
              repo: {
                fullName,
                branch: targetBranch,
                defaultBranch: repo.default_branch,
                branches: branches.map((b) => b.name),
                protected: branches.find((b) => b.name === targetBranch)?.protected ?? false,
              },
            },
            cloneProgress: 100,
          }));
        } catch (e) {
          set((s) => ({ github: { ...s.github, loading: false, error: String(e) } }));
        }
      },

      switchBranch: async (branch) => {
        const { github } = get();
        if (!github.repo) return;
        await get().loadRepo(github.repo.fullName, branch);
      },

      commitFiles: async (message, paths) => {
        const { github, fs } = get();
        if (!github.repo || github.repo.protected) {
          throw new Error(github.repo?.protected ? "Branch is protected" : "No repo connected");
        }
        const { fullName, branch } = github.repo;
        let lastCommitSha = "";

        for (const path of paths) {
          const file = findFile(fs, path);
          if (!file) continue;
          const res = await fetch(`/api/github?path=/repos/${fullName}/contents/${path}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              content: btoa(unescape(encodeURIComponent(file.content))),
              branch,
              ...(file.sha ? { sha: file.sha } : {}),
            }),
          });
          const data = await res.json() as { commit?: { sha: string } };
          lastCommitSha = data.commit?.sha ?? "";
          // Mark file as clean
          set((s) => ({ fs: upsertFile(s.fs, path, file.content, data.commit?.sha) }));
        }

        return { commitSha: lastCommitSha };
      },

      createGitBranch: async (name) => {
        const { github } = get();
        if (!github.repo) throw new Error("No repo connected");
        const { fullName, branch } = github.repo;
        // Get current branch HEAD SHA
        const refRes = await fetch(`/api/github?path=/repos/${fullName}/git/ref/heads/${branch}`);
        const ref = await refRes.json() as { object?: { sha: string } };
        const sha = ref.object?.sha ?? "";
        await fetch(`/api/github?path=/repos/${fullName}/git/refs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref: `refs/heads/${name}`, sha }),
        });
        set((s) => ({
          github: {
            ...s.github,
            repo: s.github.repo
              ? { ...s.github.repo, branches: [...s.github.repo.branches, name] }
              : null,
          },
        }));
      },

      openPR: async (title, body, head, base) => {
        const { github } = get();
        if (!github.repo) throw new Error("No repo connected");
        const res = await fetch(`/api/github?path=/repos/${github.repo.fullName}/pulls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, head, base }),
        });
        const pr = await res.json() as { html_url?: string; number?: number };
        return pr.html_url ?? "";
      },

      // ── Project Analysis ─────────────────────────────────────────────────────
      projectMap: null,
      analyzing: false,

      analyzeProject: async () => {
        set({ analyzing: true });
        try {
          const files = get().allFiles().map((f) => ({ path: f.path, content: f.content }));
          const res = await fetch("/api/repo/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: files.slice(0, 100) }),
          });
          const map = await res.json();
          set({ projectMap: map });
        } finally {
          set({ analyzing: false });
        }
      },

      // ── Diff engine ──────────────────────────────────────────────────────────
      diff: null,
      diffSource: "",

      setDiff: (raw) => {
        const parsed = parseDiff(raw);
        set({ diff: parsed, diffSource: raw, rightPanel: "diff" });
      },

      clearDiff: () => set({ diff: null, diffSource: "" }),

      acceptHunk: (fileId, hunkId) => {
        set((s) => ({
          diff: s.diff
            ? {
                ...s.diff,
                files: s.diff.files.map((f) =>
                  f.id !== fileId ? f : {
                    ...f,
                    hunks: f.hunks.map((h) =>
                      h.id === hunkId ? { ...h, accepted: true } : h,
                    ),
                  },
                ),
              }
            : null,
        }));
      },

      rejectHunk: (fileId, hunkId) => {
        set((s) => ({
          diff: s.diff
            ? {
                ...s.diff,
                files: s.diff.files.map((f) =>
                  f.id !== fileId ? f : {
                    ...f,
                    hunks: f.hunks.map((h) =>
                      h.id === hunkId ? { ...h, accepted: false } : h,
                    ),
                  },
                ),
              }
            : null,
        }));
      },

      acceptAllHunks: (fileId) => {
        set((s) => ({
          diff: s.diff
            ? {
                ...s.diff,
                files: s.diff.files.map((f) =>
                  f.id !== fileId ? f : {
                    ...f,
                    hunks: f.hunks.map((h) => ({ ...h, accepted: true })),
                  },
                ),
              }
            : null,
        }));
      },

      rejectAllHunks: (fileId) => {
        set((s) => ({
          diff: s.diff
            ? {
                ...s.diff,
                files: s.diff.files.map((f) =>
                  f.id !== fileId ? f : {
                    ...f,
                    hunks: f.hunks.map((h) => ({ ...h, accepted: false })),
                  },
                ),
              }
            : null,
        }));
      },

      acceptAllDiffs: () => {
        set((s) => ({
          diff: s.diff
            ? {
                ...s.diff,
                files: s.diff.files.map((f) => ({
                  ...f,
                  hunks: f.hunks.map((h) => ({ ...h, accepted: true })),
                })),
              }
            : null,
        }));
      },

      // ── Apply engine ─────────────────────────────────────────────────────────
      applying: false,
      lastApplyError: null,

      applyDiff: async (prompt) => {
        const { diff, fs } = get();
        if (!diff) return false;

        set({ applying: true, lastApplyError: null });
        try {
          const files = flattenFiles(fs).map((f) => ({ path: f.path, content: f.content }));
          const res = await fetch("/api/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ diff: get().diffSource, files, acceptAll: false }),
          });
          const result = await res.json() as {
            ok: boolean;
            patched: Array<{ path: string; content: string }>;
            errors: Array<{ path: string; error: string }>;
          };

          if (!result.ok && result.errors.length) {
            set({ lastApplyError: result.errors[0].error });
            return false;
          }

          // Apply patches to virtual FS
          let newFs = fs;
          for (const f of result.patched) {
            newFs = upsertFile(newFs, f.path, f.content);
          }

          // Create checkpoint BEFORE updating FS
          const checkpoint = createCheckpoint(prompt, diff, newFs);
          const newStack = pushCheckpoint(
            pruneStack(get().checkpoints),
            checkpoint,
          );

          set({
            fs: newFs,
            checkpoints: newStack,
            currentCheckpoint: checkpoint,
            canUndo: newStack.past.length > 1,
            canRedo: false,
            diff: null,
            applying: false,
          });

          return true;
        } catch (e) {
          set({ applying: false, lastApplyError: String(e) });
          return false;
        }
      },

      // ── Adaptive workflow ─────────────────────────────────────────────────────
      workflow: null,
      workflowSteps: [],

      classifyRequest: (request) => {
        const { fs } = get();
        const fileCount = flattenFiles(fs).length;
        const decision = classifyWorkflow(request, fileCount > 0, fileCount);
        const steps = createWorkflowSteps(decision);
        set({ workflow: decision, workflowSteps: steps });
        return decision;
      },

      updateStepStatus: (stepId, status, output) => {
        set((s) => ({
          workflowSteps: s.workflowSteps.map((step) =>
            step.id !== stepId ? step : {
              ...step,
              status,
              output,
              ...(status === "running" ? { startedAt: Date.now() } : {}),
              ...(status === "done" || status === "failed" ? { completedAt: Date.now() } : {}),
            },
          ),
        }));
      },

      // ── Knowledge graph ───────────────────────────────────────────────────────
      graph: null,

      buildGraph: () => {
        const files = get().allFiles().map((f) => ({ path: f.path, content: f.content }));
        if (!files.length) return;
        const graph = buildKnowledgeGraph(files);
        set({ graph });
      },

      graphSearch: (query) => {
        const { graph } = get();
        if (!graph) return [];
        return searchGraph(graph, query);
      },

      // ── Checkpoints ───────────────────────────────────────────────────────────
      checkpoints: emptyStack,
      currentCheckpoint: null,
      canUndo: false,
      canRedo: false,

      undo: () => {
        const { stack, restored } = undoCheckpoint(get().checkpoints);
        if (restored) {
          set({
            checkpoints: stack,
            currentCheckpoint: restored,
            fs: restored.snapshot,
            canUndo: stack.past.length > 1,
            canRedo: stack.future.length > 0,
          });
        }
      },

      redo: () => {
        const { stack, restored } = redoCheckpoint(get().checkpoints);
        if (restored) {
          set({
            checkpoints: stack,
            currentCheckpoint: restored,
            fs: restored.snapshot,
            canUndo: stack.past.length > 1,
            canRedo: stack.future.length > 0,
          });
        }
      },

      restoreFromCheckpoint: (id) => {
        const { stack, restored } = restoreCheckpoint(get().checkpoints, id);
        if (restored) {
          set({
            checkpoints: stack,
            currentCheckpoint: restored,
            fs: restored.snapshot,
            canUndo: stack.past.length > 1,
            canRedo: stack.future.length > 0,
          });
        }
      },

      allCheckpoints: () => {
        const { past, future } = get().checkpoints;
        return [...past, ...future.slice().reverse()];
      },

      // ── DOM Source Map (Phase 22) ─────────────────────────────────────────────
      domMap: null,

      buildDOMMap: () => {
        const files = get().allFiles().map((f) => ({ path: f.path, content: f.content }));
        if (!files.length) return;
        const domMap = buildDOMSourceMap(files);
        set({ domMap });
      },

      // ── Multi Preview width (Phase 24) ────────────────────────────────────────
      previewWidth: null,
      setPreviewWidth: (width) => set({ previewWidth: width }),

      // ── Upsert file helper ────────────────────────────────────────────────────
      upsertFile: (path, content) => {
        set((s) => ({ fs: upsertFile(s.fs, path, content) }));
        get().openTab(path);
      },

      // ── Refactoring ───────────────────────────────────────────────────────────
      refactoring: false,

      runRefactor: async (kind, options) => {
        const activeFile = get().activeFile();
        if (!activeFile) return;

        set({ refactoring: true });
        try {
          const allFiles = get().allFiles().map((f) => ({ path: f.path, content: f.content }));
          const res = await fetch("/api/refactor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind,
              file: { path: activeFile.path, content: activeFile.content },
              selection: options.selection,
              symbol: options.symbol,
              allFiles,
            }),
          });

          if (res.headers.get("Content-Type")?.includes("text/plain")) {
            // Streaming diff response
            const text = await res.text();
            const diffs = extractDiffs(text);
            if (diffs.length) get().setDiff(diffs[0]);
          } else {
            const data = await res.json() as {
              patchedFiles?: Array<{ path: string; content: string }>;
              diff?: string;
            };
            if (data.patchedFiles) {
              for (const f of data.patchedFiles) {
                get().updateFile(f.path, f.content);
              }
            }
            if (data.diff) get().setDiff(data.diff);
          }
        } finally {
          set({ refactoring: false });
        }
      },
    })),
    {
      name: "cocode.ide",
      // Only persist lightweight state — snapshots are too large for localStorage
      partialize: (s) => ({
        projectName: s.projectName,
        tabs: s.tabs.slice(0, 20),
        activeTab: s.activeTab,
        recentFiles: s.recentFiles.slice(0, 20),
        pinnedFiles: s.pinnedFiles,
        explorerOpen: s.explorerOpen,
        rightPanel: s.rightPanel,
        github: { ...s.github, loading: false, error: null },
      }),
    },
  ),
);
