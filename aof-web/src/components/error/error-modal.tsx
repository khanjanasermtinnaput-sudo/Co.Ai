"use client";

// ── Error Modal ───────────────────────────────────────────────────────────────
// Full-detail error dialog: code, description, cause, suggested fix, plus a
// "Copy Diagnostics" button that puts the full error report on the clipboard.

import { useState } from "react";
import { AlertOctagon, Copy, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { findByCode } from "@/lib/errors/error-codes";
import { formatDiagnosticsReport, type ErrorLogEntry } from "@/lib/errors/logger";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ErrorModalProps {
  open: boolean;
  onClose: () => void;
  /** A full log entry (from the logger) — preferred, has all context. */
  entry?: ErrorLogEntry;
  /** Fallback: just a code + optional overrides. */
  code?: string;
  message?: string;
  stack?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ErrorModal({ open, onClose, entry, code, message, stack }: ErrorModalProps) {
  const [copied, setCopied] = useState(false);

  const errorCode = entry?.errorCode ?? code ?? "SYSTEM-500";
  const registered = findByCode(errorCode);
  const title = registered?.title ?? entry?.title ?? "Application Error";
  const desc = message ?? entry?.message ?? registered?.message ?? "An unexpected error occurred.";
  const solution = registered?.solution ?? "Refresh the page and try again.";
  const stackTrace = stack ?? entry?.stack;

  const report = entry
    ? formatDiagnosticsReport(entry)
    : [
        `Error Code:  ${errorCode}`,
        `Title:       ${title}`,
        `Message:     ${desc}`,
        `Route:       ${typeof window !== "undefined" ? window.location.pathname : "unknown"}`,
        `Timestamp:   ${new Date().toISOString()}`,
        `User Agent:  ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
        ...(stackTrace ? ["", "Stack Trace:", stackTrace] : []),
      ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => !v && onClose()}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-destructive/25 bg-destructive/10 px-5 py-4">
          <AlertOctagon className="size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-semibold tracking-tight text-destructive">
              {errorCode}
            </p>
            <DialogTitle className="mt-0.5 text-sm font-semibold text-foreground">
              {title}
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          <DialogDescription asChild>
            <div className="space-y-3">
              <Field label="Error Details" value={desc} />
              <Field label="Suggested Fix" value={solution} accent />
            </div>
          </DialogDescription>

          {/* Technical details */}
          {(entry?.route || stackTrace) && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
              <p className="mb-2 font-medium uppercase tracking-wide text-muted-foreground">
                Technical Details
              </p>
              <div className="space-y-1.5 font-mono text-muted-foreground">
                {entry?.route && <p>Route: {entry.route}</p>}
                {entry?.timestamp && (
                  <p>Time: {new Date(entry.timestamp).toISOString()}</p>
                )}
                {entry?.userId && <p>User: {entry.userId.slice(0, 8)}…</p>}
              </div>
              {stackTrace && (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card/60 p-2 text-[10px] leading-relaxed text-foreground/80">
                  {stackTrace}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            Share this report with support to get help faster.
          </p>
          <Button variant="secondary" size="sm" onClick={copy} className="gap-1.5">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy Diagnostics"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Field helper ──────────────────────────────────────────────────────────────

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-sm", accent ? "font-medium text-foreground" : "text-foreground/80")}>
        {value}
      </p>
    </div>
  );
}
