"use client";

import { useEffect, useRef } from "react";
import type { ChatMessageT } from "@/lib/types";
import { ChatMessage } from "./chat-message";
import { useChatStore } from "@/store/chat-store";

export function ChatThread({
  messages,
  streaming,
}: {
  messages: ChatMessageT[];
  streaming: boolean;
}) {
  const regenerate = useChatStore((s) => s.regenerate);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastLen = useRef(0);

  useEffect(() => {
    const lastContent = messages[messages.length - 1]?.content.length ?? 0;
    const grew = messages.length > lastLen.current || lastContent > 0;
    lastLen.current = messages.length;
    if (grew) bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  // Find the index of the last assistant message for the regenerate button
  const lastAssistantIdx = messages.reduce(
    (last, m, i) => (m.role === "assistant" ? i : last),
    -1,
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      {messages.map((m, i) => (
        <ChatMessage
          key={m.id}
          message={m}
          isLast={i === lastAssistantIdx}
          onRegenerate={!streaming && i === lastAssistantIdx ? regenerate : undefined}
        />
      ))}
      <div ref={bottomRef} className="h-px" />
    </div>
  );
}
