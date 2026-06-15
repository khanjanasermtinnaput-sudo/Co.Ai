import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  streamCodeChat,
  streamCodeRun,
  streamRequirements,
  streamPlan,
  streamAnalyze,
  streamDebug,
} from "@/lib/api";
import { classifyTurn } from "@/lib/conversation-state";
import type { AofProviderError, FailoverInfo } from "@/lib/provider-errors";
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
import { uid } from "@/lib/utils";
import type {
  ChatMessageT,
  ClarifyQuestion,
  CodeMode,
  CodePhase,
  ProjectBrief,
  TitanPhaseKey,
  TitanPlanOption,
  TitanRisk,
} from "@/lib/types";

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

interface CodeState {
  mode: CodeMode;
  setMode: (m: CodeMode) => void;

  // ── Conversation-first workflow (RAA → brief → generate) ──────────────────
  // Aof Code discusses the project first; TMAP only runs on an explicit trigger
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

  // ── AI provider error handling (transparency-first) ───────────────────────
  /** The current critical provider error, shown in the error panel. Null = healthy. */
  providerError: AofProviderError | null;
  /** Set when a fallback provider took over the last request. */
  failover: FailoverInfo | null;
  /** Developer mode — surface raw error/status/stack in the error panel. */
  devMode: boolean;
  setDevMode: (v: boolean) => void;
  dismissError: () => void;
  /** Re-send the last user message (used by the error panel's Retry button). */
  retryLast: () => Promise<void>;

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
  const task = firstUser.trim().slice(0, 120) || "project from Aof Code";
  return { task, context: conversationToContext(transcript), briefText: transcript };
}

export const useCodeStore = create<CodeState>()(
  persist(
    (set, get) => ({
  mode: "1.0",
  setMode: (mode) => set({ mode }),

  // ── Conversation-first workflow ────────────────────────────────────────────
  convo: [],
  brief: null,
  phase: "conversation",
  projectActive: false,
  chatting: false,
  convoAbort: null,
  outputKind: null,
  debugMode: false,

  providerError: null,
  failover: null,
  devMode: false,
  setDevMode: (v) => {
    set({ devMode: v });
    if (typeof window !== "undefined") {
      if (v) window.localStorage.setItem("aof.devMode", "1");
      else window.localStorage.removeItem("aof.devMode");
    }
  },
  dismissError: () => set({ providerError: null }),

  retryLast: async () => {
    if (get().chatting || get().building) return;
    const convo = get().convo;
    const idx = convo.map((m) => m.role).lastIndexOf("user");
    if (idx === -1) return;
    const lastUser = convo[idx];
    // Drop the previous attempt (the user msg + any failed remnant); sendMessage re-adds it.
    set({ convo: convo.slice(0, idx), providerError: null });
    await get().sendMessage(lastUser.content);
  },

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
    };
    // New attempt → clear any prior error/failover notice.
    set((s) => ({ chatting: true, providerError: null, failover: null, convo: [...s.convo, userMsg, assistantMsg] }));

    const controller = new AbortController();
    set({ convoAbort: controller });
    const append = (chunk: string) =>
      set((s) => ({
        convo: s.convo.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + chunk } : m,
        ),
      }));

    // Transparency-first error handling: surface the structured provider error in
    // the error panel and drop the empty assistant bubble (never fake a reply).
    const onError = (err: AofProviderError) =>
      set((s) => ({
        providerError: err,
        convo: s.convo.filter((m) => !(m.id === assistantId && m.content.trim() === "")),
      }));
    const onFailover = (info: FailoverInfo) => set({ failover: info });
    const handlers = { onToken: append, onError, onFailover, signal: controller.signal };

    try {
      if (convState === "NORMAL_CHAT") {
        // ── NORMAL_CHAT: casual reply, no RAA, no brief update ────────────────
        await streamCodeChat(content, history, handlers);
      } else {
        // ── DISCOVERY: RAA gathers requirements, brief may be emitted ─────────
        // Mark the project active so all subsequent turns stay in DISCOVERY
        // until the user explicitly hits "New".
        if (!get().projectActive) set({ projectActive: true });

        const { brief } = await streamRequirements(content, history, handlers);
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
    set({ phase: "generating", building: true, buildLog: "", abort: controller, outputKind: "build" });
    try {
      // `mode` is narrowed to non-titan by the guard above.
      await streamCodeRun(
        task,
        mode as "lite" | "1.0" | "pro",
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          signal: controller.signal,
        },
        context,
      );
    } finally {
      set({ building: false, abort: null, phase: "done" });
    }
  },

  createPlan: async () => {
    const { mode, building, convo, brief } = get();
    if (building || mode === "titan") return;
    const { task, context } = deriveBuildInput(convo, brief);
    const controller = new AbortController();
    set({ building: true, buildLog: "", abort: controller, outputKind: "plan" });
    try {
      await streamPlan(
        task,
        mode as "lite" | "1.0" | "pro",
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          signal: controller.signal,
        },
        context,
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
    set({ building: true, buildLog: "", abort: controller, outputKind: "analyze" });
    try {
      await streamAnalyze(briefText, {
        onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
        signal: controller.signal,
      });
    } finally {
      set({ building: false, abort: null });
    }
  },

  runDebug: async (errorText) => {
    const content = errorText.trim();
    if (!content || get().building) return;
    const { briefText } = deriveBuildInput(get().convo, get().brief);
    const controller = new AbortController();
    set({ building: true, buildLog: "", abort: controller, outputKind: "debug" });
    try {
      await streamDebug(
        { error: content, context: briefText },
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          signal: controller.signal,
        },
      );
    } finally {
      set({ building: false, abort: null });
    }
  },

  resetConversation: () =>
    set({
      convo: [],
      brief: null,
      phase: "conversation",
      projectActive: false,
      buildLog: "",
      chatting: false,
      building: false,
      debugMode: false,
      outputKind: null,
      providerError: null,
      failover: null,
    }),

  buildLog: "",
  building: false,
  abort: null,

  runBuild: async (task) => {
    const t = task.trim();
    const mode = get().mode;
    if (!t || get().building || mode === "titan") return;
    const controller = new AbortController();
    set({ building: true, buildLog: "", abort: controller });
    try {
      await streamCodeRun(t, mode as "lite" | "1.0" | "pro", {
        onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
        signal: controller.signal,
      });
    } finally {
      set({ building: false, abort: null });
    }
  },

  stopBuild: () => {
    get().abort?.abort();
    set({ abort: null, building: false });
  },
  clearBuild: () => set({ buildLog: "" }),

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
    // Only AFTER approval does Titan hand the blueprint to the build pipeline (Pro).
    await streamCodeRun(prompt, "pro", {
      onToken: (chunk) =>
        set((s) => ({ titan: { ...s.titan, buildLog: s.titan.buildLog + chunk } })),
    });
  },

  titanReset: () => set({ titan: emptyTitan }),
    }),
    {
      // Project session memory — remember the conversation, brief and mode across
      // reloads so Aof Code doesn't re-ask what's already been decided.
      name: "aof.code",
      partialize: (s) => ({
        convo: s.convo,
        brief: s.brief,
        mode: s.mode,
        projectActive: s.projectActive,
        devMode: s.devMode,
      }),
    },
  ),
);
