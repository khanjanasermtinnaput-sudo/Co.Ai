"use client";

// Thin bridge page: hydrate the requested project's identity into the CoCode
// workspace, then hand off to /code — the one place the workspace (and its
// Pro+ gate) actually renders, rather than duplicating that shell here.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useProjectStore } from "@/store/project-store";
import { openProjectInWorkspace } from "@/lib/cocode/open-project";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";

export function OpenProject({ projectId }: { projectId: string }) {
  const router = useRouter();
  const loaded = useProjectStore((s) => s.loaded);
  const load = useProjectStore((s) => s.load);
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    if (loaded && project) {
      openProjectInWorkspace(project);
      router.replace("/code");
    }
  }, [loaded, project, router]);

  if (loaded && !project) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-lg font-semibold">Project not found</h2>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or it belongs to another account.
        </p>
        <Button variant="secondary" onClick={() => router.push("/projects")}>
          <ArrowLeft className="size-4" /> Back to projects
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <LogoMark size={40} className="animate-pulse" />
    </div>
  );
}
