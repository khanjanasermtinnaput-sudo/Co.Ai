"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, ExternalLink, Eye, RotateCcw, Terminal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildProjectHtml, extractGeneratedFiles } from "@/lib/export";
import { canBuildHtml } from "@/lib/project-detect";
import { ExportError } from "@/lib/export-types";

type LogLevel = "log" | "info" | "warn" | "error";
interface ConsoleEntry {
  id: number;
  level: LogLevel;
  text: string;
}

// Injected into the preview document so console output and runtime errors are
// relayed to the parent via postMessage. Sandboxed iframes post with origin
// "null", so the parent filters on the `source` tag instead of the origin.
const RELAY_SCRIPT = `<script>(function(){
  function send(level, parts){try{parent.postMessage({source:"aof-preview",level:level,text:Array.prototype.slice.call(parts).map(function(p){
    try{return typeof p==="object"?JSON.stringify(p):String(p);}catch(e){return String(p);}
  }).join(" ")},"*");}catch(e){}}
  ["log","info","warn","error"].forEach(function(m){var o=console[m];console[m]=function(){send(m,arguments);if(o)o.apply(console,arguments);};});
  window.addEventListener("error",function(e){send("error",[e.message+(e.filename?" ("+e.filename+":"+e.lineno+")":"")]);});
  window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled rejection: "+((e.reason&&e.reason.message)||e.reason)]);});
})();<\/script>`;

/** Insert the console relay as early as possible in the document. */
function instrumentHtml(html: string): string {
  if (html.includes("<head>")) return html.replace("<head>", `<head>${RELAY_SCRIPT}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}${RELAY_SCRIPT}`);
  return RELAY_SCRIPT + html;
}

/** Live in-browser preview of the latest generated project — a self-contained
 *  HTML document rendered in a sandboxed iframe, with a console that captures the
 *  project's logs and runtime errors. */
export function CodePreview({ buildLog, className }: { buildLog: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<"preview" | "console">("preview");
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const logId = useRef(0);

  const files = useMemo(() => extractGeneratedFiles(buildLog), [buildLog]);
  const renderable = canBuildHtml(files);

  const { html, error } = useMemo(() => {
    if (!open) return { html: "", error: null as string | null };
    try {
      return { html: instrumentHtml(buildProjectHtml(files)), error: null };
    } catch (e) {
      const reason =
        e instanceof ExportError
          ? "This project type can't be previewed in the browser (no HTML/CSS/JS)."
          : "Could not build a preview from the generated code.";
      return { html: "", error: reason };
    }
    // nonce forces a rebuild when the user hits Reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, files, nonce]);

  // Collect console output / runtime errors relayed from the sandboxed iframe.
  useEffect(() => {
    if (!open) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; level?: LogLevel; text?: string } | null;
      if (!d || d.source !== "aof-preview") return;
      setLogs((prev) => [
        ...prev.slice(-199),
        { id: logId.current++, level: d.level ?? "log", text: String(d.text ?? "") },
      ]);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open]);

  // Clear the console whenever the preview (re)loads.
  useEffect(() => {
    if (open) setLogs([]);
  }, [open, nonce]);

  const errorCount = logs.filter((l) => l.level === "error").length;

  const openInTab = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className={className}
        onClick={() => setOpen(true)}
        disabled={!renderable}
        title={renderable ? "Preview in browser" : "No previewable HTML/CSS/JS in this project"}
      >
        <Eye className="size-3.5" /> Preview
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-3 p-4">
          <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
            <div className="flex items-center gap-1">
              <DialogTitle className="mr-2">Live Preview</DialogTitle>
              {!error && (
                <div className="flex items-center gap-0.5 rounded-lg border border-border bg-secondary/50 p-0.5">
                  <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
                    <Eye className="size-3.5" /> Preview
                  </TabButton>
                  <TabButton active={tab === "console"} onClick={() => setTab("console")}>
                    <Terminal className="size-3.5" /> Console
                    {logs.length > 0 && (
                      <span
                        className={cn(
                          "ml-1 rounded-full px-1.5 text-[10px] font-semibold",
                          errorCount > 0 ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary",
                        )}
                      >
                        {errorCount > 0 ? errorCount : logs.length}
                      </span>
                    )}
                  </TabButton>
                </div>
              )}
            </div>
            {!error && (
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
                  <RotateCcw className="size-3.5" /> Reload
                </Button>
                <Button size="sm" variant="ghost" onClick={openInTab}>
                  <ExternalLink className="size-3.5" /> Open in tab
                </Button>
              </div>
            )}
          </DialogHeader>

          {error ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/[0.06] px-4 py-3 text-sm">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="text-destructive/90">{error}</span>
            </div>
          ) : (
            <>
              <iframe
                key={nonce}
                title="Project preview"
                srcDoc={html}
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                className={cn(
                  "min-h-0 flex-1 w-full rounded-xl border border-border bg-white",
                  tab !== "preview" && "hidden",
                )}
              />
              {tab === "console" && <ConsolePanel logs={logs} onClear={() => setLogs([])} />}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  log: "text-foreground",
  info: "text-sky-400",
  warn: "text-amber-400",
  error: "text-destructive",
};

function ConsolePanel({ logs, onClear }: { logs: ConsoleEntry[]; onClear: () => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Console · {logs.length}</span>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={!logs.length} className="h-7">
          <Trash2 className="size-3.5" /> Clear
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="px-1 py-2 text-muted-foreground/60">
            No console output yet. Logs and runtime errors from the preview appear here.
          </p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className={cn("whitespace-pre-wrap break-words px-1 py-0.5", LEVEL_STYLE[l.level])}>
              <span className="mr-2 select-none text-muted-foreground/40">{l.level === "error" ? "✕" : "›"}</span>
              {l.text}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
