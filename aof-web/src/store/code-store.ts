import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import {
  streamCodeChat,
  streamCodeEdit,
  streamCodeRun,
  streamRequirements,
  streamPlan,
  streamAnalyze,
  streamDebug,
} from "@/lib/api";
import { classifyTurn } from "@/lib/conversation-state";
import {
  discoveryQuestions,
  planOptions,
  riskReview,
  architectureSketch,
} from "@/lib/titan";
import {
  briefReadiness,
  briefToContext,
  briefToTask,
  conversationToContext,
  stripBriefBlock,
} from "@/lib/raa";
import { TITAN_PHASES } from "@/lib/constants";
import { checkUserAccess } from "@/lib/access";
import { useAuthStore } from "@/store/auth-store";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { extractGeneratedFiles, buildProjectHtml, canBuildHtml } from "@/lib/export";
import { extractDiffs } from "@/lib/cocode/diff";
import { uid } from "@/lib/utils";
import {
  conversationsEnabled,
  createConversation,
  deleteConversationRemote,
  fetchMessages,
  mergeServerMessages,
  saveMessages,
  titleFrom,
  toChatMessages,
} from "@/lib/conversations";
import {
  formatErrorBlock,
  type AofProviderError,
  type FailoverNotice,
  type StageNotice,
  type UsageNotice,
} from "@/lib/errors";
import type {
  ChatMessageT,
  ClarifyQuestion,
  CodeMode,
  CodePhase,
  EffortLevel,
  ProjectBrief,
  TitanPhaseKey,
  TitanPlanOption,
  TitanRisk,
  WorkflowModelId,
} from "@/lib/types";
import { clampEffort } from "@/lib/effort";

interface TitanState {
  active: boolean;
  phase: TitanPhaseKey;
  prompt: string;
  questions: ClarifyQuestion[];
  answers: Record<string, string>;
  confidence: number;
  plans: TitanPlanOption[];
  chosenPlan: "A" | "B" | "C" | null;
  risks: TitanRisk[];
  architecture: string;
  approved: boolean;
  buildLog: string;
}

const emptyTitan: TitanState = {
  active: false,
  phase: "discovery",
  prompt: "",
  questions: [],
  answers: {},
  confidence: 0,
  plans: [],
  chosenPlan: null,
  risks: [],
  architecture: "",
  approved: false,
  buildLog: "",
};

/** One project's saved "Ask CoCode" chat — the active project's own copy of
 *  these four fields lives at the top level of CodeState (so every existing
 *  selector keeps working unchanged); this is what every OTHER project's
 *  chat is parked as while it isn't the active one, and what's written to
 *  localStorage/the DB per project. */
interface CocodeSession {
  convo: ChatMessageT[];
  brief: ProjectBrief | null;
  phase: CodePhase;
  projectActive: boolean;
}

/** Session key for a CoCode session started before it has a real project
 *  (e.g. landing directly on /code) — see ensureProjectForWorkspace, which
 *  migrates this session once a project is adopted. Never persisted to the
 *  DB: only real projects get a server-side conversation. */
const SCRATCH_KEY = "__scratch__";

function emptySession(): CocodeSession {
  return { convo: [], brief: null, phase: "conversation", projectActive: false };
}

/** Deterministic conversation id for a project's CoCode chat — one chat per
 *  project, no conversation-list UI in CoCode so there's nothing else to
 *  disambiguate. */
function cocodeConversationId(projectId: string): string {
  return `cc_${projectId}`;
}

// Module-level (not persisted) dedupe caches — mirror the `loading` Set in
// lib/cocode/open-project.ts. `createdConversations` avoids re-POSTing the
// conversation row on every turn; `hydratedProjects`/`hydratingProjects`
// avoid re-fetching (or double-fetching) a project's saved chat.
const createdConversations = new Set<string>();
const hydratedProjects = new Set<string>();
const hydratingProjects = new Set<string>();

/** Persist one turn (user + assistant message pair) to the active project's
 *  DB conversation. No-ops for guests/offline/project-less sessions — the
 *  local copy in `convo` is always the fallback. Called from the two (and
 *  only two) places that append a user+assistant pair: sendMessage and
 *  sendEditMessage. */
