"use client";

import { motion } from "framer-motion";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessageT } from "@/lib/types";
import { useChatStore } from "@/store/chat-store";
import { LogoMark } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Markdown } from "./markdown";
import { AttachmentList } from "./attachment-list";
import { RouteBadge } from "./route-badge";
import { LearningAnswerView } from "./learning-answer";
import { RESPONSE_STYLES } from "./response-style-selector";

export function ChatMessage({ message }: { message: ChatMessageT }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const streaming = useChatStore((s) => s.streaming);
  const regenerateAt = useChatStore((s) => s.regenerateAt);

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
        {!isUser && message.route && (
          <RouteBadge route={message.route} />
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "rounded-tr-md bg-primary/12 text-foreground"
              : "rounded-tl-md border border-white/[0.06] bg-card/70",
          )}
        >
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentList
              attachments={message.attachments}
              className={cn(message.content && "mb-2.5")}
            />
          )}
          {message.learning ? (
            <LearningAnswerView data={message.learning} />
          ) : message.content ? (
            <Markdown content={message.content} />
          ) : message.attachments && message.attachments.length > 0 ? null : (
            <TypingDots />
          )}
          {message.streaming && message.content && (
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary" />
          )}
        </div>

        {!isUser && !message.learning && message.content && !message.streaming && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {/* Per-message length controls — regenerate this reply instantly. */}
            <div
              role="radiogroup"
              aria-label="Regenerate at a different length"
              className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5"
            >
              {RESPONSE_STYLES.map((opt) => {
                const Icon = opt.icon;
                const active = (message.style ?? "normal") === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={streaming}
                    title={`Regenerate — ${opt.hint}`}
                    onClick={() => void regenerateAt(message.id, opt.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      active
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
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
