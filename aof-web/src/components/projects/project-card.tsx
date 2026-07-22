"use client";

import { forwardRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Pin, PinOff, MoreVertical, Clock, Trash2, FolderOpen } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import type { Project } from "@/lib/types";
import { getModelDisplayName } from "@/lib/model-branding";
import { useProjectStore } from "@/store/project-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TYPE_META, STATUS_META } from "./project-meta";

export const ProjectCard = forwardRef<HTMLDivElement, { project: Project }>(function ProjectCard(
  { project },
  ref,
) {
  const router = useRouter();
  const togglePin = useProjectStore((s) => s.togglePin);
  const remove = useProjectStore((s) => s.deleteProject);
  const type = TYPE_META[project.type];
  const status = STATUS_META[project.status];
  const TypeIcon = type.icon;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = () => router.push(`/projects/${project.id}`);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25 }}
      onClick={open}
      className="group relative flex cursor-pointer flex-col rounded-2xl border border-foreground/[0.07] bg-card/60 p-4 transition-card hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-glow"
    >
      <div className="flex items-start justify-between">
        <span className="flex size-10 items-center justify-center rounded-xl border border-foreground/10 bg-background/60 text-primary">
          <TypeIcon className="size-5" />
        </span>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => togglePin(project.id)}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-foreground/5",
              project.pinned ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100",
            )}
            aria-label={project.pinned ? "Unpin" : "Pin"}
          >
            {project.pinned ? <Pin className="size-4 fill-current" /> : <Pin className="size-4" />}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-colors hover:bg-foreground/5 group-hover:opacity-100"
                aria-label="More"
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={open}>
                <FolderOpen /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => togglePin(project.id)}>
                {project.pinned ? <PinOff /> : <Pin />}
                {project.pinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmDelete(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${project.name}"?`}
        description="This permanently deletes the project and cannot be undone."
        onConfirm={() => remove(project.id)}
      />

      <h3 className="mt-3 line-clamp-1 text-[15px] font-semibold text-foreground">
        {project.name}
      </h3>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
        {project.description}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <Badge variant={status.variant} className="gap-1.5">
          <span className="size-1.5 rounded-full bg-current" />
          {status.label}
        </Badge>
        <Badge variant="outline">{type.label}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
        <Clock className="size-3.5" />
        Edited {timeAgo(project.updatedAt)}
        {project.mode && (
          <>
            <span className="mx-1 text-muted-foreground/40">·</span>
            <span>{getModelDisplayName(project.mode)}</span>
          </>
        )}
      </div>
    </motion.div>
  );
});

export function NewProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[188px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/30 p-4 text-muted-foreground transition-card hover:-translate-y-0.5 hover:border-primary/40 hover:text-foreground"
    >
      <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-background/60 transition-colors group-hover:border-primary/40 group-hover:text-primary">
        <FolderOpen className="size-5" />
      </span>
      <span className="text-sm font-medium">Create new project</span>
    </button>
  );
}
