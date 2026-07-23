"use client";

import * as React from "react";
import { ArrowUp, ImageIcon, FileCode2, Plus, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCEPT, fileToAttachment } from "@/lib/attachments";
import type { Attachment } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AttachmentList } from "@/components/chat/attachment-list";
import { useSmartKeyboardContext } from "@/components/providers/smart-keyboard-provider";
import { SmartKeyboardBanner } from "@/components/chat/smart-keyboard-banner";

interface ComposerProps {
  placeholder?: string;
  /**
   * Handle a submitted message. Return `false` (or a promise resolving to `false`)
   * to signal the send was rejected — the composer will then restore the user's
   * draft instead of discarding it. Any other value is treated as accepted.
   */
  onSubmit: (
    value: string,
    attachments: Attachment[],
  ) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  streaming?: boolean;
  onStop?: () => void;
  autoFocus?: boolean;
  className?: string;
  /** content rendered under the textarea, e.g. a model selector or hint */
  toolbar?: React.ReactNode;
  size?: "lg" | "md";
  /** Seed the draft and focus the field whenever `nonce` changes — used by
   *  quick actions ("Learn something") to start a prompt for the user. */
  prefill?: { text: string; nonce: number } | null;
}

type UploadKind = keyof typeof ACCEPT;

/** Premium auto-growing composer with multimodal uploads (image / file),
 *  Enter-to-send and Shift+Enter for newline. */
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
  prefill = null,
}: ComposerProps) {
  const [value, setValue] = React.useState("");
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const acceptRef = React.useRef<string>(ACCEPT.file);
  const maxHeight = size === "lg" ? 240 : 200;

  const smartKeyboard = useSmartKeyboardContext();
  const [skSuggestion, setSkSuggestion] = React.useState<{
    text: string;
    confidence: number;
    direction: "en->th" | "th->en";
  } | null>(null);
  const skDismissedFor = React.useRef<string | null>(null);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);

  React.useEffect(() => {
    resize();
  }, [value, resize]);

  React.useEffect(() => {
    if (!prefill) return;
    setValue(prefill.text);
    const el = ref.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => {
        el.setSelectionRange(prefill.text.length, prefill.text.length);
      });
    }
    // Re-run only when a new prefill is issued, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  const canSend =
    (value.trim().length > 0 || attachments.length > 0) && !disabled && !streaming;

  const submit = async () => {
    if (!canSend) return;
    const text = value.trim();
    const atts = attachments;
    // Optimistically clear for a snappy feel, but never lose the message: if the
    // handler reports a rejection (not initialized yet, access gate, etc.) we
    // restore the draft — only clobbering nothing the user has since retyped.
    setValue("");
    setAttachments([]);
    setSkSuggestion(null);
    skDismissedFor.current = null;
    requestAnimationFrame(resize);
    const restore = () => {
      setValue((cur) => (cur.length ? cur : text));
      setAttachments((cur) => (cur.length ? cur : atts));
      requestAnimationFrame(resize);
    };
    try {
      const accepted = await onSubmit(text, atts);
      if (accepted === false) restore();
    } catch {
      restore();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const acceptSkSuggestion = () => {
    if (!skSuggestion) return;
    setValue(skSuggestion.text);
    setSkSuggestion(null);
    skDismissedFor.current = null;
    ref.current?.focus();
  };

  const dismissSkSuggestion = () => {
    skDismissedFor.current = value;
    setSkSuggestion(null);
  };

  const openPicker = (kind: UploadKind) => {
    acceptRef.current = ACCEPT[kind];
    if (fileRef.current) {
      fileRef.current.accept = ACCEPT[kind];
      fileRef.current.click();
    }
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file
    if (files.length === 0) return;
    const added = await Promise.all(files.map(fileToAttachment));
    setAttachments((prev) => [...prev, ...added]);
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  return (
    <div
      className={cn(
        "group border border-border bg-card transition-colors duration-200",
        "focus-within:border-foreground/30",
        size === "lg" ? "rounded-2xl p-4" : "rounded-xl p-3",
        className,
      )}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={acceptRef.current}
        onChange={onFiles}
        className="hidden"
        aria-label="Attach files"
        tabIndex={-1}
      />

      {attachments.length > 0 && (
        <AttachmentList
          attachments={attachments}
          onRemove={removeAttachment}
          className="mb-2 px-1"
        />
      )}

      <div className="flex items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Attach files"
            >
              <Plus className="size-[18px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={() => openPicker("image")} className="gap-2.5">
              <ImageIcon className="size-4 text-primary" /> Upload image
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPicker("file")} className="gap-2.5">
              <FileCode2 className="size-4 text-primary" /> Upload file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);

            const { detection, shouldAutoConvert, shouldSuggest } = smartKeyboard.evaluate(next);
            if (shouldAutoConvert && detection.converted) {
              setValue(detection.converted);
              setSkSuggestion(null);
              skDismissedFor.current = null;
            } else if (shouldSuggest && detection.converted && skDismissedFor.current !== next) {
              setSkSuggestion({
                text: detection.converted,
                confidence: detection.confidence,
                direction: detection.type === "none" ? "en->th" : detection.type,
              });
            } else {
              setSkSuggestion(null);
            }
          }}
          onKeyDown={onKeyDown}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            "no-scrollbar min-w-0 flex-1 resize-none border-0 bg-transparent py-2 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0",
            size === "lg" ? "text-base leading-relaxed" : "text-sm",
          )}
          style={{ maxHeight }}
        />

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-foreground transition-colors hover:bg-accent"
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
              "mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl transition-all",
              canSend
                ? "bg-primary text-primary-foreground hover:opacity-90 active:scale-95"
                : "cursor-not-allowed border border-border bg-secondary text-muted-foreground/50",
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

      {skSuggestion && (
        <div className="mt-2">
          <SmartKeyboardBanner
            suggestion={skSuggestion.text}
            confidence={skSuggestion.confidence}
            direction={skSuggestion.direction}
            onAccept={acceptSkSuggestion}
            onDismiss={dismissSkSuggestion}
          />
        </div>
      )}
    </div>
  );
}
