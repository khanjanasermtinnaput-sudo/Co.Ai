"use client";

// ── Live Preview (Phase 9 + 10) ────────────────────────────────────────────────
// Split-screen Chat | Preview. Sandboxed iframe with console relay.
// Auto-refreshes when file content changes. Supports HTML/CSS/JS projects.
// Performance: debounced refresh to avoid rebuild thrash.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Eye, Terminal, RotateCcw, ExternalLink, Maximize2,
  Minimize2, SplitSquareHorizontal, Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

// Console relay injected into the preview iframe
const RELAY = `<script>(function(){function s(l,a){try{parent.postMessage({src:"ccp",level:l,text:Array.from(a).map(function(x){try{return typeof x==="object"?JSON.stringify(x):String(x);}catch(e){return String(x);}}).join(" ")},"*");}catch(e){}}["log","info","warn","error"].forEach(function(m){var o=console[m];console[m]=function(){s(m,arguments);o&&o.apply(console,arguments);};});window.onerror=function(m,f,l){s("error",[m+(f?" ("+f+":"+l+")":"")]);};window.onunhandledrejection=function(e){s("error",["Unhandled: "+(e.reason?.message||e.reason)]);};})();<\/script>`;

type LogLevel = "log" | "info" | "warn" | "error";
interface ConsoleEntry { id: number; level: LogLevel; text: string }

// ── HTML assembler ────────────────────────────────────────────────────────────

function buildPreviewHtml(files: Array<{ path: string; content: string }>): string | null {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));

  // Find HTML entry
  const htmlFile = files.find((f) =>
    f.path === "index.html" || f.path === "public/index.html" || f.path.endsWith("/index.html"),
  );

  if (!htmlFile) {
    // Try to build from generated files if AI produced code blocks
    const htmlContent = files.find((f) => f.path.endsWith(".html"))?.content;
    if (!htmlContent) return null;
    return injectRelay(inlineSources(htmlContent, fileMap));
  }

  return injectRelay(inlineSources(htmlFile.content, fileMap));
}

function inlineSources(html: string, files: Map<string, string>): string {
  // Inline local <script src="..."> and <link rel="stylesheet" href="...">
  let result = html;
  result = result.replace(/<script\s+src=["']([^"']+)["'][^>]*><\/script>/gi, (_, src) => {
    if (src.startsWith("http")) return _;
    const content = files.get(src) ?? files.get(src.replace(/^\.\//, ""));
    return content ? `<script>${content}<\/script>` : _;
  });
  result = result.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi, (_, href) => {
    if (href.startsWith("http")) return _;
    const content = files.get(href) ?? files.get(href.replace(/^\.\//, ""));
    return content ? `<style>${content}</style>` : _;
  });
  return result;
}

function injectRelay(html: string): string {
  if (html.includes("<head>")) return html.replace("<head>", `<head>${RELAY}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}${RELAY}`);
  return RELAY + html;
}

// ── Debounce helper ───────────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delay: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

// ── Main component ────────────────────────────────────────────────────────────

interface LivePreviewProps {
  className?: string;
  splitMode?: boolean;
}

export function LivePreview({ className, splitMode = false }: LivePreviewProps) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const [tab, setTab] = useState<"preview" | "console">("preview");
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const logId = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  // Debounce by 800ms so rapid typing doesn't thrash iframe
  const debouncedFiles = useDebouncedValue(allFiles, 800);

  const html = useMemo(() => {
    if (!debouncedFiles.length) return null;
    try {
      return buildPreviewHtml(debouncedFiles);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce is a manual refresh trigger, not read in the callback
  }, [debouncedFiles, nonce]);

  // Console relay from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data as { src?: string; level?: LogLevel; text?: string } | null;
      if (!d || d.src !== "ccp") return;
      setLogs((p) => [
        ...p.slice(-499),
        { id: logId.current++, level: d.level ?? "log", text: String(d.text ?? "") },
      ]);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Auto-scroll console
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [logs]);

  const errorCount = logs.filter((l) => l.level === "error").length;

  const openInTab = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [html]);

  const LEVEL_STYLE: Record<LogLevel, string> = {
    log: "text-slate-300",
    info: "text-sky-400",
    warn: "text-amber-400",
    error: "text-red-400",
  };

  if (!html) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 p-6 text-center", className)}>
        <Monitor className="size-10 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium">Live Preview</p>
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            Load a project with an <code>index.html</code> to see a live preview. Changes update automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-background",
        fullscreen && "fixed inset-0 z-50",
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-border/70 bg-card/30 px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-secondary/30 p-0.5">
          <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>
            <Eye className="size-3" /> Preview
          </TabBtn>
          <TabBtn active={tab === "console"} onClick={() => setTab("console")}>
            <Terminal className="size-3" />
            Console
            {logs.length > 0 && (
              <span className={cn(
                "rounded-full px-1 text-[9px] font-semibold",
                errorCount > 0 ? "bg-red-500/20 text-red-400" : "bg-primary/20 text-primary",
              )}>
                {errorCount > 0 ? errorCount : logs.length}
              </span>
            )}
          </TabBtn>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => setNonce((n) => n + 1)} title="Reload">
            <RotateCcw className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={openInTab} title="Open in new tab">
            <ExternalLink className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setFullscreen((f) => !f)}>
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Preview / Console */}
      {tab === "preview" ? (
        <iframe
          key={nonce}
          title="Live preview"
          srcDoc={html}
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
          className="min-h-0 flex-1 w-full border-0 bg-white"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#0b0b0b] p-2 font-mono text-[11px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted-foreground/50">Console · {logs.length}</span>
            <button
              type="button"
              onClick={() => setLogs([])}
              className="text-muted-foreground/40 hover:text-foreground"
            >
              Clear
            </button>
          </div>
          {logs.length === 0 && (
            <p className="text-muted-foreground/40">No output yet.</p>
          )}
          {logs.map((l) => (
            <div key={l.id} className={cn("whitespace-pre-wrap break-all py-0.5 leading-relaxed", LEVEL_STYLE[l.level])}>
              <span className="mr-2 text-muted-foreground/30 select-none">{l.level === "error" ? "✕" : "›"}</span>
              {l.text}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
