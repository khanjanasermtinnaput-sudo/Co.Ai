"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useChatStore } from "@/store/chat-store";

const EXAMPLES = [
  "Explain a concept simply",
  "Solve a math problem step by step",
  "Build a landing page",
  "Debug my code",
];

export function ExamplesSection() {
  const router = useRouter();
  const queueFirstMessage = useChatStore((s) => s.queueFirstMessage);
  const selectConversation = useChatStore((s) => s.selectConversation);

  const startChat = (text: string) => {
    selectConversation(null);
    queueFirstMessage(text);
    router.push("/chat");
  };

  return (
    <div className="mt-10 border-t border-border/40 pt-6">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
        Examples
      </p>
      <div className="flex flex-col gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => startChat(ex)}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left text-sm text-muted-foreground transition-all hover:border-primary/20 hover:text-foreground"
          >
            <Sparkles className="size-3.5 shrink-0 text-primary/50" />
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
