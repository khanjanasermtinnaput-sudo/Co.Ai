"use client";

import {
  GitBranch, AlertCircle, CheckCircle2, Cpu, Code2, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { SimpleTooltip } from "./ide-tooltip";

interface IDEStatusBarProps {
  developerMode: boolean;
  onToggleDeveloperMode: () => void;
  language?: string;
  errors?: number;
  warnings?: number;
  cursorLine?: number;
  cursorCol?: number;
}

function StatusItem({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center gap-1 border-r border-border/30 px-2.5 text-[11px] text-muted-foreground",
        onClick && "cursor-pointer hover:bg-white/5 hover:text-foreground transition-colors",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function IDEStatusBar({
  developerMode,
  onToggleDeveloperMode,
  language,
  errors = 0,
  warnings = 0,
  cursorLine,
  cursorCol,
}: IDEStatusBarProps) {
  const github   = useCocodeIDEStore((s) => s.github);
  const workflow = useCocodeIDEStore((s) => s.workflow);
  const applying = useCocodeIDEStore((s) => s.applying);

  const aiLabel = applying
    ? "Applying…"
    : workflow
    ? workflow.mode
    : "Ready";

  const aiActive = applying || !!workflow;

  return (
    <div className="flex h-[22px] shrink-0 items-center overflow-hidden border-t border-border/40 bg-card/70 select-none">
      {/* Git branch */}
      <SimpleTooltip label="Git branch" description={github.repo?.fullName} side="top" delay={300}>
        <StatusItem>
          <GitBranch className="size-3 shrink-0" />
          <span className="max-w-[120px] truncate">
            {github.repo?.branch ?? "no repo"}
          </span>
        </StatusItem>
      </SimpleTooltip>

      {/* Errors / Warnings */}
      <SimpleTooltip
        label={`${errors} error${errors !== 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""}`}
        side="top"
        delay={300}
      >
        <StatusItem className={errors > 0 ? "text-red-400" : warnings > 0 ? "text-amber-400" : "text-emerald-500/70"}>
          {errors === 0 && warnings === 0 ? (
            <CheckCircle2 className="size-3 shrink-0" />
          ) : (
            <>
              {errors > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertCircle className="size-3 shrink-0" />
                  {errors}
                </span>
              )}
              {warnings > 0 && (
                <span className="flex items-center gap-1 text-amber-400 ml-1">
                  <AlertCircle className="size-3 shrink-0" />
                  {warnings}
                </span>
              )}
            </>
          )}
        </StatusItem>
      </SimpleTooltip>

      {/* AI status */}
      <SimpleTooltip
        label={`CoCode AI — ${aiLabel}`}
        description="AI engine status"
        side="top"
        delay={300}
      >
        <StatusItem className={cn(aiActive && "text-primary")}>
          <Cpu className={cn("size-3 shrink-0", aiActive && "animate-pulse")} />
          <span>{aiLabel}</span>
        </StatusItem>
      </SimpleTooltip>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Cursor position */}
      {cursorLine !== undefined && (
        <SimpleTooltip label="Cursor position" side="top" delay={300}>
          <StatusItem className="border-l border-r-0">
            Ln {cursorLine}, Col {cursorCol ?? 1}
          </StatusItem>
        </SimpleTooltip>
      )}

      {/* Language */}
      {language && (
        <SimpleTooltip label="File language" side="top" delay={300}>
          <StatusItem className="border-l border-r-0">
            <Code2 className="size-3 shrink-0" />
            <span className="capitalize">{language}</span>
          </StatusItem>
        </SimpleTooltip>
      )}

      {/* Encoding */}
      <SimpleTooltip label="File encoding" side="top" delay={300}>
        <StatusItem className="border-l border-r-0">UTF-8</StatusItem>
      </SimpleTooltip>

      {/* Line endings */}
      <SimpleTooltip label="Line endings" side="top" delay={300}>
        <StatusItem className="border-l border-r-0">LF</StatusItem>
      </SimpleTooltip>

      {/* Developer Mode toggle */}
      <SimpleTooltip
        label={developerMode ? "Developer Mode — ON" : "Developer Mode — OFF"}
        description={developerMode ? "Advanced AI tools are visible. Click to hide." : "Click to reveal advanced AI engineering tools."}
        shortcut="Ctrl+Shift+`"
        side="top"
        delay={300}
      >
        <button
          type="button"
          onClick={onToggleDeveloperMode}
          className={cn(
            "flex h-full items-center gap-1 border-l border-border/30 px-2.5 text-[11px] transition-colors",
            developerMode
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <RefreshCw className="size-3 shrink-0" />
          {developerMode ? "Dev Mode" : "Dev"}
        </button>
      </SimpleTooltip>
    </div>
  );
}
