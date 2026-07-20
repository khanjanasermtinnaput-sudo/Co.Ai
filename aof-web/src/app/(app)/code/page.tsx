import type { Metadata } from "next";
import { CoCodeWorkspace } from "@/components/cocode/cocode-workspace";
import { CoCodeGate } from "@/components/cocode/cocode-gate";

export const metadata: Metadata = {
  title: "CoCode",
  description: "Your AI development workspace — files, editor, AI build, GitHub, and deploy in one place.",
};

export default function CodePage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CoCodeGate>
        <CoCodeWorkspace />
      </CoCodeGate>
    </div>
  );
}
