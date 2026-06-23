import type { Metadata } from "next";
import { CodeWorkspace } from "@/components/code/code-workspace";

export const metadata: Metadata = { title: "CoCode" };

export default function CodePage() {
  return <CodeWorkspace />;
}
