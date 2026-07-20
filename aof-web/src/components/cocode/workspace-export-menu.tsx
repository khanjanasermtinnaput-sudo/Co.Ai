"use client";

// ── Workspace Export Menu ─────────────────────────────────────────────────────
// Exports the LIVE IDE workspace (the virtual FS, including Monaco edits) as a
// standalone index.html or a ZIP — unlike components/code/export-menu.tsx,
// which exports from the AI build log of the conversational Build view.

import { useState } from "react";
import { AlertOctagon, ChevronDown, Download, FileCode2, FolderArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { exportWorkspace } from "@/lib/export";
import {
  EXPORT_ERROR_MESSAGE,
  EXPORT_STAGE_LABEL,
  ExportError,
  type ExportStage,
} from "@/lib/export-types";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { cn } from "@/lib/utils";

const STAGE_PROGRESS: Record<ExportStage, number> = {
  preparing: 20,
  building: 55,
  compressing: 85,
  done: 100,
};

export function WorkspaceExportMenu({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const projectName = useCocodeIDEStore((s) => s.projectName);
  const [stage, setStage] = useState<ExportStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasFiles = fs.children.length > 0;

  const run = async (format: "html" | "zip") => {
    setError(null);
    setStage("preparing");
    try {
      const files = flattenFiles(fs).map((f) => ({ path: f.path, content: f.content }));
      await exportWorkspace(files, format, projectName, (s) => setStage(s));
      setTimeout(() => setStage(null), 900);
    } catch (e) {
      setError(
        e instanceof ExportError
          ? EXPORT_ERROR_MESSAGE[e.reason]
          : e instanceof Error ? e.message : String(e),
      );
      setStage(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            disabled={!hasFiles}
            title={hasFiles ? "Export project" : "Nothing to export yet"}
            className={cn("h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground", className)}
          >
            <Download className="size-3.5" /> Export <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void run("html")}>
            <FileCode2 /> Export as index.html
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run("zip")}>
            <FolderArchive /> Export as ZIP
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={stage !== null || error !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStage(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{error ? "Export Failed" : "Exporting Workspace"}</DialogTitle>
          </DialogHeader>

          {error ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/[0.06] px-4 py-3 text-sm">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="text-destructive/90">{error}</span>
            </div>
          ) : stage ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{EXPORT_STAGE_LABEL[stage]}</p>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full bg-primary transition-all duration-300",
                    stage === "done" && "bg-emerald-500",
                  )}
                  style={{ width: `${STAGE_PROGRESS[stage]}%` }}
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
