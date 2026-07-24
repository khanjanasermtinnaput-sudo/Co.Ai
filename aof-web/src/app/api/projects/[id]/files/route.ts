// ── /api/projects/[id]/files ──────────────────────────────────────────────────
// GET → load every saved CoCode workspace file for a project the caller owns
// PUT → replace the project's saved file set with the workspace's current state
//       (store/cocode-ide-store.ts syncs its whole virtual FS here on every
//       change — see lib/cocode/workspace-sync.ts — so a full replace is the
//       correct semantics: any path missing from the payload was deleted or
//       renamed in the workspace and must be removed here too).
//
// Real per-project persistence: until this route existed, CoCode's virtual FS
// (virtual-fs.ts) lived only in the browser tab — never written to Supabase,
// not even in cocode-ide-store's own localStorage partialize (`fs` was
// explicitly excluded as "too large for localStorage"). Every row is scoped to
// project_id AND user_id (0012_cocode_files.sql), so one signed-in account can
// never see or overwrite another's CoCode files, even across projects with the
// same id shape.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { formatError } from "@/lib/errors/api-error";
import { parseIncomingFiles, diffStalePaths } from "@/lib/cocode/file-sync-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser(req: Request) {
  if (!isAdminConfigured()) {
    return { error: formatError("API_500", { detail: "not-configured" }, 503) };
  }
  const user = await getUserFromRequest(req);
  if (!user) return { error: formatError("AUTH_401", { detail: "unauthorized" }) };
  return { user };
}

interface FileRow {
  path: string;
  content: string;
  sha: string | null;
  updated_at: string;
}

/** Ownership check, separate from the files query — a project id belonging to
 *  another user 404s instead of ever reaching (or revealing the existence of)
 *  that user's files. Mirrors /api/conversations/[id]/messages. */
async function requireOwnedProject(projectId: string, userId: string) {
  const { data, error } = await getAdminSupabase()
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { error: formatError("DB_500", { detail: "load-failed: " + error.message }) };
  if (!data) return { error: formatError("SYSTEM_500", { message: "not-found", detail: "project-not-found" }, 404) };
  return { error: null };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { id: projectId } = await params;
  const owned = await requireOwnedProject(projectId, user.id);
  if (owned.error) return owned.error;

  const { data, error: dbErr } = await getAdminSupabase()
    .from("cocode_files")
    .select("path, content, sha, updated_at")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .order("path", { ascending: true });

  if (dbErr) return formatError("DB_500", { detail: "load-failed: " + dbErr.message });
  return NextResponse.json({ files: (data ?? []) as FileRow[] });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireUser(req);
  if (error) return error;

  const { id: projectId } = await params;
  const owned = await requireOwnedProject(projectId, user.id);
  if (owned.error) return owned.error;

  let body: { files?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const files = parseIncomingFiles(body.files);

  const supabase = getAdminSupabase();
  const now = new Date().toISOString();

  if (files.length) {
    const rows = files.map((f) => ({
      project_id: projectId,
      user_id: user.id,
      path: f.path,
      content: f.content,
      sha: f.sha ?? null,
      updated_at: now,
    }));

    const { error: upsertErr } = await supabase
      .from("cocode_files")
      .upsert(rows, { onConflict: "project_id,path" });

    if (upsertErr) return formatError("DB_500", { detail: "save-failed: " + upsertErr.message });
  }

  // Replace semantics: drop any saved file whose path is no longer part of the
  // workspace (covers delete + rename, both of which leave the old path behind).
  // Diffed in JS (rather than a hand-built PostgREST "not in" filter string) so a
  // path containing a comma/quote/paren can never break the query.
  const { data: existing, error: existingErr } = await supabase
    .from("cocode_files")
    .select("path")
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (existingErr) return formatError("DB_500", { detail: "prune-lookup-failed: " + existingErr.message });

  const existingPaths = (existing ?? []).map((r) => (r as { path: string }).path);
  const stalePaths = diffStalePaths(existingPaths, files);

  if (stalePaths.length) {
    const { error: deleteErr } = await supabase
      .from("cocode_files")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .in("path", stalePaths);
    if (deleteErr) return formatError("DB_500", { detail: "prune-failed: " + deleteErr.message });
  }

  await supabase.from("projects").update({ updated_at: now }).eq("id", projectId).eq("user_id", user.id);

  return NextResponse.json({ ok: true, count: files.length });
}
