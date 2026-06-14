"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Code2, Sparkles } from "lucide-react";
import { BRAND } from "@/lib/constants";
import { useChatStore } from "@/store/chat-store";
import { Composer } from "@/components/composer/composer";
import { ResponseStyleSelector } from "@/components/chat/response-style-selector";
import type { Attachment } from "@/lib/types";

const SUGGESTIONS = [
  "Explain a concept simply",
  "Solve a math problem step by step",
  "Build a landing page",
  "Debug my code",
];

export function HomePrompt() {
  const router = useRouter();
  const style = useChatStore((s) => s.style);
  const setStyle = useChatStore((s) => s.setStyle);
  const queueFirstMessage = useChatStore((s) => s.queueFirstMessage);
  const selectConversation = useChatStore((s) => s.selectConversation);

  const startChat = (value: string, attachments: Attachment[] = []) => {
    selectConversation(null);
    queueFirstMessage(value, attachments);
    router.push("/chat");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="w-full"
    >
      <Composer
        size="lg"
        autoFocus
        placeholder={BRAND.composerPlaceholder}
        onSubmit={startChat}
        toolbar={
          <div className="flex w-full items-center justify-between">
            <ResponseStyleSelector value={style} onChange={setStyle} size="compact" />
            <button
              type="button"
              onClick={() => router.push("/code")}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Code2 className="size-3.5" /> Switch to Aof Code
            </button>
          </div>
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => startChat(s)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
          >
            <Sparkles className="size-3 text-primary/70" />
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
