"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

function renderInline(text: string, keyBase: string): React.ReactNode[] {
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

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/code relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
      {/* header bar */}
      <div className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
        <span className="font-mono text-[11px] text-muted-foreground/60">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/50 opacity-0 transition-all hover:text-foreground group-hover/code:opacity-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-foreground/90">
        <code>{body}</code>
      </pre>
    </div>
  );
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
          const langMatch = /^```([a-z0-9]*)/i.exec(trimmed);
          const lang = langMatch?.[1] ?? "";
          const body = trimmed.replace(/^```[a-z0-9]*\n?/i, "").replace(/```$/, "");
          return <CodeBlock key={bi} lang={lang} body={body} />;
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

        // Paragraph
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
