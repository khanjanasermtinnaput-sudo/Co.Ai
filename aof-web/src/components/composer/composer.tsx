"use client";

import * as React from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ComposerProps {
  placeholder?: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  streaming?: boolean;
  onStop?: () => void;
  autoFocus?: boolean;
  className?: string;
  /** content rendered under the textarea, e.g. a model selector or hint */
  toolbar?: React.ReactNode;
  size?: "lg" | "md";
}

/** Premium auto-growing composer with Enter-to-send and Shift+Enter for newline. */
export function Composer({
  placeholder = "Ask anything…",
  onSubmit,
  disabled = false,
  streaming = false,
  onStop,
  autoFocus = false,
  className,
  toolbar,
  size = "md",
}: ComposerProps) {
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const maxHeight = size === "lg" ? 240 : 200;

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);

  React.useEffect(() => {
    resize();
  }, [value, resize]);

  const canSend = value.trim().length > 0 && !disabled && !streaming;

  const submit = () => {
    if (!canSend) return;
    onSubmit(value.trim());
    setValue("");
    requestAnimationFrame(resize);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        "group glass rounded-2xl border border-white/10 shadow-glass transition-card",
        "focus-within:border-primary/40 focus-within:shadow-glow",
        size === "lg" ? "p-3" : "p-2.5",
        className,
      )}
    >
      <div className="flex items-end gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label="Attach"
            >
              <Paperclip className="size-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Attach files</TooltipContent>
        </Tooltip>

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={cn(
            "no-scrollbar flex-1 resize-none border-0 bg-transparent py-2 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0",
            size === "lg" ? "text-base leading-relaxed" : "text-sm",
          )}
          style={{ maxHeight }}
        />

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors hover:bg-accent"
            aria-label="Stop"
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className={cn(
              "mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg transition-all",
              canSend
                ? "bg-primary text-primary-foreground shadow-glow-sm hover:shadow-glow active:scale-95"
                : "cursor-not-allowed bg-secondary text-muted-foreground/50",
            )}
            aria-label="Send"
          >
            <ArrowUp className="size-[18px]" />
          </button>
        )}
      </div>

      {toolbar && (
        <div className="mt-1.5 flex items-center gap-2 px-1">{toolbar}</div>
      )}
    </div>
  );
}
