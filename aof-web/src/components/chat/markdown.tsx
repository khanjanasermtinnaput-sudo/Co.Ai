import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free markdown renderer scoped to what Aof produces:
 * headings, bold, inline code, fenced code blocks, ordered/unordered lists,
 * and paragraphs. Safe by construction — we never use dangerouslySetInnerHTML.
 */

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  // Split on inline code first, then handle bold inside the rest.
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyBase}-c${i}`}
          className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[0.85em] text-primary/90"
        >
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    const bold = part.split(/(\*\*[^*]+\*\*)/g);
    bold.forEach((seg, j) => {
      if (seg.startsWith("**") && seg.endsWith("**")) {
        nodes.push(
          <strong key={`${keyBase}-b${i}-${j}`} className="font-semibold text-foreground">
            {seg.slice(2, -2)}
          </strong>,
        );
      } else if (seg) {
        nodes.push(<React.Fragment key={`${keyBase}-t${i}-${j}`}>{seg}</React.Fragment>);
      }
    });
  });
  return nodes;
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const blocks = React.useMemo(() => content.split(/\n{2,}/), [content]);

  return (
    <div className={cn("space-y-3 text-[15px] leading-relaxed text-foreground/90", className)}>
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Fenced code block
        if (trimmed.startsWith("```")) {
          const body = trimmed.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "");
          return (
            <pre
              key={bi}
              className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[13px] leading-relaxed text-foreground/90"
            >
              <code>{body}</code>
            </pre>
          );
        }

        // Headings
        const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (heading) {
          const level = heading[1].length;
          const sizes = ["text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold"];
          return (
            <p key={bi} className={cn("text-foreground", sizes[level - 1])}>
              {renderInline(heading[2], `h${bi}`)}
            </p>
          );
        }

        const lines = trimmed.split("\n");

        // Ordered list
        if (lines.every((l) => /^\d+\.\s+/.test(l.trim()))) {
          return (
            <ol key={bi} className="ml-1 space-y-1.5">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2.5">
                  <span className="mt-0.5 font-mono text-xs text-primary">{li + 1}.</span>
                  <span>{renderInline(l.replace(/^\d+\.\s+/, ""), `ol${bi}-${li}`)}</span>
                </li>
              ))}
            </ol>
          );
        }

        // Unordered list
        if (lines.every((l) => /^[-•*]\s+/.test(l.trim()))) {
          return (
            <ul key={bi} className="ml-1 space-y-1.5">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2.5">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span>{renderInline(l.replace(/^[-•*]\s+/, ""), `ul${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        // Paragraph (preserve single line breaks)
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <React.Fragment key={li}>
                {renderInline(l, `p${bi}-${li}`)}
                {li < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
