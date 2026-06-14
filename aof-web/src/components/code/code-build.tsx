"use client";

import { motion } from "framer-motion";
import {
  Terminal,
  FileCode2,
  Boxes,
  Compass,
  ListTree,
  Wrench,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  CheckCircle2,
  Sparkles,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCodeStore } from "@/store/code-store";
import { CODE_MODES } from "@/lib/constants";
import type { CodeMode } from "@/lib/types";
import { Composer } from "@/components/composer/composer";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";

const EXAMPLES = [
  "A responsive pricing page with a monthly/yearly toggle",
  "A REST API for a todo app in Node.js",
  "A snake game that runs in the browser",
  "A CLI that renames files by date",
];

const FLOW = [
  { key: "discover", label: "Discover", icon: Compass },
  { key: "plan", label: "Plan", icon: ListTree },
  { key: "build", label: "Build", icon: Boxes },
  { key: "debug", label: "Debug", icon: Wrench },
] as const;

export function CodeBuild({ mode }: { mode: Exclude<CodeMode, "titan"> }) {
  const stage = useCodeStore((s) => s.stage);
  const info = CODE_MODES.find((m) => m.id === mode)!;

  const stepIndex =
    stage === "discover" ? 0 : stage === "plan" ? 1 : stage === "idle" ? -1 : 2;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {stage !== "idle" && <FlowSteps active={stepIndex} />}
          {stage === "idle" && <IdleStage info={info} />}
          {stage === "discover" && <DiscoverStage />}
          {stage === "plan" && <PlanStage />}
          {(stage === "building" || stage === "done") && <BuildStage />}
        </div>
      </div>

      <Footer info={info} />
    </div>
  );
}

// ── Stage rail ─────────────────────────────────────────────────────────────────

