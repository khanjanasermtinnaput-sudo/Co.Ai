"use client";

import { motion } from "framer-motion";
import { ClipboardList, Sparkles, HelpCircle, Hammer } from "lucide-react";
import type { ProjectBrief } from "@/lib/types";
import { briefReadiness } from "@/lib/raa";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Live project brief, accumulated from the RAA conversation. Shows status and a
 *  Generate trigger that only enables once the brief is substantial enough. */
export function ProjectBriefPanel({
  brief,
  generating,
  onGenerate,
  className,
}: {
  brief: ProjectBrief | null;
  generating: boolean;
  onGenerate: () => void;
  className?: string;
}) {
  const ready = briefReadiness(brief);

  return (
    <aside
      className={cn(
        "flex h-full flex-col gap-4 overflow-y-auto border-l border-border/70 bg-card/30 p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardList className="size-4 text-primary" />
          Project Brief
        </span>
        <Badge variant={ready ? "success" : "muted"}>
          {generating ? "Generating" : ready ? "Ready" : "Planning"}
        </Badge>
      </div>

      {!brief ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
          <Sparkles className="size-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">
            Tell Coagentix what you want to build. The brief fills in as you talk —
            then generate when it&apos;s ready.
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4"
        >
          {brief.project && (
            <Field label="Project">
              <p className="text-sm font-medium text-foreground">{brief.project}</p>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            {brief.appType && <Meta label="Type" value={brief.appType} />}
            {brief.complexity && <Meta label="Complexity" value={brief.complexity} />}
            {brief.techStack && <Meta label="Stack" value={brief.techStack} span />}
            {brief.architecture && <Meta label="Architecture" value={brief.architecture} span />}
          </div>

          {brief.features.length > 0 && (
            <Field label="Features">
              <BulletList items={brief.features} />
            </Field>
          )}
          {brief.scope.length > 0 && (
            <Field label="Scope">
              <BulletList items={brief.scope} muted />
            </Field>
          )}
          {brief.expectedBehavior.length > 0 && (
            <Field label="Expected behavior">
              <BulletList items={brief.expectedBehavior} muted />
            </Field>
          )}
          {brief.files.length > 0 && (
            <Field label="Files to create">
              <BulletList items={brief.files} mono muted />
            </Field>
          )}

          {brief.openQuestions.length > 0 && (
            <Field label="Open questions">
              <ul className="flex flex-col gap-1.5">
                {brief.openQuestions.map((q) => (
                  <li key={q} className="flex items-start gap-1.5 text-xs text-amber-400/90">
                    <HelpCircle className="mt-0.5 size-3 shrink-0" />
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </motion.div>
      )}

      <div className="mt-auto pt-2">
        <Button
          onClick={onGenerate}
          disabled={!ready || generating}
          className="w-full"
          title={ready ? "Generate code from this brief" : "Keep chatting until the brief is ready"}
        >
          <Hammer className="size-4" />
          {generating ? "Generating…" : "Generate Code"}
        </Button>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          or type <code className="rounded bg-secondary px-1 py-0.5">/gencode</code> in the chat
        </p>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Meta({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-background/40 px-2.5 py-2", span && "col-span-2")}>
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

function BulletList({
  items,
  muted,
  mono,
}: {
  items: string[];
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it) => (
        <li
          key={it}
          className={cn(
            "flex items-start gap-1.5 text-xs",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          <span className="mt-1 size-1 shrink-0 rounded-full bg-primary/70" />
          <span className={cn(mono && "font-mono text-[11px]")}>{it}</span>
        </li>
      ))}
    </ul>
  );
}