async function persistCocodeTurn(
  get: () => CodeState,
  userMsg: ChatMessageT,
  assistantMsg: ChatMessageT,
): Promise<void> {
  if (!conversationsEnabled()) return;
  const projectId = get().projectId;
  if (!projectId) return;
  const id = cocodeConversationId(projectId);
  try {
    if (!createdConversations.has(id)) {
      createdConversations.add(id);
      const firstUser = get().convo.find((m) => m.role === "user");
      await createConversation(
        { id, title: titleFrom(firstUser?.content ?? userMsg.content), model: get().mode },
        "cocode",
      );
    }
    await saveMessages(id, [userMsg, assistantMsg]);
  } catch {
    toast.error("Sync failed — messages saved locally", { id: "cocode-sync-error", duration: 4000 });
  }
}

interface CodeState {
  mode: CodeMode;
  setMode: (m: CodeMode) => void;
  /** Reasoning-effort dial: Low/Normal/High (Mikros, Kanon) or Ultra/Extreme (Ypertatos). */
  effort: EffortLevel;
  setEffort: (e: EffortLevel) => void;

  // ── Per-project chat persistence ───────────────────────────────────────────
  /** Active project's id (its DB conversation id is `cc_<projectId>`), or
   *  null for a project-less /code session — see SCRATCH_KEY. */
  projectId: string | null;
  /** Every OTHER project's chat session, keyed by project id (or
   *  SCRATCH_KEY). The active session's own convo/brief/phase/projectActive
   *  stay in the top-level fields below. */
  sessions: Record<string, CocodeSession>;
  /** Swap the active chat session to another project's. Called from
   *  lib/cocode/open-project.ts whenever the CoCode workspace switches
   *  projects — mirrors that module's resetWorkspace for files. */
  setActiveProject: (projectId: string | null) => void;
  /** Hydrate a project's saved CoCode chat from the server (source of
   *  truth). No-op for guests/offline/project-less sessions/already-hydrated
   *  projects. */
  hydrateCocodeProject: (projectId: string | null) => Promise<void>;
  /** Upload any locally-held CoCode chats (guest sessions) to the
   *  newly-signed-in account — mirrors chat-store's migrateGuestConversations. */
  migrateGuestCocode: () => Promise<void>;
  /** A project-less session (SCRATCH_KEY) just gained a real project id —
   *  re-key its chat under that id and flush any turns taken before the
   *  project existed. WITHOUT resetting convo (unlike setActiveProject):
   *  this is the same in-progress chat just gaining somewhere to persist,
   *  mirroring ensureProjectForWorkspace's file-sync flush. */
  adoptProjectId: (projectId: string) => void;

  // ── Conversation-first workflow (RAA → brief → generate) ──────────────────
  // CoCode discusses the project first; TMAP only runs on an explicit trigger
  // (the Generate Code button or the /gencode command).
  convo: ChatMessageT[];
  brief: ProjectBrief | null;
  phase: CodePhase;
  /** True once the user has described a project (DISCOVERY state entered).
   *  Stays true until "New" is pressed — ensures subsequent messages keep
   *  going to RAA rather than falling back to NORMAL_CHAT. */
  projectActive: boolean;
  chatting: boolean;
  convoAbort: AbortController | null;
  sendMessage: (text: string) => Promise<void>;
  stopChat: () => void;
  generate: () => Promise<void>;
  canGenerate: () => boolean;
  resetConversation: () => void;
  /** Re-import the last generated output as a full multi-file breakdown
   *  instead of the merged single index.html — "Split into files". */
  splitGeneratedFiles: () => void;

  // ── Action buttons (trigger existing systems) ─────────────────────────────
  /** which action produced the current output panel */
  outputKind: "build" | "plan" | "analyze" | "debug" | null;
  /** when true, the next composer submit is treated as an error to debug */
  debugMode: boolean;
  setDebugMode: (v: boolean) => void;
  createPlan: () => Promise<void>;
  analyzeProject: () => Promise<void>;
  runDebug: (errorText: string) => Promise<void>;
  /** enough context to plan / analyze (a brief, or at least a conversation) */
  canAct: () => boolean;

  // ── Standard build (lite / 1.0 / pro) ─────────────────────────────────────
  buildLog: string;
  /** real (or, in demo mode, estimated) token usage for the current build/plan/analyze/debug action */
  buildUsage: UsageNotice | null;
  /** provider failure for the current build/plan/analyze/debug action */
  buildError: AofProviderError | null;
  building: boolean;
  abort: AbortController | null;
  runBuild: (task: string) => Promise<void>;
  stopBuild: () => void;
  clearBuild: () => void;

