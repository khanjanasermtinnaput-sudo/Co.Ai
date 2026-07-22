"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/code relative overflow-hidden rounded-xl bg-secondary shadow-neo-inset">
      <div className="flex h-8 items-center justify-between border-b border-foreground/[0.06] px-3">
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

const components: Components = {
  // Semantic headings — previously all rendered as <p>
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground">{children}</h3>
  ),

  // Intercept <pre> so the code child takes over rendering
  pre: ({ children }) => <>{children}</>,

  // Inline code vs fenced block code.
  // Block code is identified by: a language class, OR a trailing newline
  // (react-markdown always appends \n to fenced blocks, even when lang is absent).
  code({ className, children }) {
    const lang = /language-(\w+)/.exec(className || "")?.[1] ?? "";
    const isBlock = !!className?.startsWith("language-") || String(children).endsWith("\n");
    if (isBlock) {
      return <CodeBlock lang={lang} body={String(children).replace(/\n$/, "")} />;
    }
    return (
      <code className="rounded bg-foreground/[0.08] px-1.5 py-0.5 font-mono text-[0.85em] text-primary/90">
        {children}
      </code>
    );
  },

  // Lists — native markers styled via Tailwind; no li override needed
  ul: ({ children }) => (
    <ul className="ml-4 list-disc space-y-1.5 marker:text-primary/70">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="ml-4 list-decimal space-y-1.5 marker:font-mono marker:text-xs marker:text-primary/70">{children}</ol>
  ),

  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),

  // GFM table support
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border border-foreground/10">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-foreground/[0.04] text-foreground/70">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-t border-foreground/[0.06] px-3 py-2">{children}</td>
  ),
};

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("space-y-3 break-words [overflow-wrap:anywhere] text-[15px] leading-relaxed text-foreground/90", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
