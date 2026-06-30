"use client";

// ── Checkpoint & Recovery Panel (Phase 20) ────────────────────────────────────
// Lists all checkpoints, shows status, supports restore/undo/redo/branch.

import { useState } from "react";
import {
  History, RotateCcw, RotateCw, CheckCircle2, XCircle,
  AlertCircle, Clock, GitBranch, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { Checkpoint } from "@/lib/cocode/checkpoint";

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

function StatusIcon({ checkpoint }: { checkpoint: Checkpoint }) {
  if (checkpoint.status === "success" || (checkpoint.buildOk !== false && checkpoint.testOk !== false)) {
    return <CheckCircle2 className="size-3.5 text-emerald-400" />;
  }
  if (checkpoint.status === "build-failed" || checkpoint.buildOk === false) {
    return <XCircle className="size-3.5 text-red-400" />;
  }
  if (checkpoint.status === "test-failed" || checkpoint.testOk === false) {
    return <AlertCircle className="size-3.5 text-amber-400" />;
  }
  return <Clock className="size-3.5 text-muted-foreground/60" />;
}

export function CheckpointPanel() {
  const checkpoints = useCocodeIDEStore((s) => s.allCheckpoints());
  const currentCheckpoint = useCocodeIDEStore((s) => s.currentCheckpoint);
  const canUndo = useCocodeIDEStore((s) => s.canUndo);
  const canRedo = useCocodeIDEStore((s) => s.canRedo);
  const undo = useCocodeIDEStore((s) => s.undo);
  const redo = useCocodeIDEStore((s) => s.redo);
  const restoreFromCheckpoint = useCocodeIDEStore((s) => s.restoreFromCheckpoint);
  const createGitBranch = useCocodeIDEStore((s) => s.createGitBranch);

  const [branchInput, setBranchInput] = useState("");
  const [branchTarget, setBranchTarget] = useState<string | null>(null);

  if (!checkpoints.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <History className="size-10 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium">No checkpoints yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            Every time you apply a diff, a checkpoint is saved here. You can undo, redo, or restore any point.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <History className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Checkpoints</span>
        <span className="ml-auto text-[11px] text-muted-foreground/60">{checkpoints.length} total</span>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <RotateCcw className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            <RotateCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {[...checkpoints].reverse().map((checkpoint) => {
          const isCurrent = currentCheckpoint?.id === checkpoint.id;
          return (
            <div
              key={checkpoint.id}
              className={cn(
                "border-b border-border/40 p-3",
                isCurrent && "bg-primary/5 border-l-2 border-l-primary",
              )}
            >
              <div className="flex items-start gap-2">
                <StatusIcon checkpoint={checkpoint} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium leading-tight">
                    {checkpoint.label}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/60">
                    <span>#{checkpoint.index}</span>
                    <span>·</span>
                    <span>{timeAgo(checkpoint.timestamp)}</span>
                    {checkpoint.modifiedPaths.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{checkpoint.modifiedPaths.length} file{checkpoint.modifiedPaths.length !== 1 ? "s" : ""}</span>
                      </>
                    )}
                  </div>

                  {/* Modified files */}
                  {checkpoint.modifiedPaths.length > 0 && (
                    <div className="mt-1.5 max-h-16 overflow-hidden">
                      {checkpoint.modifiedPaths.slice(0, 3).map((p) => (
                        <div key={p} className="truncate font-mono text-[10px] text-muted-foreground/50">
                          {p}
                        </div>
                      ))}
                      {checkpoint.modifiedPaths.length > 3 && (
                        <div className="text-[10px] text-muted-foreground/40">
                          +{checkpoint.modifiedPaths.length - 3} more
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 flex-col gap-1">
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => restoreFromCheckpoint(checkpoint.id)}
                      className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    >
                      Restore
                    </button>
                  )}
                  {isCurrent && (
                    <span className="rounded px-2 py-0.5 text-[11px] text-primary">Current</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setBranchTarget(checkpoint.id)}
                    className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  >
                    Branch
                  </button>
                </div>
              </div>

              {/* Create branch from checkpoint */}
              {branchTarget === checkpoint.id && (
                <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    type="text"
                    value={branchInput}
                    onChange={(e) => setBranchInput(e.target.value)}
                    placeholder="branch-name"
                    className="flex-1 rounded-md border border-border bg-background/50 px-2 py-1 text-[12px] outline-none focus:border-primary/50"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!branchInput.trim()) return;
                      restoreFromCheckpoint(checkpoint.id);
                      await createGitBranch(branchInput.trim()).catch(() => {});
                      setBranchTarget(null);
                      setBranchInput("");
                    }}
                  >
                    <GitBranch className="size-3.5" />
                    Create
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setBranchTarget(null); setBranchInput(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
