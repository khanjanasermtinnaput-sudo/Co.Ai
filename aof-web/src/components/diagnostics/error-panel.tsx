"use client";

// ── AOF Error Panel ───────────────────────────────────────────────────────────
// Renders a structured provider failure in the canonical AOF_ERROR format. It is
// deliberately styled to look NOTHING like an assistant reply — the user must
// instantly understand that AI did not run. Developer Mode reveals the raw
// diagnostics (HTTP status, provider response, stack, request metadata).

import { useState } from "react";
import { AlertOctagon, Copy, Check, Terminal, ChevronDown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatErrorBlock, formatUtc, type AofProviderError } from "@/lib/errors";
import { useUIStore } from "@/store/ui-store";

export function ErrorPanel({ error, className }: { error: AofProviderError; className?: string }) {
  const developerMode = useUIStore((s) => s.developerMode);
  const [copied, setCopied] = useState(false);
  const [showDev, setShowDev] = useState(false);
  // Progressive disclosure: what happened + what to do is always visible;
  // the canonical AOF_ERROR field block is one click away.
  const [showDetails, setShowDetails] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatErrorBlock(error));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        "overflow-hidden rounded-2xl border border-destructive/40 bg-destructive/[0.06]",
        className,
      )}
    >
      {/* header — plain-language summary, no error-code jargon */}
      <div className="flex items-center gap-2.5 border-b border-destructive/25 bg-destructive/10 px-4 py-2.5">
        <AlertOctagon className="size-4 shrink-0 text-destructive" />
        <span className="truncate text-sm font-medium text-destructive">
          Co.AI couldn&apos;t finish this reply
        </span>
        <button
          type="button"
          onClick={copy}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-destructive/80 transition-colors hover:text-destructive"
          aria-label="Copy error details"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* always visible: what happened + what to do about it */}
      <div className="space-y-2 px-4 py-3.5 text-sm">
        <p className="text-foreground">{error.problem}</p>
        <p className="flex items-start gap-1.5 text-foreground">
          <Wrench className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span className="font-medium">{error.solution}</span>
        </p>
      </div>

      {/* one click away: the canonical AOF_ERROR field block */}
      <div className="border-t border-destructive/15">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Details
          <span className="font-mono text-micro text-muted-foreground/60">{error.code}</span>
          <ChevronDown className={cn("ml-auto size-3.5 transition-transform", showDetails && "rotate-180")} />
        </button>
        {showDetails && (
          <div className="space-y-2.5 px-4 pb-3.5 text-sm">
            <Field label="Provider" value={`${error.provider}${error.model ? ` · ${error.model}` : ""}`} />
            <Field label="Details" value={error.details} />
            <Field label="Timestamp" value={formatUtc(error.timestamp)} mono />
          </div>
        )}
      </div>

      {/* developer mode — raw diagnostics */}
      {developerMode ? (
        <div className="border-t border-destructive/20">
          <button
            type="button"
            onClick={() => setShowDev((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Terminal className="size-3.5" />
            Developer details
            <ChevronDown className={cn("ml-auto size-3.5 transition-transform", showDev && "rotate-180")} />
          </button>
          {showDev && (
            <div className="space-y-3 bg-background/40 px-4 pb-4 pt-1 font-mono text-[11px] leading-relaxed">
              <DevRow label="HTTP Status" value={error.statusCode != null ? String(error.statusCode) : "—"} />
              <DevRow label="Request ID" value={error.requestId ?? "—"} />
              <DevRow label="Model" value={error.model ?? "—"} />
              <DevRow label="Raw Message" value={error.rawMessage ?? "—"} block />
              <DevRow label="Provider Response" value={error.responseBody ?? "—"} block />
              <DevRow label="Stack Trace" value={error.stack ?? "—"} block />
            </div>
          )}
        </div>
      ) : showDetails ? (
        <div className="border-t border-destructive/15 px-4 py-2 text-caption text-muted-foreground">
          Enable <span className="font-medium text-foreground">Developer Mode</span> in Settings →
          Advanced for the raw provider response and stack trace.
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  icon,
  accent,
  mono,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <span className="select-none pt-px text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "flex items-start gap-1.5 break-words text-foreground",
          mono && "font-mono text-[13px]",
          accent && "text-foreground",
        )}
      >
        {icon}
        <span className={cn(accent && "font-medium")}>{value}</span>
      </span>
    </div>
  );
}

function DevRow({ label, value, block }: { label: string; value: string; block?: boolean }) {
  return (
    <div className={cn(block ? "space-y-1" : "flex items-center gap-2")}>
      <span className="text-muted-foreground">{label}:</span>{" "}
      {block ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card/60 p-2 text-foreground/90">
          {value}
        </pre>
      ) : (
        <span className="text-foreground/90">{value}</span>
      )}
    </div>
  );
}
