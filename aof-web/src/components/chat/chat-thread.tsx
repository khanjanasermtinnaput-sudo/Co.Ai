"use client";

import { useEffect, useRef } from "react";
import type { ChatMessageT } from "@/lib/types";
import { ChatMessage } from "./chat-message";

export function ChatThread({
  messages,
  streaming,
}: {
  messages: ChatMessageT[];
  streaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastLen = useRef(0);

  // Auto-scroll to the newest content while streaming or when a message is added.
  useEffect(() => {
    const lastContent = messages[messages.length - 1]?.content.length ?? 0;
    const grew = messages.length > lastLen.current || lastContent > 0;
    lastLen.current = messages.length;
    if (grew) bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}
      <div ref={bottomRef} className="h-px" />
    </div>
  );
}