function FlowSteps({ active }: { active: number }) {
  return (
    <div className="mb-6 flex items-center gap-1.5">
      {FLOW.map((s, i) => {
        const Icon = s.icon;
        const state = i < active ? "done" : i === active ? "active" : "todo";
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                state === "active"
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : state === "done"
                    ? "border-success/30 bg-success/5 text-success"
                    : "border-border bg-card/40 text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {s.label}
            </span>
            {i < FLOW.length - 1 && <span className="h-px w-3 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Stage 0 · Idle (entry) ──────────────────────────────────────────────────────

function IdleStage({ info }: { info: (typeof CODE_MODES)[number] }) {
  const startDiscover = useCodeStore((s) => s.startDiscover);
  return (
    <div className="flex flex-col items-center pt-6 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-card"
      >
        <Boxes className="size-7 text-primary" />
      </motion.div>
      <h2 className="mt-5 text-xl font-semibold">Build with Aof Code</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {info.tagline} mode. Tell me what you want to build — I&apos;ll ask a couple of
        questions and show you a plan before writing any code.
      </p>
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => startDiscover(ex)}
            className="rounded-xl border border-border bg-card/50 p-3 text-left text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
          >
            <FileCode2 className="mb-1.5 size-4 text-primary/80" />
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Stage 1 · Discover ──────────────────────────────────────────────────────────

function DiscoverStage() {
  const draftPrompt = useCodeStore((s) => s.draftPrompt);
  const questions = useCodeStore((s) => s.questions);
  const answers = useCodeStore((s) => s.answers);
  const answer = useCodeStore((s) => s.answerDiscover);
  const toPlan = useCodeStore((s) => s.toPlan);
  const reset = useCodeStore((s) => s.resetFlow);
  const answered = questions.filter((q) => answers[q.id]).length;

  return (
    <div>
      <Heading
        icon={Compass}
        title="Let's scope this first"
        subtitle="A few quick questions so I build the right thing — not just something."
      />

      <div className="mb-4 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm">
        <span className="text-muted-foreground">Building: </span>
        <span className="text-foreground">{draftPrompt}</span>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-2xl border border-white/[0.07] bg-card/60 p-4">
            <p className="mb-3 text-sm font-medium">
              <span className="mr-2 font-mono text-xs text-primary">{i + 1}.</span>
              {q.question}
            </p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const selected = answers[q.id] === opt;
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
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
          <RotateCcw className="size-3.5" /> Start over
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {answered}/{questions.length} answered
          </span>
          <Button onClick={toPlan}>
            See the plan <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Stage 2 · Plan ──────────────────────────────────────────────────────────────

function PlanStage() {
  const plan = useCodeStore((s) => s.plan);
  const back = useCodeStore((s) => s.backToDiscover);
  const confirmBuild = useCodeStore((s) => s.confirmBuild);
  if (!plan) return null;

  return (
    <div>
      <Heading
        icon={ListTree}
        title="Here's the plan"
        subtitle="Review the architecture before I generate anything. Adjust or approve."
      />

      <p className="mb-4 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
        {plan.summary}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Project structure" icon={ListTree}>
          <ul className="space-y-1.5">
            {plan.structure.map((line) => {
              const [path, ...rest] = line.split(" — ");
              return (
                <li key={line} className="text-sm">
                  <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-primary/90">
                    {path}
                  </code>
                  {rest.length > 0 && (
                    <span className="ml-2 text-muted-foreground">{rest.join(" — ")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Features" icon={Sparkles}>
          <ol className="space-y-1.5">
            {plan.features.map((f, i) => (
              <li key={f} className="flex gap-2.5 text-sm text-foreground/85">
                <span className="font-mono text-xs text-primary">{i + 1}.</span>
                {f}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel title="Stack" icon={Layers} className="mt-3">
        <p className="text-sm text-foreground/85">{plan.stack}</p>
      </Panel>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" size="sm" onClick={back} className="text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Adjust answers
        </Button>
        <Button onClick={() => void confirmBuild()}>
          <Boxes className="size-4" /> Looks good — build it
        </Button>
      </div>
    </div>
  );
}

// ── Stage 3/4 · Build + Debug ───────────────────────────────────────────────────

function BuildStage() {
  const buildLog = useCodeStore((s) => s.buildLog);
  const building = useCodeStore((s) => s.building);
  const reset = useCodeStore((s) => s.resetFlow);
  const done = !building && buildLog.length > 0;

  return (
    <div>
      <Heading
        icon={building ? Boxes : CheckCircle2}
        title={building ? "Building…" : "Build complete"}
        subtitle={
          building
            ? "Planning, generating and reviewing against the approved plan."
            : "Here's the result. Hit a problem? Drop the error below and I'll debug it."
        }
      />

      <div className="rounded-2xl border border-white/[0.07] bg-card/60">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Terminal className="size-4 text-primary" />
          <span className="text-sm font-medium">Build output</span>
          {building && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              working…
            </span>
          )}
        </div>
        <div className="p-5">
          <Markdown content={buildLog || "Starting…"} />
        </div>
      </div>

      {done && (
        <>
          <DebugStage />
          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <span className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> Ready
            </span>
            <Button variant="secondary" onClick={reset}>
              <RotateCcw className="size-4" /> New build
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function DebugStage() {
  const debug = useCodeStore((s) => s.debug);
  const debugging = useCodeStore((s) => s.debugging);
  const runDebug = useCodeStore((s) => s.runDebug);

  return (
    <div className="mt-5 rounded-2xl border border-white/[0.07] bg-card/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Wrench className="size-4 text-primary" />
        <span className="text-sm font-medium">Debug</span>
        <span className="text-xs text-muted-foreground">— paste an error, get a fix</span>
      </div>

      <Composer
        placeholder="Paste an error message or stack trace…"
        onSubmit={(v) => void runDebug(v)}
        streaming={debugging}
      />

      {debugging && (
        <p className="mt-3 text-sm text-muted-foreground">Tracing the error…</p>
      )}

      {debug && !debugging && (
        <div className="mt-4 space-y-3">
          <DebugRow label="Issue" tone="text-foreground">
            {debug.issue}
          </DebugRow>
          <DebugRow label="Likely cause" tone="text-amber-300">
            {debug.cause}
          </DebugRow>
          <DebugRow label="Solution" tone="text-success">
            {debug.solution}
          </DebugRow>
          {debug.fix && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fixed code
              </p>
              <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[13px] leading-relaxed text-foreground/90">
                <code>{debug.fix}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DebugRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={cn("mb-0.5 text-xs font-semibold uppercase tracking-wide", tone)}>{label}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────────

function Heading({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Compass;
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

function Panel({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: typeof Compass;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-white/[0.07] bg-card/60 p-4", className)}>
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="size-4 text-primary" /> {title}
      </p>
      {children}
    </div>
  );
}

function Footer({ info }: { info: (typeof CODE_MODES)[number] }) {
  const stage = useCodeStore((s) => s.stage);
  const building = useCodeStore((s) => s.building);
  const startDiscover = useCodeStore((s) => s.startDiscover);
  const stopBuild = useCodeStore((s) => s.stopBuild);

  // The composer only drives the *entry* of a request. Once a flow is underway the
  // stage UI owns the controls, so the footer reflects that instead of a dead box.
  if (stage !== "idle") {
    return (
      <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between text-xs text-muted-foreground">
          <span>
            Mode: <span className="text-foreground">{info.name}</span> · Discover → Plan → Build →
            Debug
          </span>
          {building && (
            <button type="button" onClick={stopBuild} className="text-foreground hover:underline">
              Stop
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border/70 bg-background/60 px-3 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
      <div className="mx-auto w-full max-w-3xl">
        <Composer
          placeholder="Describe what you want to build…"
          onSubmit={(v) => startDiscover(v)}
          toolbar={
            <span className="text-xs text-muted-foreground">
              Mode: <span className="text-foreground">{info.name}</span> · I&apos;ll scope &amp;
              plan before writing code
            </span>
          }
        />
      </div>
    </div>
  );
}
