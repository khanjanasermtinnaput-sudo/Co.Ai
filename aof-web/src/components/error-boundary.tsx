"use client";

import * as React from "react";
import { RefreshCw, Copy, Check, AlertOctagon } from "lucide-react";
import { logClientError } from "@/lib/errors/logger";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  logId?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const entry = logClientError(error, {
      code: "SYSTEM-500",
      stack: `${error.stack ?? ""}\n\nComponent Stack:${info.componentStack ?? ""}`,
    });
    this.setState({ logId: entry.id });
  }

  reset = () => this.setState({ hasError: false, error: undefined, logId: undefined });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return <ErrorFallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onReset }: { error?: Error; onReset: () => void }) {
  const [copied, setCopied] = React.useState(false);

  const report = [
    `Error Code:  SYSTEM-500`,
    `Title:       Unexpected Application Error`,
    `Message:     ${error?.message ?? "Unknown error"}`,
    `URL:         ${typeof window !== "undefined" ? window.location.href : "unknown"}`,
    `Timestamp:   ${new Date().toISOString()}`,
    ``,
    `Stack Trace:`,
    error?.stack ?? "(no stack)",
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
    <div
      role="alert"
      className="flex min-h-[200px] flex-col overflow-hidden rounded-xl border border-destructive/40 bg-destructive/[0.06]"
    >
      <div className="flex items-center gap-2.5 border-b border-destructive/25 bg-destructive/10 px-4 py-2.5">
        <AlertOctagon className="size-4 shrink-0 text-destructive" />
        <span className="font-mono text-[11px] font-semibold tracking-tight text-destructive">
          SYSTEM-500
        </span>
        <span className="text-sm text-destructive/90">· Unexpected Application Error</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          {error?.message ?? "An unexpected error occurred in this component."}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-white/5"
          >
            <RefreshCw className="size-3" />
            Try again
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-white/5"
          >
            {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy Diagnostics"}
          </button>
        </div>
      </div>
    </div>
  );
}
