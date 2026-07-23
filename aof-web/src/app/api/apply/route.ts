// ── Apply Engine API (Phase 8) ────────────────────────────────────────────────
// Receives a parsed diff + file contents, validates the patch can be applied,
// and returns the patched files. The actual apply in the virtual FS happens
// client-side; this endpoint provides server-side validation.

import { parseDiff, applyAcceptedHunks } from "@/lib/cocode/diff";
import { formatError } from "@/lib/errors/api-error";

export const runtime = "nodejs";

interface ApplyRequest {
  diff: string;                // raw unified diff text
  files: Array<{ path: string; content: string }>;
  acceptAll?: boolean;         // if true, accept all hunks
}

interface ApplyResult {
  ok: boolean;
  patched: Array<{ path: string; content: string }>;
  errors: Array<{ path: string; error: string }>;
  stats: { filesChanged: number; added: number; removed: number };
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return formatError("SYSTEM_500", { message: "Invalid JSON", detail: "invalid-json-body" }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return formatError("SYSTEM_500", { message: "Request body must be a JSON object", detail: "body-not-object" }, 400);
  }

  const { diff: rawDiff, files, acceptAll = true } = body as ApplyRequest;
  if (!rawDiff) return formatError("SYSTEM_500", { message: "diff required", detail: "missing-diff" }, 400);
  if (!Array.isArray(files)) return formatError("SYSTEM_500", { message: "files array required", detail: "missing-files-array" }, 400);

  const parsed = parseDiff(rawDiff);
  const fileMap = new Map(files.map((f) => [f.path, f.content]));
  const patched: Array<{ path: string; content: string }> = [];
  const errors: Array<{ path: string; error: string }> = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const fileDiff of parsed.files) {
    const path = fileDiff.newPath || fileDiff.oldPath;
    const original = fileMap.get(path) ?? fileMap.get(fileDiff.oldPath) ?? "";

    // Mark all hunks accepted if acceptAll
    if (acceptAll) {
      fileDiff.hunks.forEach((h) => { h.accepted = true; });
    }

    try {
      const patchedContent = applyAcceptedHunks(original, fileDiff);
      patched.push({ path, content: patchedContent });

      for (const hunk of fileDiff.hunks) {
        for (const line of hunk.lines) {
          if (line.kind === "added") totalAdded++;
          if (line.kind === "removed") totalRemoved++;
        }
      }
    } catch (err) {
      errors.push({ path, error: String(err) });
    }
  }

  return Response.json({
    ok: errors.length === 0,
    patched,
    errors,
    stats: {
      filesChanged: parsed.files.length,
      added: totalAdded,
      removed: totalRemoved,
    },
  } satisfies ApplyResult);
}
