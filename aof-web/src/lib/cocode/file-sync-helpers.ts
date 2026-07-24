// ── Pure helpers for /api/projects/[id]/files ─────────────────────────────────
// Split out from the route so the trickiest part — replace semantics for a
// batch file save — is unit-testable without a Supabase mock.

export interface IncomingFile {
  path: string;
  content: string;
  sha?: string;
}

/** Validate + narrow an untrusted request body's `files` field. */
export function parseIncomingFiles(raw: unknown): IncomingFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is IncomingFile =>
    typeof f === "object" && f !== null &&
    typeof (f as IncomingFile).path === "string" &&
    typeof (f as IncomingFile).content === "string",
  );
}

/**
 * Given what's already saved and what the client just sent, return the paths
 * that must be deleted to make the saved set match the workspace exactly —
 * i.e. every existing path the incoming batch no longer contains (covers a
 * plain delete and a rename, both of which leave the old path behind).
 */
export function diffStalePaths(existingPaths: string[], incomingFiles: IncomingFile[]): string[] {
  const keep = new Set(incomingFiles.map((f) => f.path));
  return existingPaths.filter((p) => !keep.has(p));
}
