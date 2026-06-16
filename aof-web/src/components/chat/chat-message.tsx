"use client";

import { motion } from "framer-motion";
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Pencil, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { estimateTokens } from "@/lib/export";
import type { ChatMessageT } from "@/lib/types";
import { TaotaoAvatar } from "@/components/mascot";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Markdown } from "./markdown";
import { AttachmentList } from "./attachment-list";
import { RouteBadge } from "./route-badge";
import { LearningAnswerView } from "./learning-answer";
import { ErrorPanel } from "@/components/diagnostics/error-panel";
import { FailoverNotice } from "@/components/diagnostics/failover-notice";
import { ActiveModelBadge } from "@/components/diagnostics/active-model-badge";

const AGENT_LABELS: Record<string, string> = {
  chief: "Chief Agent",
  research: "Research Agent",
  writing: "Writing Agent",
  math: "Math Agent",
  coding: "Code Agent",
  vision: "Vision Agent",
  system: "System",
};

function AgentStatusBar({ status }: { status: string }) {
  const [agent, ...rest] = status.split(": ");
  const label = AGENT_LABELS[agent] ?? agent;
  const detail = rest.join(": ");
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-primary/80">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      <span className="font-medium">{label}</span>
      {detail && <span className="text-muted-foreground">— {detail}</span>}
    </div>
  );
}

function AgentBadges({ agents, quality, categories }: { agents?: string[]; quality?: number; categories?: string[] }) {
  if (!agents?.length && !quality && !categories?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {categories?.slice(0, 3).map((cat) => (
        <span key={cat} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">
          {cat.replace(/_/g, " ")}
        </span>
      ))}
      {quality !== undefined && quality > 0 && (
        <span className={cn(
          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
          quality >= 90 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400",
        )}>
          ✓ {quality}/100
        </span>
      )}
    </div>
  );
}

export function ChatMessage({
  message,
  isLast,
  onRegenerate,
  onEdit,
}: {
  message: ChatMessageT;
  isLast?: boolean;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(draft.length, draft.length);
    }
  }, [editing, draft]);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== message.content && onEdit) {
      onEdit(trimmed);
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(message.content);
    setEditing(false);
  };

  const tokens = !message.streaming && message.content
    ? estimateTokens(message.content)
    : null;

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
          <TaotaoAvatar message={message} isLast={isLast} />
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
            {!isUser && message.activeModel && <ActiveModelBadge notice={message.activeModel} />}
            {!isUser && message.route && <RouteBadge route={message.route} />}
            {!isUser && message.agentStatus && <AgentStatusBar status={message.agentStatus} />}

            {/* ── User message: editable ──────────────────────────────── */}
            {isUser && editing ? (
              <div className="flex w-full flex-col gap-2">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      commitEdit();
                    }
                    if (e.key === "Escape") cancelEdit();
                  }}
                  rows={1}
                  className="w-full resize-none overflow-hidden rounded-2xl rounded-tr-md border border-primary/40 bg-primary/12 px-4 py-3 text-[15px] text-foreground outline-none focus:border-primary/70"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5"
                  >
                    <X className="size-3" /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={commitEdit}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
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
            )}

            {!isUser && !message.streaming && (
              <AgentBadges
                agents={message.agentsUsed}
                quality={message.qualityScore}
                categories={message.categories}
              />
            )}

            {/* ── Action bar ──────────────────────────────────────────── */}
            {!editing && !message.streaming && (
              <div
                className={cn(
                  "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
                  isUser ? "flex-row-reverse" : "flex-row",
                )}
              >
                {/* User message: Edit */}
                {isUser && onEdit && (
                  <ActionButton onClick={() => setEditing(true)} label="Edit message">
                    <Pencil className="size-3.5" />
                  </ActionButton>
                )}

                {/* Assistant: Copy */}
                {!isUser && message.content && (
                  <ActionButton onClick={copy} label={copied ? "Copied" : "Copy"}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </ActionButton>
                )}

                {/* Assistant: Thumbs */}
                {!isUser && (
                  <>
                    <ActionButton
                      onClick={() => setFeedback(feedback === "up" ? null : "up")}
                      label="Helpful"
                      active={feedback === "up"}
                    >
                      <ThumbsUp className="size-3.5" />
                    </ActionButton>
                    <ActionButton
                      onClick={() => setFeedback(feedback === "down" ? null : "down")}
                      label="Not helpful"
                      active={feedback === "down"}
                    >
                      <ThumbsDown className="size-3.5" />
                    </ActionButton>
                  </>
                )}

                {/* Assistant last message: Regenerate */}
                {!isUser && isLast && onRegenerate && (
                  <ActionButton onClick={onRegenerate} label="Regenerate">
                    <RefreshCw className="size-3.5" />
                  </ActionButton>
                )}

                {/* Token count estimate */}
                {tokens !== null && tokens > 10 && (
                  <span className="ml-1 text-[10px] text-muted-foreground/40">
                    ~{tokens > 999 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens
                  </span>
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
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
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
