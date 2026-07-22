"use client";

// Part 8 — Professional Status Bar
// Only displays useful information. Everything optional except the essentials.

import { GitBranch, AlertCircle, CheckCircle, Loader2, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { useUIStore } from "@/store/ui-store";
import { SimpleTooltip } from "./ide-tooltip";

interface StatusBarProps {
  className?: string;
  tsErrorCount?: number;
  buildStatus?: "idle" | "building" | "success" | "error";
  aiStatus?: "idle" | "streaming" | "thinking";
  language?: string;
  encoding?: string;
}

export function WorkspaceStatusBar({
  className,
  tsErrorCount = 0,
  buildStatus = "idle",
  aiStatus = "idle",
  language,
  encoding = "UTF-8",
}: StatusBarProps) {
  const github = useCocodeIDEStore((s) => s.github);
  const activeTab = useCocodeIDEStore((s) => s.activeTab);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);
  const cursorPosition = useUIStore((s) => s.cursorPosition);

  // Derive language from active file extension
  const detectedLanguage = language ?? (activeTab ? detectLanguage(activeTab) : "Plain Text");

  const BUILD_ICON = {
    idle: null,
    building: <Loader2 className="size-3 animate-spin text-primary" />,
    success: <CheckCircle className="size-3 text-success" />,
    error: <AlertCircle className="size-3 text-destructive" />,
  }[buildStatus];

  const BUILD_LABEL = {
    idle: null,
    building: "Building…",
    success: "Build passed",
    error: "Build failed",
  }[buildStatus];

  const AI_LABEL = {
    idle: "AI ready",
    streaming: "AI writing…",
    thinking: "AI thinking…",
  }[aiStatus];

  return (
    <div
      className={cn(
        "flex h-6 items-center gap-0 border-t border-border/50 bg-sidebar/80 px-1 text-[11px] text-muted-foreground/70 backdrop-blur-sm select-none",
        className,
      )}
    >
      {/* Git branch */}
      {github.connected && github.repo && (
        <SimpleTooltip
          label="Git Branch"
          description={`Current branch: ${github.repo.branch}. Click to open GitHub panel.`}
          shortcut="Ctrl+Shift+G"
          side="top"
        >
          <button
            type="button"
            onClick={() => setRightPanel("github")}
            className="flex h-full items-center gap-1 px-2 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <GitBranch className="size-3" />
            <span className="max-w-[120px] truncate">{github.repo.branch}</span>
          </button>
        </SimpleTooltip>
      )}

      <div className="h-3.5 w-px bg-border/40" />

      {/* TypeScript errors */}
      <SimpleTooltip
        label="Diagnostics"
        description={tsErrorCount === 0 ? "No TypeScript errors" : `${tsErrorCount} TypeScript error${tsErrorCount !== 1 ? "s" : ""}`}
        shortcut="Ctrl+Shift+M"
        side="top"
      >
        <button
          type="button"
          onClick={() => setRightPanel("diagnostics")}
          className={cn(
            "flex h-full items-center gap-1 px-2 transition-colors hover:bg-foreground/5",
            tsErrorCount > 0 ? "text-destructive hover:text-destructive/80" : "hover:text-foreground",
          )}
        >
          <AlertCircle className="size-3" />
          <span>{tsErrorCount} error{tsErrorCount !== 1 ? "s" : ""}</span>
        </button>
      </SimpleTooltip>

      <div className="h-3.5 w-px bg-border/40" />

      {/* Build status */}
      {buildStatus !== "idle" && BUILD_ICON && BUILD_LABEL && (
        <>
          <SimpleTooltip label="Build Status" description={BUILD_LABEL} side="top">
            <div className="flex h-full items-center gap-1 px-2">
              {BUILD_ICON}
              <span>{BUILD_LABEL}</span>
            </div>
          </SimpleTooltip>
          <div className="h-3.5 w-px bg-border/40" />
        </>
      )}

      {/* AI Status */}
      <SimpleTooltip
        label="AI Status"
        description={AI_LABEL}
        side="top"
      >
        <div className="flex h-full items-center gap-1 px-2">
          <Radio className={cn("size-3", aiStatus !== "idle" ? "text-primary animate-pulse" : "text-muted-foreground/40")} />
          <span className={aiStatus !== "idle" ? "text-primary" : ""}>{AI_LABEL}</span>
        </div>
      </SimpleTooltip>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Cursor position — secondary detail, hidden below `sm` so the bar
         doesn't compete with the titlebar's own overflow on a phone. Developer
         Mode's toggle lives only in the titlebar now (was duplicated here). */}
      <SimpleTooltip label="Cursor Position" description="Line and column in the active file" side="top">
        <div className="hidden h-full items-center px-2 transition-colors hover:bg-foreground/5 sm:flex">
          Ln {cursorPosition.line}, Col {cursorPosition.col}
        </div>
      </SimpleTooltip>

      <div className="hidden h-3.5 w-px bg-border/40 sm:block" />

      {/* Language */}
      <SimpleTooltip label="Language Mode" description={`File language: ${detectedLanguage}`} side="top">
        <div className="hidden h-full items-center px-2 transition-colors hover:bg-foreground/5 md:flex">
          {detectedLanguage}
        </div>
      </SimpleTooltip>

      <div className="hidden h-3.5 w-px bg-border/40 md:block" />

      {/* Encoding */}
      <div className="hidden h-full items-center px-2 md:flex">{encoding}</div>
    </div>
  );
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const MAP: Record<string, string> = {
    tsx: "TypeScript JSX", ts: "TypeScript", jsx: "JavaScript JSX",
    js: "JavaScript", css: "CSS", scss: "SCSS", json: "JSON",
    md: "Markdown", mdx: "MDX", html: "HTML", py: "Python",
    sql: "SQL", yaml: "YAML", yml: "YAML", toml: "TOML",
    sh: "Shell", bash: "Bash", dockerfile: "Dockerfile",
  };
  return MAP[ext ?? ""] ?? "Plain Text";
}
