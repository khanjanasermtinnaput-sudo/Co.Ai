// ── Open a Projects-list project in the CoCode workspace ──────────────────────
// The one bridge from project-store (project metadata: name/description/type/
// status) into cocode-ide-store (the live IDE session: virtual FS, tabs,
// panels). Investigated before writing this: there is no per-project file
// persistence today — the IDE's virtual FS is a single in-session workspace
// (never written to Supabase; not even in cocode-ide-store's own localStorage
// partialize), so a project record has no real files to load. The honest
// behavior is therefore NOT "pretend the files loaded" — it's: if this
// project is already the one open this session, keep whatever's been built;
// otherwise reset to a clean slate under the new project's identity, so a
// different project never appears to inherit another one's leftover files.
// Real per-project file storage is tracked as follow-up work, not faked here.

import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { Project } from "@/lib/types";

export function openProjectInWorkspace(project: Project): void {
  const state = useCocodeIDEStore.getState();
  if (state.projectId === project.id) {
    if (state.projectName !== project.name) state.setProjectName(project.name);
    return;
  }
  state.resetWorkspace(project.id, project.name);
}
