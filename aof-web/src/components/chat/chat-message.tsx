"use client";

import { motion } from "framer-motion";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessageT } from "@/lib/types";
import { LogoMark } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Markdown } from "./markdown";

export function ChatMessage({ message }: { message: ChatMessageT }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("group flex gap-3.5", isUser && "flex-row-reverse")}
    >
      {/* avatar */}
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <Avatar className="size-8">
            <AvatarFallback className="bg-secondary text-[11px] text-foreground">
              You
            </AvatarFallback>
          </Avatar>
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-card">
            <LogoMark size={20} />
          </span>
        )}
      </div>

      {/* bubble */}
      <div className={cn("flex min-w-0 max-w-[min(680px,85%)] flex-col gap-1", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "rounded-tr-md bg-primary/12 text-foreground"
              : "rounded-tl-md border border-white/[0.06] bg-card/70",
          )}
        >
          {message.content ? (
            <Markdown content={message.content} />
          ) : (
            <TypingDots />
          )}
          {message.streaming && message.content && (
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary" />
          )}
        </div>

        {!isUser && message.content && !message.streaming && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}
