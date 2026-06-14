"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Hexagon,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  Lightbulb,
  Layers,
  GitBranch,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCodeStore } from "@/store/code-store";
import type { TitanPlanOption, TitanRisk } from "@/lib/types";
import { Composer } from "@/components/composer/composer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TitanStepper } from "./titan-stepper";

export function TitanWorkflow() {
  const titan = useCodeStore((s) => s.titan);

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-5 sm:px-6">
      {titan.active && (
        <div className="mb-5">
          <TitanStepper current={titan.phase} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={titan.phase + String(titan.active)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <PhaseContent />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function PhaseContent() {
  const titan = useCodeStore((s) => s.titan);
  if (!titan.active || titan.phase === "discovery") return <DiscoveryPhase />;
  switch (titan.phase) {
    case "clarify":
      return <ClarifyPhase />;
    case "requirements":
      return <RequirementsPhase />;
    case "analysis":
      return <AnalysisPhase />;
    case "plans":
      return <PlansPhase />;
    case "risk":
      return <RiskPhase />;
    case "architecture":
      return <ArchitecturePhase />;
    case "approval":
      return <ApprovalPhase />;
    case "generate":
      return <GeneratePhase />;
    default:
      return <DiscoveryPhase />;
  }
}

// ── Shared pieces ──────────────────────────────────────────────────────────────

function PhaseHeading({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Hexagon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function ContinueBar({
  onContinue,
  label = "Continue",
  disabled,
}: {
  onContinue: () => void;
  label?: string;
  disabled?: boolean;
}) {
  const reset = useCodeStore((s) => s.titanReset);
  return (
    <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
      <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
        <RotateCcw className="size-3.5" /> Start over
      </Button>
      <Button onClick={onContinue} disabled={disabled}>
        {label} <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/[0.07] bg-card/60 p-5", className)}>
      {children}
    </div>
  );
}

// ── Phase 1 — Discovery ─────────────────────────────────────────────────────────

const TITAN_CAPABILITIES = [
  {
    label: "Deep reasoning",
    description: "Break hard problems apart, weigh trade-offs, decide with confidence.",
  },
  {
    label: "Research & analysis",
    description: "Feasibility, performance, security and cost — examined, not guessed.",
  },
  {
    label: "Architecture & planning",
    description: "System design, product strategy and a plan you can act on.",
  },
];

function DiscoveryPhase() {
  const start = useCodeStore((s) => s.titanStart);
  return (
    <div className="flex flex-col items-center pt-2 text-center sm:pt-6">
      <motion.span
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-gradient-gold"
      >
        <Hexagon className="size-3.5 text-primary" /> Highest intelligence mode
      </motion.span>
      <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        <span className="text-gradient-gold">Titan</span>
      </h1>
      <p className="mt-3 text-balance text-lg font-medium text-foreground sm:text-xl">
        Advanced Reasoning &amp; Research Engine
      </p>
      <p className="mt-2 max-w-lg text-balance text-muted-foreground">
        Built for complex thinking, research, architecture, planning and problem
        solving. Describe the problem — Titan reasons through it before it answers.
      </p>

      <div className="mt-7 w-full max-w-2xl text-left">
        <Composer
          size="lg"
          autoFocus
          placeholder="What would you like Titan to analyze?"
          onSubmit={start}
        />
        <p className="mt-3 px-1 text-xs text-muted-foreground">
          e.g. “Design a scalable architecture for a real-time chat platform.”
        </p>
      </div>

      <div className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-3">
        {TITAN_CAPABILITIES.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-card/40 p-3 text-left">
            <p className="text-xs font-semibold text-foreground">{c.label}</p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Phase 2 — Clarify ───────────────────────────────────────────────────────────

function ClarifyPhase() {
  const titan = useCodeStore((s) => s.titan);
  const answer = useCodeStore((s) => s.titanAnswer);
  const submit = useCodeStore((s) => s.titanSubmitAnswers);
  const answeredCount = titan.questions.filter((q) => titan.answers[q.id]).length;
  const lowConfidence = titan.confidence > 0 && titan.confidence < 85;

  return (
    <div>
      <PhaseHeading
        icon={Lightbulb}
        title="A few questions first"
        subtitle="Titan asks until it understands ≥ 85% of the goal. No assumptions."
      />

      {lowConfidence && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300">
          <ShieldAlert className="size-4 shrink-0" />
          Confidence is {titan.confidence}% — below the 85% gate. Answer the remaining
          questions so Titan can plan responsibly.
        </div>
      )}

      <div className="space-y-3">
        {titan.questions.map((q, i) => (
          <Panel key={q.id}>
            <p className="mb-3 text-sm font-medium">
              <span className="mr-2 font-mono text-xs text-primary">{i + 1}.</span>
              {q.question}
            </p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const selected = titan.answers[q.id] === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => answer(q.id, opt)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition-all",
                      selected
                        ? "border-primary/50 bg-primary/15 text-foreground shadow-glow-sm"
                        : "border-border bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      {titan.confidence > 0 && <ConfidenceMeter value={titan.confidence} />}

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">
          {answeredCount}/{titan.questions.length} answered
        </span>
        <Button onClick={submit} disabled={answeredCount === 0}>
          Analyze answers <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const ok = value >= 85;
  return (
    <div className="mt-5 rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Gauge className="size-4 text-primary" /> Requirement confidence
        </span>
        <span className={cn("font-semibold", ok ? "text-success" : "text-amber-400")}>
          {value}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={cn("h-full rounded-full", ok ? "bg-success" : "bg-amber-400")}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Gate: Titan only plans at ≥ 85% confidence.
      </p>
    </div>
  );
}

// ── Phase 3 — Requirements ──────────────────────────────────────────────────────

function RequirementsPhase() {
  const titan = useCodeStore((s) => s.titan);
  const next = useCodeStore((s) => s.titanNext);
  return (
    <div>
      <PhaseHeading
        icon={CheckCircle2}
        title="Requirements locked"
        subtitle="Here's what Titan understood. Everything below is now the source of truth."
      />
      <Panel>
        <p className="mb-3 text-sm font-medium text-foreground">Goal</p>
        <p className="mb-4 rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
          {titan.prompt}
        </p>
        <p className="mb-3 text-sm font-medium text-foreground">Decisions</p>
        <ul className="space-y-2">
          {titan.questions.map((q) => (
            <li key={q.id} className="flex items-start justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{q.question}</span>
              <span className="shrink-0 font-medium text-foreground">
                {titan.answers[q.id] ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <ContinueBar onContinue={next} label="Run deep analysis" />
    </div>
  );
}

// ── Phase 4 — Deep Analysis ─────────────────────────────────────────────────────

const ANALYSIS = [
  "Feasibility: achievable with a mainstream stack; no exotic dependencies required.",
  "Performance: read-heavy workload — cache hot paths, paginate everything.",
  "Security: define the auth boundary now; validate all inputs server-side.",
  "Scalability: keep the API stateless so it scales horizontally when needed.",
  "Cost: start on a generous free tier; the design avoids premature infra spend.",
  "Maintainability: clear module boundaries keep change cost low as it grows.",
];

function AnalysisPhase() {
  const next = useCodeStore((s) => s.titanNext);
  return (
    <div>
      <PhaseHeading
        icon={Gauge}
        title="Deep analysis"
        subtitle="Feasibility, performance, security, scalability, cost and maintainability."
      />
      <div className="grid gap-2.5 sm:grid-cols-2">
        {ANALYSIS.map((a) => (
          <Panel key={a} className="p-4">
            <p className="flex gap-2.5 text-sm text-muted-foreground">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{a}</span>
            </p>
          </Panel>
        ))}
      </div>
      <ContinueBar onContinue={next} label="Generate plans" />
    </div>
  );
}

// ── Phase 5 — Multi-plan ────────────────────────────────────────────────────────

function PlansPhase() {
  const titan = useCodeStore((s) => s.titan);
  const choose = useCodeStore((s) => s.titanChoosePlan);
  const next = useCodeStore((s) => s.titanNext);
  return (
    <div>
      <PhaseHeading
        icon={Layers}
        title="Three plans, honest trade-offs"
        subtitle="Pick the direction. Titan recommends Plan B for most projects."
      />
      <div className="grid gap-3 lg:grid-cols-3">
        {titan.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            selected={titan.chosenPlan === plan.id}
            onSelect={() => choose(plan.id)}
          />
        ))}
      </div>
      <ContinueBar
        onContinue={next}
        label="Review risks"
        disabled={!titan.chosenPlan}
      />
    </div>
  );
}

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: TitanPlanOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-full flex-col rounded-2xl border p-4 text-left transition-card",
        selected
          ? "border-primary/50 bg-primary/[0.06] shadow-glow"
          : "border-white/[0.07] bg-card/60 hover:border-primary/30",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{plan.title}</span>
        {plan.recommended && (
          <Badge variant="default" className="px-1.5 py-0 text-[10px]">
            Recommended
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>

      <div className="mt-3 space-y-1">
        {plan.pros.map((p) => (
          <p key={p} className="flex gap-1.5 text-xs text-foreground/80">
            <span className="text-success">+</span> {p}
          </p>
        ))}
        {plan.cons.map((c) => (
          <p key={c} className="flex gap-1.5 text-xs text-muted-foreground">
            <span className="text-destructive">−</span> {c}
          </p>
        ))}
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2 pt-4 text-center">
        <Stat label="Scale" value={`${plan.scalability}/10`} />
        <Stat label="Maintain" value={`${plan.maintainability}/10`} />
        <Stat label="Cost" value={plan.cost} />
      </div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 py-1.5">
      <p className="text-[13px] font-semibold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Phase 6 — Risk review ───────────────────────────────────────────────────────

function RiskPhase() {
  const titan = useCodeStore((s) => s.titan);
  const next = useCodeStore((s) => s.titanNext);
  return (
    <div>
      <PhaseHeading
        icon={ShieldAlert}
        title="Devil's advocate"
        subtitle="Titan attacks its own recommendation before you commit."
      />
      <div className="space-y-2.5">
        {titan.risks.map((r) => (
          <RiskRow key={r.title} risk={r} />
        ))}
      </div>
      <ContinueBar onContinue={next} label="Design architecture" />
    </div>
  );
}

function RiskRow({ risk }: { risk: TitanRisk }) {
  const tone =
    risk.level === "high"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : risk.level === "med"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : "border-border bg-card/40 text-muted-foreground";
  return (
    <Panel className="flex items-start gap-3 p-4">
      <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase", tone)}>
        {risk.level}
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{risk.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{risk.detail}</p>
      </div>
    </Panel>
  );
}

// ── Phase 7 — Architecture ──────────────────────────────────────────────────────

function ArchitecturePhase() {
  const titan = useCodeStore((s) => s.titan);
  const next = useCodeStore((s) => s.titanNext);
  return (
    <div>
      <PhaseHeading
        icon={GitBranch}
        title="Architecture design"
        subtitle="System, modules, data and deployment — described, never coded."
      />
      <Panel className="overflow-x-auto p-0">
        <pre className="whitespace-pre p-5 font-mono text-[13px] leading-relaxed text-foreground/85">
          {titan.architecture}
        </pre>
      </Panel>
      <ContinueBar onContinue={next} label="Go to approval gate" />
    </div>
  );
}

// ── Phase 8 — Approval gate ─────────────────────────────────────────────────────

function ApprovalPhase() {
  const titan = useCodeStore((s) => s.titan);
  const approve = useCodeStore((s) => s.titanApprove);
  const reset = useCodeStore((s) => s.titanReset);
  const chosen = titan.plans.find((p) => p.id === titan.chosenPlan);

  return (
    <div className="mx-auto max-w-xl text-center">
      <motion.span
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="inline-flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary"
      >
        <ShieldCheck className="size-7" />
      </motion.span>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">Approval gate</h2>
      <p className="mt-2 text-muted-foreground">
        Nothing is built without your sign-off. Review the blueprint summary, then
        release it to the build pipeline.
      </p>

      <div className="mt-6 rounded-2xl border border-white/[0.07] bg-card/60 p-5 text-left">
        <Row label="Project" value={titan.prompt} />
        <Row label="Chosen plan" value={chosen ? `${chosen.title} — ${chosen.tagline}` : "—"} />
        <Row label="Confidence" value={`${titan.confidence}%`} />
        <Row label="Build mode" value="Aof Code · Pro (multi-pass review)" last />
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button variant="ghost" onClick={reset} className="text-muted-foreground">
          <RotateCcw className="size-4" /> Refine requirements
        </Button>
        <Button size="lg" onClick={() => void approve()} className="px-6">
          <Sparkles className="size-4" /> Approve &amp; generate code
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-6 py-2.5 text-sm",
        !last && "border-b border-border",
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

// ── Phase 9 — Generate ──────────────────────────────────────────────────────────

function GeneratePhase() {
  const titan = useCodeStore((s) => s.titan);
  const reset = useCodeStore((s) => s.titanReset);
  const done = titan.buildLog.includes("Done.");
  return (
    <div>
      <PhaseHeading
        icon={done ? CheckCircle2 : Hexagon}
        title={done ? "Blueprint built" : "Generating from approved blueprint"}
        subtitle="Titan handed the plan to the Pro build pipeline."
      />
      <Panel className="p-0">
        <div className="max-h-[46vh] overflow-y-auto p-5">
          {titan.buildLog ? (
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-foreground/85">
              {titan.buildLog}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">Starting build…</p>
          )}
        </div>
      </Panel>
      {done && (
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <span className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" /> Ready to continue in Projects
          </span>
          <Button variant="secondary" onClick={reset}>
            <RotateCcw className="size-4" /> New Titan session
          </Button>
        </div>
      )}
    </div>
  );
}
