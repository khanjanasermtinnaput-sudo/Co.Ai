import { create } from "zustand";
import { streamCodeRun, streamRequirements } from "@/lib/api";
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
  chatting: boolean;
  convoAbort: AbortController | null;
  sendMessage: (text: string) => Promise<void>;
  stopChat: () => void;
  generate: () => Promise<void>;
  canGenerate: () => boolean;
  resetConversation: () => void;

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

export const useCodeStore = create<CodeState>((set, get) => ({
  mode: "1.0",
  setMode: (mode) => set({ mode }),

  // ── Conversation-first workflow ────────────────────────────────────────────
  convo: [],
  brief: null,
  phase: "conversation",
  chatting: false,
  convoAbort: null,

  sendMessage: async (text) => {
    const content = text.trim();
    if (!content || get().chatting || get().building) return;

    // /gencode triggers generation directly — no model round-trip.
    if (/^\/gencode\b/i.test(content)) {
      await get().generate();
      return;
    }

    // Prior turns become history; then append the new user + a streaming reply.
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
    set((s) => ({ chatting: true, convo: [...s.convo, userMsg, assistantMsg] }));

    const controller = new AbortController();
    set({ convoAbort: controller });
    const append = (chunk: string) =>
      set((s) => ({
        convo: s.convo.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + chunk } : m,
        ),
      }));

    try {
      const { brief } = await streamRequirements(content, history, {
        onToken: append,
        signal: controller.signal,
      });
      // On a fresh brief, capture it and tidy the bubble (the structured brief is
      // shown in its own panel, so strip the raw summary block from the message).
      set((s) => ({
        brief: brief ?? s.brief,
        convo: s.convo.map((m) => {
          if (m.id !== assistantId) return m;
          const cleaned = brief ? stripBriefBlock(m.content) || m.content : m.content;
          return { ...m, content: cleaned, streaming: false };
        }),
      }));
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

  generate: async () => {
    const { brief, mode, building } = get();
    if (building || mode === "titan") return;

    // Ground generation in the approved brief; fall back to the raw conversation
    // when the user forces /gencode before a brief is ready.
    let task: string;
    let context: string;
    if (briefReadiness(brief) && brief) {
      task = briefToTask(brief);
      context = briefToContext(brief);
    } else {
      const transcript = get()
        .convo.filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      const firstUser = get().convo.find((m) => m.role === "user")?.content ?? "";
      task = firstUser.trim().slice(0, 120) || "project from Aof Code";
      context = conversationToContext(transcript);
    }

    const controller = new AbortController();
    set({ phase: "generating", building: true, buildLog: "", abort: controller });
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

  resetConversation: () =>
    set({
      convo: [],
      brief: null,
      phase: "conversation",
      buildLog: "",
      chatting: false,
      building: false,
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
}));
