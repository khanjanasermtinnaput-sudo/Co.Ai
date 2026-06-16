"use client";

import { useMemo, useState } from "react";
import { AlertOctagon, ExternalLink, Eye, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildProjectHtml, extractGeneratedFiles } from "@/lib/export";
import { canBuildHtml } from "@/lib/project-detect";
import { ExportError } from "@/lib/export-types";

/** Live in-browser preview of the latest generated project. Builds a single
 *  self-contained HTML document from the generated files and renders it in a
 *  sandboxed iframe so the user can test the result without leaving the app. */
export function CodePreview({ buildLog, className }: { buildLog: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  const files = useMemo(() => extractGeneratedFiles(buildLog), [buildLog]);
  const renderable = canBuildHtml(files);

  const { html, error } = useMemo(() => {
    if (!open) return { html: "", error: null as string | null };
    try {
      return { html: buildProjectHtml(files), error: null };
    } catch (e) {
      const reason =
        e instanceof ExportError
          ? "This project type can't be previewed in the browser (no HTML/CSS/JS)."
          : "Could not build a preview from the generated code.";
      return { html: "", error: reason };
    }
    // nonce forces a rebuild when the user hits Reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, files, nonce]);

  const openInTab = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className={className}
        onClick={() => setOpen(true)}
        disabled={!renderable}
        title={renderable ? "Preview in browser" : "No previewable HTML/CSS/JS in this project"}
      >
        <Eye className="size-3.5" /> Preview
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-3 p-4">
          <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
            <DialogTitle>Live Preview</DialogTitle>
            {!error && (
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
                  <RotateCcw className="size-3.5" /> Reload
                </Button>
                <Button size="sm" variant="ghost" onClick={openInTab}>
                  <ExternalLink className="size-3.5" /> Open in tab
                </Button>
              </div>
            )}
          </DialogHeader>

          {error ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/[0.06] px-4 py-3 text-sm">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="text-destructive/90">{error}</span>
            </div>
          ) : (
            <iframe
              key={nonce}
              title="Project preview"
              srcDoc={html}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="min-h-0 flex-1 w-full rounded-xl border border-border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
