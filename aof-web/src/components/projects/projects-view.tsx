"use client";

import { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus, Search, Pin, FolderKanban } from "lucide-react";
import { useProjectStore } from "@/store/project-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectCard, NewProjectCard } from "./project-card";
import { NewProjectDialog } from "./new-project-dialog";

export function ProjectsView() {
  const projects = useProjectStore((s) => s.projects);
  const query = useProjectStore((s) => s.query);
  const setQuery = useProjectStore((s) => s.setQuery);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.type.toLowerCase().includes(q),
        )
      : projects;
    return list;
  }, [projects, query]);

  const pinned = filtered.filter((p) => p.pinned);
  const recent = [...filtered]
    .filter((p) => !p.pinned)
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:py-9">
      {/* header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <FolderKanban className="size-6 text-primary" />
            Projects
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manage and continue your work. {projects.length} project
            {projects.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="sm:self-auto">
          <Plus className="size-4" /> New project
        </Button>
      </div>

      {/* search */}
      <div className="relative mt-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="h-11 pl-9"
        />
      </div>

      {/* pinned */}
      {pinned.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Pin className="size-4 text-primary" /> Pinned
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {pinned.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* recent */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          {query ? "Results" : "Recent"}
        </h2>
        {recent.length === 0 && pinned.length === 0 ? (
          <EmptyState query={query} onCreate={() => setDialogOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {recent.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </AnimatePresence>
            {!query && <NewProjectCard onClick={() => setDialogOpen(true)} />}
          </div>
        )}
      </section>

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function EmptyState({ query, onCreate }: { query: string; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-background/60 text-muted-foreground">
        <FolderKanban className="size-6" />
      </span>
      <p className="mt-4 font-medium">
        {query ? `No projects match “${query}”` : "No projects yet"}
      </p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        {query
          ? "Try a different search term."
          : "Create your first project to start building with Aof."}
      </p>
      {!query && (
        <Button onClick={onCreate} className="mt-5">
          <Plus className="size-4" /> New project
        </Button>
      )}
    </div>
  );
}
