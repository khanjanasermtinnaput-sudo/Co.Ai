import type { Metadata } from "next";
import { CodeWorkspace } from "@/components/code/code-workspace";

export const metadata: Metadata = { title: "CoAgentix Code" };

export default function CodePage() {
  return <CodeWorkspace />;
}
