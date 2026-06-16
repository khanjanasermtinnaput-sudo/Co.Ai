// ── Export system types ───────────────────────────────────────────────────────
// Shared contracts for the Export-as-HTML / Export-as-ZIP feature. Kept separate
// from lib/export.ts so the UI layer can import types without pulling in JSZip.

export type ExportFormat = "html" | "zip";

export type ExportStage = "preparing" | "building" | "compressing" | "done";

export const EXPORT_STAGE_LABEL: Record<ExportStage, string> = {
  preparing: "Preparing Export…",
  building: "Building Files…",
  compressing: "Compressing ZIP…",
  done: "Download Ready",
};

export type ExportErrorReason = "EMPTY_PROJECT" | "INVALID_CODE" | "MISSING_FILES" | "NO_HTML_ENTRY";

export const EXPORT_ERROR_MESSAGE: Record<ExportErrorReason, string> = {
  EMPTY_PROJECT: "Empty Project State",
  INVALID_CODE: "Invalid Generated Code",
  MISSING_FILES: "Missing Project Files",
  NO_HTML_ENTRY: "No index.html found in the generated project",
};

export class ExportError extends Error {
  reason: ExportErrorReason;
  constructor(reason: ExportErrorReason) {
    super(EXPORT_ERROR_MESSAGE[reason]);
    this.reason = reason;
  }
}

export type ProjectKind = "html" | "react" | "nextjs" | "vue" | "unknown";