  // ── Titan workflow ────────────────────────────────────────────────────────
  titan: TitanState;
  titanStart: (prompt: string) => void;
  titanAnswer: (questionId: string, value: string) => void;
  titanSubmitAnswers: () => void;
  titanNext: () => void;
  titanChoosePlan: (id: "A" | "B" | "C") => void;
  titanApprove: () => Promise<void>;
  titanReset: () => void;
}

function phaseIndex(key: TitanPhaseKey): number {
  return TITAN_PHASES.findIndex((p) => p.key === key);
}
function nextPhase(key: TitanPhaseKey): TitanPhaseKey {
  const i = phaseIndex(key);
  return TITAN_PHASES[Math.min(i + 1, TITAN_PHASES.length - 1)].key;
}

/** Derive a TMAP task + grounding context from the approved brief, falling back
 *  to the raw conversation when no brief is ready yet. Shared by Generate / Plan /
 *  Analyze / Debug so every action builds on the same project context. */
function deriveBuildInput(
  convo: ChatMessageT[],
  brief: ProjectBrief | null,
): { task: string; context: string; briefText: string } {
  if (brief && briefReadiness(brief)) {
    const context = briefToContext(brief);
    return { task: briefToTask(brief), context, briefText: context };
  }
  const transcript = convo
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const firstUser = convo.find((m) => m.role === "user")?.content ?? "";
  const task = firstUser.trim().slice(0, 120) || "project from CoCode";
  return { task, context: conversationToContext(transcript), briefText: transcript };
}

/** Existing-project "iterate" path for `sendMessage` — file/git/diff context
 *  folded into the request and unified-diff extraction on the reply, same as
 *  the inline editor chat this replaces, now shared by the one agent
 *  composer. Goes through `streamCodeEdit` (demo-mode-aware, real error
 *  surfacing) rather than a hand-rolled fetch. Real diffs only: the model is
 *  asked for unified git diffs, and `extractDiffs` only returns what it can
 *  actually parse back out of the reply — nothing is fabricated if the model
 *  doesn't emit one. */
async function sendEditMessage(
  content: string,
  get: () => CodeState,
  set: (partial: Partial<CodeState> | ((s: CodeState) => Partial<CodeState>)) => void,
): Promise<void> {
  const ide = useCocodeIDEStore.getState();
  const history = get()
    .convo.filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const now = new Date().toISOString();
  const userMsg: ChatMessageT = { id: uid("m"), role: "user", content, createdAt: now };
  const assistantId = uid("m");
  const assistantMsg: ChatMessageT = {
    id: assistantId, role: "assistant", content: "", createdAt: now, streaming: true, model: get().mode,
  };
  set((s) => ({ chatting: true, projectActive: true, convo: [...s.convo, userMsg, assistantMsg] }));

  const files = ide.allFiles();
  const contextFiles = files.slice(0, 10)
    .map((f) => `// ${f.path}\n${f.content.slice(0, 500)}`)
    .join("\n\n---\n\n");
  const activeContext = ide.activeTab ? `\nCurrently editing: ${ide.activeTab}` : "";
  const gitContext = ide.github.connected && ide.github.repo ? `\nGit branch: ${ide.github.repo.branch}` : "";
  const diffContext = ide.diff ? `\n${ide.diff.files.length} pending change(s) awaiting review.` : "";
  const message =
    `${content}\n\n---\nWorkspace: ${files.length} file(s).${activeContext}${gitContext}${diffContext}\n` +
    `Files:\n${contextFiles}`;
  const activeFile = ide.activeTab ? { path: ide.activeTab, content: ide.activeFile()?.content ?? "" } : null;

  const append = (chunk: string) =>
    set((s) => ({ convo: s.convo.map((m) => m.id === assistantId ? { ...m, content: m.content + chunk } : m) }));
  const patch = (p: Partial<ChatMessageT>) =>
    set((s) => ({ convo: s.convo.map((m) => (m.id === assistantId ? { ...m, ...p } : m)) }));

  let full = "";
  try {
    await streamCodeEdit(message, activeFile, history, {
      onToken: (chunk) => { full += chunk; append(chunk); },
      onError: (error) => patch({ error, streaming: false }),
      onUsage: (usage) => patch({ usage }),
    }, get().effort);
    const diffs = extractDiffs(full);
    if (diffs.length) useCocodeIDEStore.getState().setDiff(diffs[0]);
  } finally {
    set((s) => ({
      chatting: false,
      convo: s.convo.map((m) => m.id === assistantId ? { ...m, streaming: false } : m),
    }));
    const savedUser = get().convo.find((m) => m.id === userMsg.id) ?? userMsg;
    const savedAssistant = get().convo.find((m) => m.id === assistantId) ?? assistantMsg;
    void persistCocodeTurn(get, savedUser, savedAssistant);
  }
}

