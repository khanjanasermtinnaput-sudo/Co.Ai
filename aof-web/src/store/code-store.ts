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
import { useChatStore } from "@/store/chat-store";
import { uid } from "@/lib/utils";
import { formatErrorBlock, type AofProviderError, type FailoverNotice } from "@/lib/errors";
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

export const useCodeStore = create<CodeState>()(
  persist(
    (set, get) => ({
  mode: "1.0",
  setMode: (mode) => {
    // Pro / Titan are premium — guests are asked to sign in instead of switching.
    const access = checkUserAccess("premium-model", { codeMode: mode });
    if (!access.allowed) {
      useAuthStore.getState().openLoginModal(access.reason);
      return;
    }
    set({ mode });
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

    try {
      if (convState === "NORMAL_CHAT") {
        // ── NORMAL_CHAT: casual reply, no RAA, no brief update ────────────────
        // Honour the shared Web Search preference so CoCode answers can be
        // grounded in live docs/web results too (spec §3 — every mode).
        await streamCodeChat(content, history, {
          onToken: append,
          signal: controller.signal,
          onError,
          onFailover,
        }, useChatStore.getState().searchMode);
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
        });
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
    set({ phase: "generating", building: true, buildLog: "", buildError: null, abort: controller, outputKind: "build" });
    try {
      // `mode` is narrowed to non-titan by the guard above.
      await streamCodeRun(
        task,
        mode as "lite" | "1.0" | "pro",
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          signal: controller.signal,
          onError: (error) => set({ buildError: error }),
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
    set({ building: true, buildLog: "", buildError: null, abort: controller, outputKind: "plan" });
    try {
      await streamPlan(
        task,
        mode as "lite" | "1.0" | "pro",
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          signal: controller.signal,
          onError: (error) => set({ buildError: error }),
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
    set({ building: true, buildLog: "", buildError: null, abort: controller, outputKind: "analyze" });
    try {
      await streamAnalyze(briefText, {
        onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
        signal: controller.signal,
        onError: (error) => set({ buildError: error }),
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
    set({ building: true, buildLog: "", buildError: null, abort: controller, outputKind: "debug" });
    try {
      await streamDebug(
        { error: content, context: briefText },
        {
          onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
          signal: controller.signal,
          onError: (error) => set({ buildError: error }),
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
      buildError: null,
      chatting: false,
      building: false,
      debugMode: false,
      outputKind: null,
    }),

  buildLog: "",
  buildError: null,
  building: false,
  abort: null,

  runBuild: async (task) => {
    const t = task.trim();
    const mode = get().mode;
    if (!t || get().building || mode === "titan") return;
    const controller = new AbortController();
    set({ building: true, buildLog: "", buildError: null, abort: controller });
    try {
      await streamCodeRun(t, mode as "lite" | "1.0" | "pro", {
        onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
        signal: controller.signal,
        onError: (error) => set({ buildError: error }),
      });
    } finally {
      set({ building: false, abort: null });
    }
  },

  stopBuild: () => {
    get().abort?.abort();
    set({ abort: null, building: false });
  },
  clearBuild: () => set({ buildLog: "", buildError: null }),

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
      // Surface a provider failure inline in the Titan build log — no fake output.
      onError: (error) =>
        set((s) => ({
          titan: {
            ...s.titan,
            buildLog: `${s.titan.buildLog}\n\n\`\`\`\n${formatErrorBlock(error)}\n\`\`\`\n`,
          },
        })),
    });
  },

  titanReset: () => set({ titan: emptyTitan }),
    }),
    {
      // Project session memory — remember the conversation, brief and mode across
      // reloads so CoCode doesn't re-ask what's already been decided.
      name: "aof.code",
      partialize: (s) => ({ convo: s.convo, brief: s.brief, mode: s.mode, projectActive: s.projectActive }),
    },
  ),
);
