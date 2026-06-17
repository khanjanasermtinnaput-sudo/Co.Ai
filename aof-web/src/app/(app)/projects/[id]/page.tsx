import type { Metadata } from "next";
import { ProjectWorkspace } from "@/components/projects/project-workspace";

export const metadata: Metadata = { title: "Project" };

export default function ProjectWorkspacePage({ params }: { params: { id: string } }) {
  return <ProjectWorkspace projectId={params.id} />;
}
