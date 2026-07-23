"use client";

// ── Diff Viewer (Phase 7) ─────────────────────────────────────────────────────
// Renders unified diffs with green/red/yellow highlighting.
// Supports: accept, reject, partial apply, undo, redo per hunk.

import { useMemo, useState } from "react";
import {
  Check, X, ChevronDown, ChevronRight,
  CheckCheck, XCircle, GitBranch, Plus, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { FileDiff, DiffHunk } from "@/lib/cocode/diff";
import { diffStats } from "@/lib/cocode/diff";
import { PanelHeader } from "@/components/cocode/panel-header";

export function DiffViewer() {
  const diff = useCocodeIDEStore((s) => s.diff);
  const acceptHunk = useCocodeIDEStore((s) => s.acceptHunk);
  const rejectHunk = useCocodeIDEStore((s) => s.rejectHunk);
  const acceptAllHunks = useCocodeIDEStore((s) => s.acceptAllHunks);
  const rejectAllHunks = useCocodeIDEStore((s) => s.rejectAllHunks);
  const acceptAllDiffs = useCocodeIDEStore((s) => s.acceptAllDiffs);
  const clearDiff = useCocodeIDEStore((s) => s.clearDiff);
  const applyDiff = useCocodeIDEStore((s) => s.applyDiff);
  const applying = useCocodeIDEStore((s) => s.applying);
  const canUndo = useCocodeIDEStore((s) => s.canUndo);
  const undo = useCocodeIDEStore((s) => s.undo);

  const [prompt] = useState("Manual review");

  if (!diff || !diff.files.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No diff to review. AI-generated changes will appear here.
      </div>
    );
  }

  const stats = diffStats(diff);
  const pending = diff.files.flatMap((f) => f.hunks).filter((h) => h.accepted === null).length;
  const accepted = diff.files.flatMap((f) => f.hunks).filter((h) => h.accepted === true).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PanelHeader icon={GitBranch} title="Review Changes" className="gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-success">+{stats.added}</span>
          <span className="text-destructive">-{stats.removed}</span>
          <span className="text-muted-foreground">{stats.files} file{stats.files !== 1 ? "s" : ""}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={clearDiff}>
            <X className="size-3.5" /> Discard
          </Button>
          {canUndo && (
            <Button size="sm" variant="outline" onClick={undo}>
              Undo
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={acceptAllDiffs}>
            <CheckCheck className="size-3.5" /> Accept All
          </Button>
          <Button
            size="sm"
            onClick={() => void applyDiff(prompt)}
            disabled={applying || accepted === 0}
          >
            {applying ? (
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" />
                Applying…
              </span>
            ) : (
              <>
                <Check className="size-3.5" />
                Apply {accepted > 0 ? `(${accepted})` : ""}
              </>
            )}
          </Button>
        </div>
      </PanelHeader>

      {/* Status bar */}
      {pending > 0 && (
        <div className="border-b border-warning/20 bg-warning/5 px-4 py-1.5 text-xs text-warning">
          {pending} hunk{pending !== 1 ? "s" : ""} pending review
        </div>
      )}

      {/* File diffs */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {diff.files.map((file) => (
          <FileDiffBlock
            key={file.id}
            file={file}
            onAcceptHunk={(hunkId) => acceptHunk(file.id, hunkId)}
            onRejectHunk={(hunkId) => rejectHunk(file.id, hunkId)}
            onAcceptAll={() => acceptAllHunks(file.id)}
            onRejectAll={() => rejectAllHunks(file.id)}
          />
        ))}
      </div>
    </div>
  );
}

function FileDiffBlock({
  file,
  onAcceptHunk,
  onRejectHunk,
  onAcceptAll,
  onRejectAll,
}: {
  file: FileDiff;
  onAcceptHunk: (id: string) => void;
  onRejectHunk: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const addedLines = file.hunks.flatMap((h) => h.lines).filter((l) => l.kind === "added").length;
  const removedLines = file.hunks.flatMap((h) => h.lines).filter((l) => l.kind === "removed").length;

  const label = file.isNew
    ? "new file"
    : file.isDeleted
    ? "deleted"
    : file.oldPath !== file.newPath
    ? `renamed from ${file.oldPath}`
    : "";

  return (
    <div className="border-b border-border/50">
      {/* File header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        className="flex cursor-pointer select-none items-center gap-2 bg-card/40 px-4 py-2 hover:bg-card/60"
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed((c) => !c); }
        }}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono text-xs text-foreground">{file.newPath || file.oldPath}</span>
        {label && (
          <span className="rounded bg-warning/20 px-1 py-0.5 text-micro text-warning">{label}</span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {addedLines > 0 && <span className="text-success">+{addedLines}</span>}
          {removedLines > 0 && <span className="text-destructive">-{removedLines}</span>}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onRejectAll}
            className="rounded p-1 text-muted-foreground hover:text-destructive"
            title="Reject all hunks in file"
          >
            <XCircle className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            className="rounded p-1 text-muted-foreground hover:text-success"
            title="Accept all hunks in file"
          >
            <CheckCheck className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Hunks */}
      {!collapsed && file.hunks.map((hunk) => (
        <HunkBlock
          key={hunk.id}
          hunk={hunk}
          onAccept={() => onAcceptHunk(hunk.id)}
          onReject={() => onRejectHunk(hunk.id)}
        />
      ))}
    </div>
  );
}

function HunkBlock({
  hunk,
  onAccept,
  onReject,
}: {
  hunk: DiffHunk;
  onAccept: () => void;
  onReject: () => void;
}) {
  const statusColor =
    hunk.accepted === true
      ? "border-l-2 border-success/60"
      : hunk.accepted === false
      ? "border-l-2 border-destructive/60 opacity-50"
      : "";

  return (
    <div className={cn("relative", statusColor)}>
      {/* Hunk header */}
      <div className="flex items-center justify-between bg-info/10 px-4 py-1">
        <span className="font-mono text-caption text-info">{hunk.header}</span>
        <div className="flex items-center gap-1">
          {hunk.accepted === null && (
            <>
              <button
                type="button"
                onClick={onReject}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-caption text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3" /> Reject
              </button>
              <button
                type="button"
                onClick={onAccept}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-caption text-muted-foreground hover:bg-success/10 hover:text-success"
              >
                <Check className="size-3" /> Accept
              </button>
            </>
          )}
          {hunk.accepted === true && (
            <span className="flex items-center gap-1 text-caption text-success">
              <Check className="size-3" /> Accepted
            </span>
          )}
          {hunk.accepted === false && (
            <span className="flex items-center gap-1 text-caption text-destructive">
              <X className="size-3" /> Rejected
            </span>
          )}
        </div>
      </div>

      {/* Lines */}
      <div className="font-mono text-label leading-[1.65]">
        {hunk.lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-0",
              line.kind === "added" && "bg-success/10",
              line.kind === "removed" && "bg-destructive/10",
            )}
          >
            {/* Line numbers */}
            <div className="w-8 shrink-0 select-none border-r border-border/30 px-1 text-right text-caption text-muted-foreground/40">
              {line.kind !== "added" && (line.oldLine ?? "")}
            </div>
            <div className="w-8 shrink-0 select-none border-r border-border/30 px-1 text-right text-caption text-muted-foreground/40">
              {line.kind !== "removed" && (line.newLine ?? "")}
            </div>
            {/* Gutter sign */}
            <div
              className={cn(
                "w-5 shrink-0 select-none text-center",
                line.kind === "added" && "text-success",
                line.kind === "removed" && "text-destructive",
                line.kind === "context" && "text-muted-foreground/30",
              )}
            >
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
            </div>
            {/* Content */}
            <pre
              className={cn(
                "min-w-0 flex-1 overflow-x-auto whitespace-pre px-2",
                line.kind === "added" && "text-success",
                line.kind === "removed" && "text-destructive",
                line.kind === "context" && "text-muted-foreground",
              )}
            >
              {line.content}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
