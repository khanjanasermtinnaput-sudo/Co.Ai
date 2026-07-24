// ── Open a Projects-list project in the CoCode workspace ──────────────────────
// The bridge from project-store (project metadata: name/description/type/
// status) into cocode-ide-store (the live IDE session: virtual FS, tabs,
// panels) AND, since this project's files are now persisted server-side
// (0012_cocode_files.sql, /api/projects/[id]/files), the loader that hydrates
// that FS from the last saved state. A different project must never appear to
// inherit another one's files, so switching projects always resets to a blank
// slate first and only fills it in once that project's own saved files (if
// any) have actually loaded.

import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { useProjectStore } from "@/store/project-store";
import { fetchProjectFiles, scheduleWorkspaceSync, workspaceFilesEnabled } from "@/lib/cocode/workspace-sync";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import type { Project } from "@/lib/types";

// Guards against firing a second concurrent fetch for a project that's
// already loading (e.g. open-project.tsx's navigation effect and
// cocode-workspace.tsx's mount-time reconcile both running for the same
// project).
const loading = new Set<string>();

export function openProjectInWorkspace(project: Project): void {
  const state = useCocodeIDEStore.getState();
  if (state.projectId === project.id) {
    if (state.projectName !== project.name) state.setProjectName(project.name);
    ensureWorkspaceLoaded(project.id);
    return;
  }
  state.resetWorkspace(project.id, project.name);
  void loadWorkspaceFiles(project.id);
}

/**
 * Load the current project's saved files if the workspace isn't already
 * hydrated for it — the mount-time reconcile a direct page load (or reload)
 * needs, since localStorage restores `projectId` but never `fs`.
 */
export function ensureWorkspaceLoaded(projectId: string | null): void {
  if (!projectId) {
    useCocodeIDEStore.getState().markWorkspaceReady();
    return;
  }
  if (useCocodeIDEStore.getState().workspaceReady) return;
  void loadWorkspaceFiles(projectId);
}

// Guards ensureProjectForWorkspace against firing twice for the same
// project-less session while its create-project call is in flight.
let provisioning = false;

/**
 * A CoCode session started directly at /code (no Projects-list entry, e.g.
 * from the sidebar's "Code" link) has no project to save into yet. Once such
 * a session actually has files worth keeping, this lazily creates a real
 * project row and adopts it — WITHOUT resetting the fs, since (unlike
 * openProjectInWorkspace switching to a different existing project) this is
 * the same in-progress work just gaining somewhere to persist. Call sites:
 * cocode-workspace.tsx's mount/fs-change reconcile effect.
 */
export async function ensureProjectForWorkspace(): Promise<void> {
  const state = useCocodeIDEStore.getState();
  if (state.projectId || provisioning) return;

  // Demo mode / signed out: nothing can be saved server-side — leave the
  // session project-less and let it work exactly as it always has.
  if (!workspaceFilesEnabled()) {
    state.markWorkspaceReady();
    return;
  }

  provisioning = true;
  try {
    const project = await useProjectStore.getState().createProject({
      name: state.projectName && state.projectName !== "Untitled Project" ? state.projectName : "Untitled project",
      description: "",
      type: "web-app",
    });
    if (project) {
      useCocodeIDEStore.getState().adoptProject(project.id, project.name);
      // adoptProject doesn't touch fs, so the fs-change → sync subscription
      // (cocode-ide-store.ts) won't fire on its own here — push the files
      // that already existed BEFORE this project did, explicitly.
      const currentFiles = flattenFiles(useCocodeIDEStore.getState().fs)
        .map((f) => ({ path: f.path, content: f.content, sha: f.sha }));
      scheduleWorkspaceSync(project.id, currentFiles);
    } else {
      // Create failed — still mark ready so this session's edits aren't
      // silently blocked from ever syncing once a project does exist.
      useCocodeIDEStore.getState().markWorkspaceReady();
    }
  } finally {
    provisioning = false;
  }
}

async function loadWorkspaceFiles(projectId: string): Promise<void> {
  if (loading.has(projectId)) return;
  loading.add(projectId);
  try {
    const files = await fetchProjectFiles(projectId);
    // The workspace may have moved on to a different (or no) project while
    // this fetch was in flight — never apply a stale result on top of it.
    if (useCocodeIDEStore.getState().projectId !== projectId) return;
    if (files && files.length) {
      useCocodeIDEStore.getState().hydrateFromServer(files);
    } else {
      useCocodeIDEStore.getState().markWorkspaceReady();
    }
  } catch (e) {
    console.warn("[cocode] failed to load saved workspace files:", e);
    if (useCocodeIDEStore.getState().projectId === projectId) {
      useCocodeIDEStore.getState().markWorkspaceReady();
    }
  } finally {
    loading.delete(projectId);
  }
}