/** After a build/Titan run produces code, load the generated files into the
 *  CoCode workspace's file explorer/editor so Build output and Files stay
 *  in sync — one workspace, not two disconnected views of the project — then
 *  jump straight into the editor with a live preview showing.
 *
 *  Default ("single") merges the project down to one self-contained
 *  `index.html` (mirrors what "Export as HTML" already produces) so simple
 *  generations don't dump a raw multi-file breakdown on the user. "split"
 *  (user explicitly asked) imports the full file-by-file output instead.
 *  Non-web projects (no renderable HTML/CSS/JS — e.g. a backend/CLI project)
 *  always get the full breakdown since there's nothing to merge into HTML. */
function bridgeToWorkspace(buildLog: string, mode: "single" | "split" = "single"): void {
  if (!buildLog.trim()) return;
  const files = extractGeneratedFiles(buildLog);
  if (!files.length) return;

  const ide = useCocodeIDEStore.getState();
  const previewable = canBuildHtml(files);

  if (mode === "single" && previewable) {
    ide.importFiles([{ path: "index.html", content: buildProjectHtml(files) }]);
    ide.openTab("index.html");
  } else {
    ide.importFiles(files);
    ide.openTab(files[0].path);
  }

  // Agent stays open (it's always visible now) — just point the stage at
  // whatever is most useful to look at: a live preview when the output is
  // renderable, otherwise the file that just landed in the editor.
  ide.setStage(previewable ? "preview" : "editor");
  ide.setMobileView(previewable ? "preview" : "editor");
}

