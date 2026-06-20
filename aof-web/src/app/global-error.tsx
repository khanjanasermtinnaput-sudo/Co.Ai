"use client";

// ── Global Error Boundary ─────────────────────────────────────────────────────
// Next.js App Router catches uncaught render/runtime errors here. It renders
// in place of the root layout, so it MUST include its own html/body tags.
// Shows SYSTEM-500 with copy-diagnostics — never "Something went wrong."

import { useEffect, useState } from "react";
import { AlertOctagon, Copy, Check, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const report = [
    `Error Code:  SYSTEM-500`,
    `Title:       Unexpected Application Error`,
    `Message:     ${error.message}`,
    `Digest:      ${error.digest ?? "none"}`,
    `URL:         ${typeof window !== "undefined" ? window.location.href : "unknown"}`,
    `Timestamp:   ${new Date().toISOString()}`,
    `User Agent:  ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
    ``,
    `Stack Trace:`,
    error.stack ?? "(no stack)",
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          background: "#0A0A0A",
          color: "#FAFAFA",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            borderRadius: 16,
            border: "1px solid rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.06)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderBottom: "1px solid rgba(239,68,68,0.2)",
              background: "rgba(239,68,68,0.1)",
              padding: "14px 20px",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  color: "#ef4444",
                  margin: 0,
                }}
              >
                SYSTEM-500
              </p>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#FAFAFA", margin: 0 }}>
                Unexpected Application Error
              </p>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "20px 20px 0" }}>
            <p style={{ fontSize: 13, color: "rgba(250,250,250,0.7)", margin: "0 0 12px" }}>
              {error.message || "An unexpected error occurred in the application."}
            </p>

            {error.digest && (
              <p
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "rgba(250,250,250,0.4)",
                  margin: "0 0 16px",
                }}
              >
                Digest: {error.digest}
              </p>
            )}

            <div
              style={{
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
                padding: "10px 14px",
                marginBottom: 20,
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "rgba(250,250,250,0.4)",
                  margin: "0 0 4px",
                }}
              >
                Suggested Fix
              </p>
              <p style={{ fontSize: 13, color: "#FAFAFA", margin: 0 }}>
                Refresh the page. If the problem persists, copy the diagnostics
                below and contact support.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "0 20px 20px",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "#FAFAFA",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 14px",
                cursor: "pointer",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
              Try again
            </button>

            <button
              type="button"
              onClick={copy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "#FAFAFA",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 14px",
                cursor: "pointer",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke={copied ? "#22c55e" : "currentColor"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {copied ? (
                  <polyline points="20 6 9 17 4 12" />
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </>
                )}
              </svg>
              {copied ? "Copied" : "Copy Diagnostics"}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
