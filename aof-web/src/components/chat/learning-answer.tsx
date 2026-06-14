"use client";

import * as React from "react";
import { CheckCircle2, ListOrdered, Lightbulb, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LearningAnswer } from "@/lib/types";
import { Markdown } from "./markdown";

type View = "answer" | "steps" | "concept";

const TABS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "answer", label: "Answer", icon: CheckCircle2 },
  { id: "steps", label: "Steps", icon: ListOrdered },
  { id: "concept", label: "Concept", icon: Lightbulb },
];

/** Math & Learning mode renderer — switch Answer / Steps / Concept instantly,
 *  no need to re-send the question. */
export function LearningAnswerView({ data }: { data: LearningAnswer }) {
  const [view, setView] = React.useState<View>("answer");

  return (
    <div className="space-y-3">
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-secondary/50 p-0.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === view;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-glow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {view === "answer" && <Markdown content={data.answer} />}
      {view === "steps" && (
        <Markdown content={data.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")} />
      )}
      {view === "concept" && <Markdown content={data.concept} />}
    </div>
  );
}
