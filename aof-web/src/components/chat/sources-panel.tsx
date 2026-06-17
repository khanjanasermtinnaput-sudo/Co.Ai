"use client";

import { useState } from "react";
import { Globe, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUtc, type SourcesNotice } from "@/lib/errors";

/**
 * Citation block for replies grounded on Universal Search. Shows the sources the
 * model consulted, which provider served them, and when they were retrieved —
 * the transparency contract from spec §1 ("Sources Used · Retrieved At · Provider").
 */
export function SourcesPanel({ notice }: { notice: SourcesNotice }) {
  const [open, setOpen] = useState(false);
  if (!notice.sources?.length) return null;

  let host = "";
  return (
    <div className="rounded-xl border border-primary/15 bg-primary/[0.04] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:text-foreground"
      >
        <Globe className="size-3.5 text-primary/80" />
        <span className="font-medium text-foreground">
          {notice.sources.length} source{notice.sources.length === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground/70">· via {notice.provider}</span>
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-primary/10 px-3 py-2.5">
          <ol className="space-y-1.5">
            {notice.sources.map((s, i) => {
              try {
                host = new URL(s.url).hostname.replace(/^www\./, "");
              } catch {
                host = s.source;
              }
              return (
                <li key={`${s.url}-${i}`} className="flex gap-2">
                  <span className="mt-0.5 text-primary/70">[{i + 1}]</span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group min-w-0 flex-1"
                  >
                    <span className="flex items-center gap-1 font-medium text-foreground group-hover:text-primary">
                      <span className="truncate">{s.title}</span>
                      <ExternalLink className="size-3 shrink-0 opacity-50" />
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground/70">{host}</span>
                  </a>
                </li>
              );
            })}
          </ol>
          <p className="pt-1 text-[10px] text-muted-foreground/60">
            Retrieved {formatUtc(notice.retrievedAt)} · {notice.provider}
          </p>
        </div>
      )}
    </div>
  );
}
