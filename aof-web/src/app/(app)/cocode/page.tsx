import type { Metadata } from "next";
import { CocodeIDE } from "@/components/cocode/cocode-ide";

export const metadata: Metadata = {
  title: "CoCode IDE — Co.AI",
  description: "AI-powered software engineering IDE with visual editing, GitHub integration, and multi-agent pipelines.",
};

export default function CocodePage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CocodeIDE />
    </div>
  );
}
