import { create } from "zustand";
import { streamCodeRun } from "@/lib/api";
import {
  discoveryQuestions,
  planOptions,
  riskReview,
  architectureSketch,
} from "@/lib/titan";
import { codeDiscoveryQuestions, buildCodePlan, composeDebug } from "@/lib/code-flow";
import { TITAN_PHASES } from "@/lib/constants";
import type {
  ClarifyQuestion,
  CodeMode,
  CodePlan,
  CodeStage,
  DebugAnswer,
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

  // ── Staged flow (Discover → Plan → Build → Debug) for lite / 1.0 / pro ─────
  stage: CodeStage;
  draftPrompt: string;
  questions: ClarifyQuestion[];
  answers: Record<string, string>;
  plan: CodePlan | null;
  debug: DebugAnswer | null;
  debugging: boolean;

  startDiscover: (prompt: string) => void;
  answerDiscover: (questionId: string, value: string) => void;
  toPlan: () => void;
  backToDiscover: () => void;
  confirmBuild: () => Promise<void>;
  runDebug: (error: string) => Promise<void>;
  resetFlow: () => void;

  // ── Standard build stream (shared by the flow) ────────────────────────────
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

  // ── Staged flow ─────────────────────────────────────────────────────────────
  stage: "idle",
  draftPrompt: "",
  questions: [],
  answers: {},
  plan: null,
  debug: null,
  debugging: false,

  startDiscover: (prompt) => {
    const p = prompt.trim();
    if (!p || get().building) return;
    set({
      stage: "discover",
      draftPrompt: p,
      questions: codeDiscoveryQuestions(p),
      answers: {},
      plan: null,
      debug: null,
      buildLog: "",
    });
  },

  answerDiscover: (questionId, value) =>
    set((s) => ({ answers: { ...s.answers, [questionId]: value } })),

  toPlan: () => {
    const { draftPrompt, answers } = get();
    if (!draftPrompt) return;
    set({ plan: buildCodePlan(draftPrompt, answers), stage: "plan" });
  },

  backToDiscover: () => set({ stage: "discover" }),

  confirmBuild: async () => {
    const { draftPrompt, plan, mode, building } = get();
    if (!plan || building || mode === "titan") return;
    const task = `${draftPrompt}\n\nStack: ${plan.stack}\nFeatures: ${plan.features.join(", ")}`;
    const controller = new AbortController();
    set({ stage: "building", building: true, buildLog: "", abort: controller });
    try {
      await streamCodeRun(task, mode as "lite" | "1.0" | "pro", {
        onToken: (chunk) => set((s) => ({ buildLog: s.buildLog + chunk })),
        signal: controller.signal,
      });
    } finally {
      set({ building: false, abort: null, stage: "done" });
    }
  },

  runDebug: async (error) => {
    const e = error.trim();
    if (!e || get().debugging) return;
    set({ debugging: true, debug: null });
    await new Promise((r) => setTimeout(r, 480));
    set({ debug: composeDebug(e), debugging: false });
  },

  resetFlow: () =>
    set({
      stage: "idle",
      draftPrompt: "",
      questions: [],
      answers: {},
      plan: null,
      debug: null,
      buildLog: "",
    }),

  // ── Standard build stream ───────────────────────────────────────────────────
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
    set({ abort: null, building: false, stage: get().stage === "building" ? "done" : get().stage });
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
