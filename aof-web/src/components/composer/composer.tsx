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
        "group glass border border-border transition-all duration-200 dark:border-foreground/10",
        "focus-within:border-foreground/20",
        size === "lg"
          ? "rounded-3xl p-4 shadow-glass focus-within:shadow-neo"
          : "rounded-2xl p-3 shadow-glass focus-within:shadow-neo",
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
              className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-neo-inset transition-colors hover:text-foreground"
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
          onChange={(e) => setValue(e.target.value)}
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
            className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground shadow-neo-sm transition-all hover:shadow-neo active:shadow-neo-inset"
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
                ? "bg-primary text-primary-foreground shadow-neo-sm hover:shadow-neo active:shadow-neo-inset active:scale-95"
                : "cursor-not-allowed bg-secondary text-muted-foreground/50 shadow-neo-inset",
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
