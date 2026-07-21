"use client";

import { FileCode2, FileText, ImageIcon, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSize, kindLabel } from "@/lib/attachments";
import type { Attachment, AttachmentKind } from "@/lib/types";

const ICON: Record<AttachmentKind, LucideIcon> = {
  image: ImageIcon,
  code: FileCode2,
  document: FileText,
};

interface Props {
  attachments: Attachment[];
  /** when provided, each chip gets a remove button (composer use). */
  onRemove?: (id: string) => void;
  className?: string;
}

/** Compact chips for attached files, with inline thumbnails for images. */
export function AttachmentList({ attachments, onRemove, className }: Props) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((a) => {
        const Icon = ICON[a.kind];
        return (
          <div
            key={a.id}
            className="group/att flex items-center gap-2 rounded-lg border border-border bg-secondary/50 py-1 pl-1.5 pr-2 text-xs"
          >
            {a.kind === "image" && a.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.dataUrl}
                alt={a.name}
                className="size-7 rounded object-cover"
              />
            ) : (
              <span className="flex size-7 items-center justify-center rounded bg-primary/12 text-primary">
                <Icon className="size-4" />
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="max-w-[140px] truncate font-medium text-foreground">{a.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {kindLabel(a.kind)} · {formatSize(a.size)}
              </span>
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${a.name}`}
                className="ml-0.5 flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
