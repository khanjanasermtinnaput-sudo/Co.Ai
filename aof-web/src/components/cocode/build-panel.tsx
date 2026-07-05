"use client";

// ── Build panel ───────────────────────────────────────────────────────────────
// The conversational build + Titan workflow, folded into the CoCode workspace.
// Generated code is bridged into the workspace's file explorer/editor by
// code-store's bridgeToWorkspace() once a run completes.

import { useCodeStore } from "@/store/code-store";
import { useChatStore } from "@/store/chat-store";
import { CodeModeSelector } from "@/components/code/code-mode-selector";
import { CodeConversation } from "@/components/code/code-conversation";
import { TitanWorkflow } from "@/components/code/titan-workflow";
import { SearchModeSelector } from "@/components/chat/search-mode-selector";

export function BuildPanel() {
  const mode = useCodeStore((s) => s.mode);
  const setMode = useCodeStore((s) => s.setMode);
  const searchMode = useChatStore((s) => s.searchMode);
  const setSearchMode = useChatStore((s) => s.setSearchMode);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-border/70 bg-background/70 px-3 backdrop-blur-xl sm:px-5">
        <CodeModeSelector value={mode} onChange={setMode} />
        <SearchModeSelector value={searchMode} onChange={setSearchMode} size="compact" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "titan" ? (
          <div className="h-full overflow-y-auto">
            <TitanWorkflow />
          </div>
        ) : (
          <CodeConversation mode={mode} />
        )}
      </div>
    </div>
  );
}
