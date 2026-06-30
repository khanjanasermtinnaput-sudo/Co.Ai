"use client";

// ── Multi Preview Engine (Phase 24) ──────────────────────────────────────────
// Displays the same codebase across multiple device viewports simultaneously.
// All previews receive the same HTML — changes update all at once.

import { useMemo, useState } from "react";
import { Monitor, Tablet, Smartphone, Sun, Moon, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

interface Viewport {
  id: string;
  label: string;
  icon: React.ElementType;
  width: number;
  height: number;
  scale: number;
}

const VIEWPORTS: Viewport[] = [
  { id: "desktop", label: "Desktop", icon: Monitor, width: 1280, height: 800, scale: 0.35 },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 768, height: 1024, scale: 0.42 },
  { id: "mobile", label: "Mobile", icon: Smartphone, width: 390, height: 844, scale: 0.55 },
];

const RELAY = `<script>(function(){function s(l,a){try{parent.postMessage({src:"ccp",level:l,text:Array.from(a).map(function(x){try{return typeof x==="object"?JSON.stringify(x):String(x);}catch(e){return String(x);}}).join(" ")},"*");}catch(e){}}["log","warn","error"].forEach(function(m){var o=console[m];console[m]=function(){s(m,arguments);o&&o.apply(console,arguments);};});})();<\/script>`;

function buildHtml(files: Array<{ path: string; content: string }>): string | null {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));
  const html = files.find((f) => f.path === "index.html" || f.path.endsWith("/index.html"))?.content;
  if (!html) return null;

  let result = html
    .replace(/<script\s+src=["']([^"']+)["'][^>]*><\/script>/gi, (_, src) => {
      if (src.startsWith("http")) return _;
      const content = fileMap.get(src) ?? fileMap.get(src.replace(/^\.\//, ""));
      return content ? `<script>${content}<\/script>` : _;
    })
    .replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi, (_, href) => {
      if (href.startsWith("http")) return _;
      const content = fileMap.get(href) ?? fileMap.get(href.replace(/^\.\//, ""));
      return content ? `<style>${content}</style>` : _;
    });

  if (result.includes("<head>")) return result.replace("<head>", `<head>${RELAY}`);
  return RELAY + result;
}

export function MultiPreview({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const [darkMode, setDarkMode] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [activeViewports, setActiveViewports] = useState<Set<string>>(
    new Set(["desktop", "tablet", "mobile"]),
  );

  const allFiles = useMemo(
    () => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })),
    [fs],
  );

  const html = useMemo(() => {
    if (!allFiles.length) return null;
    try { return buildHtml(allFiles); } catch { return null; }
  }, [allFiles]);

  const finalHtml = useMemo(() => {
    if (!html) return null;
    if (darkMode) {
      return html.includes("<html")
        ? html.replace(/<html([^>]*)>/, `<html$1 class="dark">`)
        : `<html class="dark">${html}</html>`;
    }
    return html;
  }, [html, darkMode]);

  function toggleViewport(id: string) {
    setActiveViewports((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  }

  const visibleViewports = VIEWPORTS.filter((v) => activeViewports.has(v.id));

  if (!finalHtml) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 p-6 text-center", className)}>
        <Monitor className="size-10 text-muted-foreground/30" />
        <p className="text-sm font-medium">Multi-Device Preview</p>
        <p className="text-[12px] text-muted-foreground/60">
          Load a project with <code>index.html</code> to preview across devices simultaneously.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-card/30 px-3 py-1.5">
        <div className="flex items-center gap-0.5">
          {VIEWPORTS.map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggleViewport(v.id)}
                title={v.label}
                className={cn(
                  "rounded p-1.5 transition-colors",
                  activeViewports.has(v.id) ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground"
          >
            {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Button size="icon-sm" variant="ghost" onClick={() => setNonce((n) => n + 1)} title="Reload all">
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Previews */}
      <div className="min-h-0 flex-1 overflow-auto bg-[#0d0d14] p-4">
        <div className={cn(
          "flex gap-6",
          visibleViewports.length === 1 ? "justify-center" : "justify-start",
        )}>
          {visibleViewports.map((vp) => {
            const Icon = vp.icon;
            return (
              <div key={vp.id} className="flex shrink-0 flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                  <Icon className="size-3" />
                  <span>{vp.label}</span>
                  <span>· {vp.width}×{vp.height}</span>
                </div>
                <div
                  className="overflow-hidden rounded-xl border border-border/50 bg-white shadow-2xl"
                  style={{
                    width: vp.width * vp.scale,
                    height: vp.height * vp.scale,
                  }}
                >
                  <iframe
                    key={`${nonce}-${vp.id}`}
                    title={`${vp.label} preview`}
                    srcDoc={finalHtml}
                    sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
                    style={{
                      width: vp.width,
                      height: vp.height,
                      transform: `scale(${vp.scale})`,
                      transformOrigin: "top left",
                      border: "none",
                      background: "white",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