export const useCodeStore = create<CodeState>()(
  persist(
    (set, get) => ({
  mode: "1.0",
  effort: "normal",
  setMode: (mode) => {
    // Titan is temporarily locked — the menu renders it with a padlock and
    // never calls this, but other entry points must not switch into it either.
    if (mode === "titan") return;
    // Pro / Titan are premium — guests are asked to sign in instead of switching.
    const access = checkUserAccess("premium-model", { codeMode: mode });
    if (!access.allowed) {
      useAuthStore.getState().openLoginModal(access.reason);
      return;
    }
    // Snap effort onto the new mode's scale (e.g. Kanon@High → Ypertatos@Ultra).
    set({ mode, effort: clampEffort(mode, get().effort) });
  },
  setEffort: (effort) => set({ effort: clampEffort(get().mode, effort) }),

  // ── Per-project chat persistence ───────────────────────────────────────────
  projectId: null,
  sessions: {},

  setActiveProject: (projectId) => {
    const state = get();
    const oldKey = state.projectId ?? SCRATCH_KEY;
    const newKey = projectId ?? SCRATCH_KEY;
    if (oldKey === newKey) return;
    const oldSession: CocodeSession = {
      convo: state.convo,
      brief: state.brief,
      phase: state.phase,
      projectActive: state.projectActive,
    };
    const newSession = state.sessions[newKey] ?? emptySession();
    set({
      projectId,
      sessions: { ...state.sessions, [oldKey]: oldSession },
      convo: newSession.convo,
      brief: newSession.brief,
      phase: newSession.phase,
      projectActive: newSession.projectActive,
    });
    void get().hydrateCocodeProject(projectId);
  },

  hydrateCocodeProject: async (projectId) => {
    if (!projectId || !conversationsEnabled()) return;
    const id = cocodeConversationId(projectId);
    if (hydratedProjects.has(id) || hydratingProjects.has(id)) return;
    hydratingProjects.add(id);
    try {
      const rows = await fetchMessages(id);
      // `null` = 404 = nothing saved server-side yet for this project — a
      // normal case (e.g. its first-ever chat), not an error.
      if (rows !== null) {
        createdConversations.add(id);
        const serverMessages = toChatMessages(rows);
        // The workspace may have switched to a different (or no) project
        // while this fetch was in flight — apply the result to wherever
        // that project's session actually lives now, never stomping the
        // now-active session with a stale fetch (mirrors open-project.ts's
        // loadWorkspaceFiles guard).
        if ((get().projectId ?? SCRATCH_KEY) === projectId) {
          set((s) => ({ convo: mergeServerMessages(s.convo, serverMessages) }));
        } else {
          set((s) => ({
            sessions: {
              ...s.sessions,
              [projectId]: {
                ...(s.sessions[projectId] ?? emptySession()),
                convo: mergeServerMessages(s.sessions[projectId]?.convo ?? [], serverMessages),
              },
            },
          }));
        }
      }
      hydratedProjects.add(id);
    } catch (err) {
      console.warn(
        "[code-store] hydrateCocodeProject failed:",
        err instanceof Error ? err.message : String(err),
        { projectId },
      );
    } finally {
      hydratingProjects.delete(id);
    }
  },

  migrateGuestCocode: async () => {
    if (!conversationsEnabled()) return;
    const state = get();
    const activeKey = state.projectId ?? SCRATCH_KEY;
    const map = new Map<string, CocodeSession>(Object.entries(state.sessions));
    map.set(activeKey, {
      convo: state.convo,
      brief: state.brief,
      phase: state.phase,
      projectActive: state.projectActive,
    });
    for (const [key, session] of map) {
      if (key === SCRATCH_KEY || !session.convo.length) continue;
      const id = cocodeConversationId(key);
      if (createdConversations.has(id)) continue;
      try {
        const firstUser = session.convo.find((m) => m.role === "user");
        await createConversation(
          { id, title: titleFrom(firstUser?.content ?? "CoCode chat"), model: state.mode },
          "cocode",
        );
        await saveMessages(id, session.convo);
        createdConversations.add(id);
        hydratedProjects.add(id);
      } catch {
        /* keep local copy; will retry on next save */
      }
    }
  },

  adoptProjectId: (projectId) => {
    const state = get();
    if (state.projectId === projectId) return;
    // Drop whatever was parked under SCRATCH_KEY (if anything) — this
    // session's convo is already live in the top-level fields below and is
    // simply gaining an id to persist under, not switching to a different
    // session.
    const { [SCRATCH_KEY]: _dropped, ...rest } = state.sessions;
    set({ projectId, sessions: rest });
    const convo = state.convo;
    if (!convo.length || !conversationsEnabled()) return;
    const id = cocodeConversationId(projectId);
    if (createdConversations.has(id)) return;
    void (async () => {
      try {
        const firstUser = convo.find((m) => m.role === "user");
        await createConversation(
          { id, title: titleFrom(firstUser?.content ?? "CoCode chat"), model: state.mode },
          "cocode",
        );
        // Only mark "created" on success — a failed create must stay
        // unmarked so the next persistCocodeTurn call (on the next turn)
        // retries it, instead of silently going straight to saveMessages
        // against a conversation row that was never actually inserted.
        createdConversations.add(id);
        await saveMessages(id, convo);
        hydratedProjects.add(id);
      } catch {
        /* keep local copy; will retry on the next turn's persistCocodeTurn */
      }
    })();
  },

  // ── Conversation-first workflow ────────────────────────────────────────────
  convo: [],
  brief: null,
  phase: "conversation",
  projectActive: false,
  chatting: false,
  convoAbort: null,
  outputKind: null,
  debugMode: false,

  setDebugMode: (v) => set({ debugMode: v }),

  sendMessage: async (text) => {
    const content = text.trim();
    if (!content || get().chatting || get().building) return;

    // Debug mode: route this message to the debugger instead of the conversation.
    if (get().debugMode) {
      set({ debugMode: false });
      await get().runDebug(content);
      return;
    }

    // Slash commands trigger systems directly — no model round-trip.
    if (/^\/gencode\b/i.test(content)) {
      await get().generate();
      return;
    }
    if (/^\/plan\b/i.test(content)) {
      await get().createPlan();
      return;
    }

    // ── Existing-project edit path ─────────────────────────────────────────
    // A non-empty workspace means the user is iterating on real files, not
    // discussing a brand-new one — route through the same file/git/diff-aware
    // edit flow the (now-retired) inline editor chat used, instead of the
    // brief-building RAA/DISCOVERY flow below. This is what lets one "Ask
    // CoCode" composer handle both build-new and edit-existing, chosen from
    // project state rather than a mode the user has to pick.
    if (useCocodeIDEStore.getState().allFiles().length > 0) {
      await sendEditMessage(content, get, set);
      return;
    }

    // ── V3 State Machine ───────────────────────────────────────────────────────
    // Classify before touching state so the decision is based on the CURRENT turn.
    const convState = classifyTurn({
      message: content,
      projectActive: get().projectActive,
      debugMode: false, // already handled above
    });

    // Prior turns as flat history for both paths.
    const history = get()
      .convo.filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const now = new Date().toISOString();
    const userMsg: ChatMessageT = { id: uid("m"), role: "user", content, createdAt: now };
    const assistantId = uid("m");
    const assistantMsg: ChatMessageT = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: now,
      streaming: true,
      model: get().mode,
    };
    set((s) => ({ chatting: true, convo: [...s.convo, userMsg, assistantMsg] }));

    const controller = new AbortController();
    set({ convoAbort: controller });
    const append = (chunk: string) =>
      set((s) => ({
        convo: s.convo.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + chunk } : m,
        ),
      }));
    const patch = (p: Partial<ChatMessageT>) =>
      set((s) => ({
        convo: s.convo.map((m) => (m.id === assistantId ? { ...m, ...p } : m)),
      }));
    // A provider failure must surface as an error panel — never a fabricated reply.
    const onError = (error: AofProviderError) => patch({ error, streaming: false });
    const onFailover = (failover: FailoverNotice) => patch({ failover });
    const onUsage = (usage: UsageNotice) => patch({ usage });

    try {
      if (convState === "NORMAL_CHAT") {
        // ── NORMAL_CHAT: casual reply, no RAA, no brief update ────────────────
        // Honour the shared Web Search preference so CoCode answers can be
        // grounded in live docs/web results too (spec §3 — every mode).
        // Model Workflow staging applies to Kanon ("1.0") and Ypertatos
        // ("pro") — Titan collapses to "lite" here, matching stagesFor()'s
        // single-stage stub (no staging change for that mode).
        const onStage = (st: StageNotice) =>
          patch({
            agentStatus:
              st.index === st.total && st.status === "running"
                ? undefined
                : `${st.label}: ${st.status === "running" ? "working…" : "done"}`,
          });
        const stagingModel: WorkflowModelId =
          get().mode === "1.0" ? "normal" : get().mode === "pro" ? "pro" : "lite";
        // Real, observed workspace metadata — the Ypertatos Task Classifier's
        // complexity signal (task-classifier.ts). Omitted entirely when the
        // workspace is empty (never guessed). Ignored server-side for any
        // tier but "pro".
        const workspaceFiles = useCocodeIDEStore.getState().allFiles();
        const repo = workspaceFiles.length
          ? {
              fileCount: workspaceFiles.length,
              languages: [
                ...new Set(
                  workspaceFiles
                    .map((f) => f.path.split(".").pop()?.toLowerCase() ?? "")
                    .filter(Boolean),
                ),
              ],
            }
          : undefined;
        await streamCodeChat(content, history, {
          onToken: append,
          signal: controller.signal,
          onError,
          onFailover,
          onUsage,
          onStage,
        }, get().effort, stagingModel, repo);
      } else {
        // ── DISCOVERY: RAA gathers requirements, brief may be emitted ─────────
        // Mark the project active so all subsequent turns stay in DISCOVERY
        // until the user explicitly hits "New".
        if (!get().projectActive) set({ projectActive: true });

        const { brief } = await streamRequirements(content, history, {
          onToken: append,
          signal: controller.signal,
          onError,
          onFailover,
          onUsage,
        }, get().effort);
        // On a fresh brief, capture it and strip the summary block from the bubble
        // (the structured brief is shown in its own panel).
        set((s) => ({
          brief: brief ?? s.brief,
          convo: s.convo.map((m) => {
            if (m.id !== assistantId) return m;
            const cleaned = brief ? stripBriefBlock(m.content) || m.content : m.content;
            return { ...m, content: cleaned, streaming: false };
          }),
        }));
      }
    } finally {
      set((s) => ({
        chatting: false,
        convoAbort: null,
        convo: s.convo.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      }));
      const savedUser = get().convo.find((m) => m.id === userMsg.id) ?? userMsg;
      const savedAssistant = get().convo.find((m) => m.id === assistantId) ?? assistantMsg;
      void persistCocodeTurn(get, savedUser, savedAssistant);
    }
  },

  stopChat: () => {
    get().convoAbort?.abort();
    set({ convoAbort: null, chatting: false });
  },

  canGenerate: () => !get().building && !get().chatting && briefReadiness(get().brief),

  canAct: () =>
    !get().building && !get().chatting && (get().convo.length > 0 || briefReadiness(get().brief)),

  generate: async () => {
    const { brief, mode, building, convo } = get();
    if (building || mode === "titan") return;

    const { task, context } = deriveBuildInput(convo, brief);
    const controller = new AbortController();
    set({ phase: "generating", building: true, buildLog: "", buildUsage: null, buildError: null, abort: controller, outputKind: "build" });
    try {
      // `mode` is narrowed to non-titan by the guard above.
      await streamCodeRun(
        task,
        mode as "lite" | "1.0" | "pro",
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          onUsage: (usage) => set({ buildUsage: usage }),
          signal: controller.signal,
          onError: (error) => set({ buildError: error }),
        },
        context,
        get().effort,
      );
    } finally {
      set({ building: false, abort: null, phase: "done" });
      if (!get().buildError) bridgeToWorkspace(get().buildLog);
    }
  },

  splitGeneratedFiles: () => bridgeToWorkspace(get().buildLog, "split"),

  createPlan: async () => {
    const { mode, building, convo, brief } = get();
    if (building || mode === "titan") return;
    const { task, context } = deriveBuildInput(convo, brief);
    const controller = new AbortController();
    set({ building: true, buildLog: "", buildUsage: null, buildError: null, abort: controller, outputKind: "plan" });
    try {
      await streamPlan(
        task,
        mode as "lite" | "1.0" | "pro",
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          onUsage: (usage) => set({ buildUsage: usage }),
          signal: controller.signal,
          onError: (error) => set({ buildError: error }),
        },
        context,
        get().effort,
      );
    } finally {
      set({ building: false, abort: null });
    }
  },

  analyzeProject: async () => {
    const { building, convo, brief } = get();
    if (building) return;
    const { briefText } = deriveBuildInput(convo, brief);
    const controller = new AbortController();
    set({ building: true, buildLog: "", buildUsage: null, buildError: null, abort: controller, outputKind: "analyze" });
    try {
      await streamAnalyze(briefText, {
        onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
        onUsage: (usage) => set({ buildUsage: usage }),
        signal: controller.signal,
        onError: (error) => set({ buildError: error }),
      }, get().effort);
    } finally {
      set({ building: false, abort: null });
    }
  },

  runDebug: async (errorText) => {
    const content = errorText.trim();
    if (!content || get().building) return;
    const { briefText } = deriveBuildInput(get().convo, get().brief);
    const controller = new AbortController();
    set({ building: true, buildLog: "", buildUsage: null, buildError: null, abort: controller, outputKind: "debug" });
    try {
      await streamDebug(
        { error: content, context: briefText },
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          onUsage: (usage) => set({ buildUsage: usage }),
          signal: controller.signal,
          onError: (error) => set({ buildError: error }),
        },
        get().effort,
      );
    } finally {
      set({ building: false, abort: null });
    }
  },

  resetConversation: () => {
    const projectId = get().projectId;
    set((s) => ({
      convo: [],
      brief: null,
      phase: "conversation",
      projectActive: false,
      buildLog: "",
      buildUsage: null,
      buildError: null,
      chatting: false,
      building: false,
      debugMode: false,
      outputKind: null,
      sessions: projectId ? { ...s.sessions, [projectId]: emptySession() } : s.sessions,
    }));
    // "New" is an honest reset — also clear the project's saved server-side
    // chat rather than leaving an orphaned row (CoCode has no conversation
    // list UI to reach it otherwise).
    if (projectId) {
      const id = cocodeConversationId(projectId);
      createdConversations.delete(id);
      if (conversationsEnabled()) {
        deleteConversationRemote(id, "cocode").catch(() => {});
      }
    }
  },

  buildLog: "",
  buildUsage: null,
  buildError: null,
  building: false,
  abort: null,

  runBuild: async (task) => {
    const t = task.trim();
    const mode = get().mode;
    if (!t || get().building || mode === "titan") return;
    const controller = new AbortController();
    set({ building: true, buildLog: "", buildUsage: null, buildError: null, abort: controller });
    try {
      await streamCodeRun(t, mode as "lite" | "1.0" | "pro", {
        onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
        onUsage: (usage) => set({ buildUsage: usage }),
        signal: controller.signal,
        onError: (error) => set({ buildError: error }),
      }, undefined, get().effort);
    } finally {
      set({ building: false, abort: null });
    }
  },

  stopBuild: () => {
    get().abort?.abort();
    set({ abort: null, building: false });
  },
  clearBuild: () => set({ buildLog: "", buildUsage: null, buildError: null }),

  // ── Titan ──────────────────────────────────────────────────────────────────
  titan: emptyTitan,

  titanStart: (prompt) => {
    const p = prompt.trim();
    if (!p) return;
    set({
      titan: {
        ...emptyTitan,
        active: true,
        prompt: p,
        phase: "clarify",
        questions: discoveryQuestions(p),
      },
    });
  },

  titanAnswer: (questionId, value) =>
    set((s) => ({
      titan: { ...s.titan, answers: { ...s.titan.answers, [questionId]: value } },
    })),

  titanSubmitAnswers: () => {
    const { questions, answers } = get().titan;
    const answered = questions.filter((q) => answers[q.id]).length;
    const ratio = questions.length ? answered / questions.length : 0;
    // Confidence gate (mirrors the >=85% rule enforced in core/titan.ts).
    const confidence = Math.round(60 + ratio * 38);
    set((s) => ({
      titan: { ...s.titan, confidence, phase: confidence >= 85 ? "requirements" : "clarify" },
    }));
  },

  titanNext: () => {
    const cur = get().titan.phase;
    const next = nextPhase(cur);
    // Lazily populate the data each phase needs as we arrive at it.
    set((s) => {
      const titan = { ...s.titan, phase: next };
      if (next === "plans" && titan.plans.length === 0) titan.plans = planOptions();
      if (next === "risk" && titan.risks.length === 0) titan.risks = riskReview();
      if (next === "architecture" && !titan.architecture)
        titan.architecture = architectureSketch(titan.prompt);
      return { titan };
    });
  },

  titanChoosePlan: (id) =>
    set((s) => ({
      titan: {
        ...s.titan,
        chosenPlan: id,
        plans: s.titan.plans.map((p) => ({ ...p, recommended: p.id === id })),
      },
    })),

  titanApprove: async () => {
    set((s) => ({ titan: { ...s.titan, approved: true, phase: "generate", buildLog: "" } }));
    const prompt = get().titan.prompt;
    let failed = false;
    // Only AFTER approval does Titan hand the blueprint to the build pipeline (Pro).
    // Titan is the fullest workflow, so its build runs at extreme effort.
    await streamCodeRun(prompt, "pro", {
      onToken: (chunk) =>
        set((s) => ({ titan: { ...s.titan, buildLog: s.titan.buildLog + chunk } })),
      // Surface a provider failure inline in the Titan build log — no fake output.
      onError: (error) => {
        failed = true;
        set((s) => ({
          titan: {
            ...s.titan,
            buildLog: `${s.titan.buildLog}\n\n\`\`\`\n${formatErrorBlock(error)}\n\`\`\`\n`,
          },
        }));
      },
    }, undefined, "extreme");
    if (!failed) bridgeToWorkspace(get().titan.buildLog);
  },

  titanReset: () => set({ titan: emptyTitan }),
    }),
    {
      // Project session memory — remember each project's conversation/brief
      // and the mode across reloads so CoCode doesn't re-ask what's already
      // been decided. `phase` is deliberately never persisted (matches the
      // pre-per-project behavior) — buildLog/building aren't persisted
      // either, so rehydrating into a stale "generating" phase with no
      // actual generation running would be misleading.
      name: "aof.code",
      partialize: (s) => {
        const key = s.projectId ?? SCRATCH_KEY;
        return {
          projectId: s.projectId,
          mode: s.mode,
          effort: s.effort,
          sessions: {
            ...s.sessions,
            [key]: { convo: s.convo, brief: s.brief, phase: "conversation" as CodePhase, projectActive: s.projectActive },
          },
        };
      },
      // Sessions persisted before the Titan lock may still carry mode:"titan" —
      // land them on the default mode instead of a mode they can no longer pick.
      merge: (persisted, current) => {
        const p = persisted as {
          projectId?: string | null;
          mode?: CodeMode;
          effort?: EffortLevel;
          sessions?: Record<string, CocodeSession>;
        };
        const sessions = p.sessions ?? {};
        const projectId = p.projectId ?? null;
        const active = sessions[projectId ?? SCRATCH_KEY] ?? emptySession();
        const merged: CodeState = {
          ...current,
          mode: p.mode ?? current.mode,
          effort: p.effort ?? current.effort,
          projectId,
          sessions,
          convo: active.convo,
          brief: active.brief,
          phase: "conversation",
          projectActive: active.projectActive,
        };
        if (merged.mode === "titan") merged.mode = "1.0";
        merged.effort = clampEffort(merged.mode, merged.effort ?? "normal");
        return merged;
      },
    },
  ),
);
