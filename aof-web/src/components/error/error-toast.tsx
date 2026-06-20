"use client";

// ── Error Toast ───────────────────────────────────────────────────────────────
// Rich toast showing an error code, title, message, and an optional action
// button. Use `showErrorToast()` from anywhere in the client app.

import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { findByCode, type ErrorEntry } from "@/lib/errors/error-codes";
import type { AppError } from "@/lib/errors/api-error";

// ── Render helper (used by sonner's `jsx` option) ────────────────────────────

function ErrorToastContent({
  code,
  title,
  message,
  actionLabel,
  onAction,
}: {
  code: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
        <span className="font-mono text-[11px] font-semibold tracking-tight text-destructive">
          {code}
        </span>
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 self-start rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-white/5"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ShowErrorToastOptions {
  /** Override the message from the registry. */
  message?: string;
  /** Label for an optional CTA button. */
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

/** Show a structured error toast from a registry code, e.g. "AUTH-401". */
export function showErrorToast(
  code: string,
  opts: ShowErrorToastOptions = {},
): string | number {
  const entry = findByCode(code);
  const title = entry?.title ?? "Error";
  const message = opts.message ?? entry?.message ?? "An unexpected error occurred.";

  return toast.custom(
    () => (
      <ErrorToastContent
        code={code}
        title={title}
        message={message}
        actionLabel={opts.actionLabel}
        onAction={opts.onAction}
      />
    ),
    {
      duration: opts.duration ?? 6000,
      className: "border border-destructive/30 bg-background shadow-lg",
    },
  );
}

/** Show an error toast from a parsed `AppError` envelope. */
export function showAppErrorToast(
  err: AppError,
  opts: Omit<ShowErrorToastOptions, "message"> = {},
): string | number {
  return showErrorToast(err.errorCode, { ...opts, message: err.message });
}

/** Convenience: AUTH-401 toast that opens the sign-in page. */
export function showAuthErrorToast(): string | number {
  return showErrorToast("AUTH-401", {
    actionLabel: "Sign In",
    onAction: () => { window.location.href = "/login"; },
  });
}
