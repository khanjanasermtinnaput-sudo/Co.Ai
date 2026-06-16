"use client";

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
import { exportProject, extractGeneratedFiles } from "@/lib/export";
import { hasHtmlEntry } from "@/lib/project-detect";
import { EXPORT_ERROR_MESSAGE, EXPORT_STAGE_LABEL, ExportError, type ExportStage } from "@/lib/export-types";
import type { ProjectBrief } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGE_PROGRESS: Record<ExportStage, number> = {
  preparing: 20,
  building: 55,
  compressing: 85,
  done: 100,
};

export function ExportMenu({
  buildLog,
  brief,
  className,
}: {
  buildLog: string;
  brief?: ProjectBrief | null;
  className?: string;
}) {
  const [stage, setStage] = useState<ExportStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canExportHtml = hasHtmlEntry(extractGeneratedFiles(buildLog));

  const run = async (format: "html" | "zip") => {
    setError(null);
    setStage("preparing");
    try {
      await exportProject(buildLog, format, brief, (s) => setStage(s));
      setTimeout(() => setStage(null), 700);
    } catch (e) {
      const reason = e instanceof ExportError ? e.reason : "INVALID_CODE";
      setError(EXPORT_ERROR_MESSAGE[reason]);
      setStage(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" className={className}>
            <Download className="size-3.5" /> Export <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled={!canExportHtml} onClick={() => void run("html")}>
            <FileCode2 /> Export as HTML
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
            <DialogTitle>{error ? "Export Failed" : "Exporting Project"}</DialogTitle>
          </DialogHeader>

          {error ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/[0.06] px-4 py-3 text-sm">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="text-destructive/90">
                Reason: <span className="font-medium text-destructive">{error}</span>
              </span>
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
