"use client";

// ── AI Provider Error Panel ──────────────────────────────────────────────────
// Shown INSTEAD of an assistant reply whenever a provider fails. Transparency-
// first: it states exactly what failed, why, which provider, and how to fix it.
// Developer Mode reveals the raw status / response / stack for debugging.

import { motion } from "framer-motion";
import { AlertTriangle, Bug, Copy, Check, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import type { AofProviderError } from "@/lib/provider-errors";
import { Button } from "@/components/ui/button";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground/90">{children}</span>
    </div>
  );
}

export function ProviderErrorPanel({
  error,
  devMode,
  onToggleDev,
  onDismiss,
  onRetry,
}: {
  error: AofProviderError;
  devMode: boolean;
  onToggleDev: (v: boolean) => void;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = async () => {
    const lines = [
      error.code,
      `Provider: ${error.provider}`,
      `Problem: ${error.problem}`,
      `Details: ${error.details}`,
      `Solution: ${error.solution}`,
      `Timestamp: ${error.timestamp}`,
      error.httpStatus ? `HTTP Status: ${error.httpStatus}` : "",
      error.model ? `Model: ${error.model}` : "",
      error.requestId ? `Request ID: ${error.requestId}` : "",
      error.providerResponse ? `Response: ${error.providerResponse}` : "",
      error.rawError ? `Raw: ${error.rawError}` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const ts = new Date(error.timestamp);
  const tsLabel = Number.isNaN(ts.getTime()) ? error.timestamp : `${ts.toUTCString()}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6"
      role="alert"
      aria-live="assertive"
    >
      <div className="overflow-hidden rounded-2xl border border-red-500/30 bg-red-500/[0.06]">
        {/* header */}
        <div className="flex items-center gap-2.5 border-b border-red-500/20 bg-red-500/[0.07] px-4 py-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
            <AlertTriangle className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-200">AI unavailable — generation stopped</p>
            <p className="font-mono text-[11px] text-red-300/70">{error.code}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* body */}
        <div className="space-y-2.5 px-4 py-3.5">
          <Row label="Provider">{error.provider}</Row>
          <Row label="Problem">{error.problem}</Row>
          <Row label="Details">{error.details}</Row>
          <Row label="Solution">
            <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
              {error.solution}
            </span>
          </Row>
          <Row label="Time">
            <span className="font-mono text-xs text-muted-foreground">{tsLabel}</span>
          </Row>
        </div>

        {/* developer mode */}
        {devMode && (
          <div className="border-t border-red-500/15 bg-black/20 px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              <Bug className="size-3" /> Developer details
            </p>
            <div className="space-y-1.5 font-mono text-[11px] text-muted-foreground">
              {error.httpStatus !== undefined && <div>HTTP status: {error.httpStatus}</div>}
              {error.model && <div>Model: {error.model}</div>}
              {error.requestId && <div>Request ID: {error.requestId}</div>}
              {error.providerResponse && (
                <div className="whitespace-pre-wrap break-words">
                  Response: {error.providerResponse}
                </div>
              )}
              {error.rawError && (
                <div className="whitespace-pre-wrap break-words">Raw: {error.rawError}</div>
              )}
              {error.stack && (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2">
                  {error.stack}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-red-500/15 px-4 py-2.5">
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <RefreshCw className="size-3.5" /> Retry
            </Button>
          )}
          <button
            type="button"
            onClick={copyDiagnostics}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy diagnostics"}
          </button>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={devMode}
              onChange={(e) => onToggleDev(e.target.checked)}
              className="size-3.5 accent-amber-500"
            />
            Developer mode
          </label>
        </div>
      </div>
    </motion.div>
  );
}
