"use client";

// ── Smart Refactoring Menu (Phase 19) ────────────────────────────────────────
// Presents available refactoring operations for the active file.
// Non-AI ops (rename, move) execute client-side.
// AI ops stream a diff back and open it in the Diff Viewer.

import { useState } from "react";
import { Wrench, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { REFACTOR_OPERATIONS, type RefactorKind } from "@/lib/cocode/adaptive-workflow";

export function RefactorMenu({ className }: { className?: string }) {
  const activeFile = useCocodeIDEStore((s) => s.activeFile());
  const runRefactor = useCocodeIDEStore((s) => s.runRefactor);
  const renameFilePath = useCocodeIDEStore((s) => s.renameFilePath);
  const refactoring = useCocodeIDEStore((s) => s.refactoring);

  const [lastDone, setLastDone] = useState<RefactorKind | null>(null);

  // Symbol rename
  const [renamingSymbol, setRenamingSymbol] = useState(false);
  const [oldSymbol, setOldSymbol] = useState("");
  const [newSymbol, setNewSymbol] = useState("");

  // Move file
  const [movingFile, setMovingFile] = useState(false);
  const [newPath, setNewPath] = useState("");

  async function handleRefactor(kind: RefactorKind) {
    if (kind === "rename-symbol") {
      setRenamingSymbol(true);
      return;
    }
    if (kind === "move-file") {
      setMovingFile(true);
      setNewPath(activeFile?.path ?? "");
      return;
    }
    await runRefactor(kind, {});
    setLastDone(kind);
    setTimeout(() => setLastDone(null), 2000);
  }

  async function handleRenameSymbol() {
    if (!oldSymbol.trim() || !newSymbol.trim()) return;
    await runRefactor("rename-symbol", { symbol: { name: oldSymbol, newName: newSymbol } });
    setRenamingSymbol(false);
    setOldSymbol("");
    setNewSymbol("");
    setLastDone("rename-symbol");
    setTimeout(() => setLastDone(null), 2000);
  }

  function handleMoveFile() {
    if (!activeFile || !newPath.trim()) return;
    renameFilePath(activeFile.path, newPath.trim());
    setMovingFile(false);
    setNewPath("");
  }

  if (!activeFile) {
    return (
      <div className={cn("flex flex-col gap-2 p-4 text-center text-[12px] text-muted-foreground/60", className)}>
        <Wrench className="mx-auto size-6 opacity-30" />
        Open a file to see refactoring options.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1 p-3", className)}>
      <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
        Refactor · {activeFile.name}
      </p>

      {/* Symbol rename form */}
      {renamingSymbol && (
        <div className="mb-2 rounded-xl border border-border bg-card/40 p-3">
          <p className="mb-2 text-[12px] font-medium">Rename Symbol</p>
          <input
            autoFocus
            type="text"
            value={oldSymbol}
            onChange={(e) => setOldSymbol(e.target.value)}
            placeholder="Current name"
            className="mb-1.5 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-[12px] outline-none focus:border-primary/50"
          />
          <input
            type="text"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            placeholder="New name"
            onKeyDown={(e) => e.key === "Enter" && void handleRenameSymbol()}
            className="mb-2 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-[12px] outline-none focus:border-primary/50"
          />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => void handleRenameSymbol()}>
              Rename
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRenamingSymbol(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Move file form */}
      {movingFile && (
        <div className="mb-2 rounded-xl border border-border bg-card/40 p-3">
          <p className="mb-2 text-[12px] font-medium">Move File</p>
          <input
            autoFocus
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleMoveFile()}
            className="mb-2 w-full rounded-md border border-border bg-background/50 px-2 py-1.5 font-mono text-[12px] outline-none focus:border-primary/50"
          />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handleMoveFile}>Move</Button>
            <Button size="sm" variant="ghost" onClick={() => setMovingFile(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Operations list */}
      {!renamingSymbol && !movingFile && REFACTOR_OPERATIONS.map((op) => {
        const busy = refactoring;
        const done = lastDone === op.kind;
        return (
          <button
            key={op.kind}
            type="button"
            disabled={busy}
            onClick={() => void handleRefactor(op.kind)}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
              "hover:bg-white/[0.05] disabled:opacity-50",
              done && "bg-emerald-500/10",
            )}
          >
            <div className="mt-0.5 shrink-0">
              {busy && lastDone === null ? (
                <Loader2 className="size-3.5 animate-spin text-primary" />
              ) : done ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <Wrench className="size-3.5 text-muted-foreground/60" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-tight text-foreground/90">
                {op.label}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                {op.description}
                {op.requiresAI && (
                  <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 text-[10px] text-primary/80">AI</span>
                )}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
