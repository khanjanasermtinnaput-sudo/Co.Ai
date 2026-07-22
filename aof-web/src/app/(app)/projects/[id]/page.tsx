import type { Metadata } from "next";
import { OpenProject } from "@/components/projects/open-project";

export const metadata: Metadata = { title: "Project" };

export default function ProjectPage({ params }: { params: { id: string } }) {
  return <OpenProject projectId={params.id} />;
}
