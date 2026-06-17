"use client";

import { useCodeStore } from "@/store/code-store";
import { useChatStore } from "@/store/chat-store";
import { CodeModeSelector } from "./code-mode-selector";
import { CodeConversation } from "./code-conversation";
import { TitanWorkflow } from "./titan-workflow";
import { SearchModeSelector } from "@/components/chat/search-mode-selector";

export function CodeWorkspace() {
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
