"use client";

import { useRef, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

export function ConversationItem({
  title,
  updatedAt,
  active,
  searchQuery,
  excerpt,
  onSelect,
  onDelete,
  onRename,
}: {
  title: string;
  updatedAt: string;
  active: boolean;
  searchQuery: string;
  excerpt?: string;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(title);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(title);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      {editing ? (
        <div className="flex flex-1 items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            className="flex-1 rounded border border-primary/40 bg-foreground/5 px-1.5 py-0.5 text-body-sm text-foreground outline-none focus:border-primary/70"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={startEdit}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title="Double-click to rename"
        >
          <MessageSquare className="size-3.5 shrink-0 opacity-60" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm">
              {searchQuery
                ? title.split(new RegExp(`(${searchQuery})`, "gi")).map((part, i) =>
                    part.toLowerCase() === searchQuery.toLowerCase() ? (
                      <mark key={i} className="rounded bg-primary/25 text-foreground not-italic">
                        {part}
                      </mark>
                    ) : (
                      part
                    ),
                  )
                : title}
            </p>
            {excerpt ? (
              <p className="truncate text-caption italic text-muted-foreground/50">{excerpt}</p>
            ) : (
              <p className="text-caption text-muted-foreground/60">{timeAgo(updatedAt)}</p>
            )}
          </div>
        </button>
      )}

      {!editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Delete "${title}"`}
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
