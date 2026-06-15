"use client";

import { motion } from "framer-motion";
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessageT } from "@/lib/types";
import { LogoMark } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Markdown } from "./markdown";
import { AttachmentList } from "./attachment-list";
import { RouteBadge } from "./route-badge";
import { LearningAnswerView } from "./learning-answer";
import { ErrorPanel } from "@/components/diagnostics/error-panel";
import { FailoverNotice } from "@/components/diagnostics/failover-notice";

export function ChatMessage({
  message,
  isLast,
  onRegenerate,
}: {
  message: ChatMessageT;
  isLast?: boolean;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

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
      <div className={cn("flex min-w-0 max-w-[min(680px,85%)] flex-col gap-1.5", isUser && "items-end")}>
        {!isUser && message.failover && <FailoverNotice notice={message.failover} />}

        {!isUser && message.error ? (
          <>
            {message.content && (
              <div className="rounded-2xl rounded-tl-md border border-white/[0.06] bg-card/50 px-4 py-3 opacity-70">
                <Markdown content={message.content} />
                <p className="mt-2 text-xs text-muted-foreground">
                  ⚠ Partial response — generation stopped due to a provider error.
                </p>
              </div>
            )}
            <ErrorPanel error={message.error} />
          </>
        ) : (
          <>
            {!isUser && message.route && <RouteBadge route={message.route} />}
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

            {/* ── Action bar (assistant messages only, not streaming) ───── */}
            {!isUser && message.content && !message.streaming && (
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {/* Copy */}
                <ActionButton onClick={copy} label={copied ? "Copied" : "Copy"}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </ActionButton>

                {/* Thumbs up */}
                <ActionButton
                  onClick={() => setFeedback(feedback === "up" ? null : "up")}
                  label="Helpful"
                  active={feedback === "up"}
                >
                  <ThumbsUp className="size-3.5" />
                </ActionButton>

                {/* Thumbs down */}
                <ActionButton
                  onClick={() => setFeedback(feedback === "down" ? null : "down")}
                  label="Not helpful"
                  active={feedback === "down"}
                >
                  <ThumbsDown className="size-3.5" />
                </ActionButton>

                {/* Regenerate — only on the last assistant message */}
                {isLast && onRegenerate && (
                  <ActionButton onClick={onRegenerate} label="Regenerate">
                    <RefreshCw className="size-3.5" />
                  </ActionButton>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function ActionButton({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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
