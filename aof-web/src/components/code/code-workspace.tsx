"use client";

import { useCodeStore } from "@/store/code-store";
import { CodeModeSelector } from "./code-mode-selector";
import { CodeBuild } from "./code-build";
import { TitanWorkflow } from "./titan-workflow";

export function CodeWorkspace() {
  const mode = useCodeStore((s) => s.mode);
  const setMode = useCodeStore((s) => s.setMode);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/70 bg-background/70 px-3 backdrop-blur-xl sm:px-5">
        <CodeModeSelector value={mode} onChange={setMode} />
        {mode === "titan" && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Titan never writes code before approval
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "titan" ? (
          <div className="h-full overflow-y-auto">
            <TitanWorkflow />
          </div>
        ) : (
          <CodeBuild mode={mode} />
        )}
      </div>
    </div>
  );
}
