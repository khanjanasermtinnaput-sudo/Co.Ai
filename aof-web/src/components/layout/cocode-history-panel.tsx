"use client";

// ── CoCode history panel ──────────────────────────────────────────────────────
// Reads only useProjectStore — never touches CoChat's conversations. Rendered
// by the desktop sidebar and the mobile nav drawer when in the Code area.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, Pin, Search, Trash2, X } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { useProjectStore } from "@/store/project-store";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function CoCodeHistoryPanel() {
  const projects = useProjectStore((s) => s.projects);
  const load = useProjectStore((s) => s.load);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    });
  }, [projects, search]);

  if (projects.length === 0) return null;

  const pendingName = pendingDeleteId
    ? projects.find((p) => p.id === pendingDeleteId)?.name
    : null;

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-caption font-medium uppercase tracking-wider text-muted-foreground/70">
          Recent Projects
        </p>
        <span className="text-micro text-muted-foreground/50">
          {filtered.length}/{projects.length}
        </span>
      </div>

      <div className="relative mb-1">
        <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="w-full rounded-lg border border-border/50 bg-foreground/[0.03] py-1.5 pl-7 pr-7 text-label text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/30 focus:bg-foreground/[0.05]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-center text-label text-muted-foreground/50">
          No projects match &ldquo;{search}&rdquo;
        </p>
      ) : (
        filtered.map((p) => (
          <div
            key={p.id}
            className="group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <button
              type="button"
              onClick={() => router.push(`/projects/${p.id}`)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <FolderKanban className="size-3.5 shrink-0 opacity-60" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-body-sm">
                  {p.pinned && <Pin className="size-2.5 shrink-0 fill-current text-primary" />}
                  {p.name}
                </p>
                <p className="text-caption text-muted-foreground/60">{timeAgo(p.updatedAt)}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPendingDeleteId(p.id);
              }}
              className="shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Delete "${p.name}"`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        title={pendingName ? `Delete "${pendingName}"?` : "Delete this project?"}
        description="This permanently deletes the project and cannot be undone."
        onConfirm={() => {
          if (pendingDeleteId) deleteProject(pendingDeleteId);
        }}
      />
    </div>
  );
}
