// ── Client helper for /api/projects/[id]/files ────────────────────────────────
// Persists the CoCode virtual FS (store/cocode-ide-store.ts) to Supabase, scoped
// to the signed-in account — the "real per-project file storage" that
// open-project.ts's header comment tracked as follow-up work. Mirrors the
// authedFetch pattern in lib/keys.ts / lib/conversations.ts.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { isSignedIn } from "@/store/auth-store";

/** True when workspace files can round-trip to the server at all. */
export function workspaceFilesEnabled(): boolean {
  return isSupabaseConfigured() && isSignedIn();
}

async function authToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const expiresAt = (data.session.expires_at ?? 0) * 1000;
  if (Date.now() >= expiresAt - 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  }
  return data.session.access_token;
}

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await authToken();
  if (!token) throw new Error("not-signed-in");
  return fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

export interface RemoteWorkspaceFile {
  path: string;
  content: string;
  sha?: string;
}

/**
 * Load every saved file for a project. Returns `null` when the caller isn't in
 * a position to fetch at all (not signed in / Supabase not configured) — a
 * genuinely empty (but successfully loaded) project returns `[]`.
 */
export async function fetchProjectFiles(projectId: string): Promise<RemoteWorkspaceFile[] | null> {
  if (!workspaceFilesEnabled()) return null;
  const res = await authedFetch(`/api/projects/${projectId}/files`);
  if (!res.ok) throw new Error(`fetch-project-files-failed (${res.status})`);
  const json = (await res.json()) as { files: Array<{ path: string; content: string; sha: string | null }> };
  return (json.files ?? []).map((f) => ({ path: f.path, content: f.content, sha: f.sha ?? undefined }));
}

/** Replace the project's whole saved file set with the given files. */
async function saveProjectFiles(projectId: string, files: RemoteWorkspaceFile[]): Promise<void> {
  await authedFetch(`/api/projects/${projectId}/files`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
}

// ── Debounced sync ────────────────────────────────────────────────────────────
// The workspace fires this on every fs mutation (create/update/delete/rename,
// diff apply, checkpoint undo/redo/restore) — syncing the FULL current file set
// each time keeps deletes/renames correct for free, at the cost of re-sending
// unchanged files. A short idle debounce, keyed per project, keeps that cheap in
// practice (typing pauses collapse into one save) without an extra dirty-diff
// mechanism duplicating what virtual-fs.ts already tracks per-file.
const DEBOUNCE_MS = 1500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleWorkspaceSync(projectId: string, files: RemoteWorkspaceFile[]): void {
  if (!workspaceFilesEnabled()) return;

  const existing = timers.get(projectId);
  if (existing) clearTimeout(existing);

  timers.set(
    projectId,
    setTimeout(() => {
      timers.delete(projectId);
      saveProjectFiles(projectId, files).catch((e) => {
        console.warn("[cocode] workspace sync failed:", e);
      });
    }, DEBOUNCE_MS),
  );
}
