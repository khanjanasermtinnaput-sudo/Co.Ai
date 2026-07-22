"use client";

// ── Multi Preview Engine (Phase 24) ──────────────────────────────────────────
// Displays the same codebase across multiple device viewports simultaneously.
// All previews receive the same HTML — changes update all at once.

import { useMemo, useState } from "react";
import { Monitor, Tablet, Smartphone, Sun, Moon, RotateCcw, ServerCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { buildPreview } from "@/lib/cocode/preview-runtime";

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

  const preview = useMemo(() => {
    try { return buildPreview(allFiles); } catch { return { kind: "empty" as const, html: null }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce is a manual refresh trigger, not read in the callback
  }, [allFiles, nonce]);
  const html = preview.html;

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

  if (preview.kind === "nextjs") {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 p-6 text-center", className)}>
        <ServerCog className="size-10 text-muted-foreground/30" />
        <p className="text-sm font-medium">Next.js needs a dev server</p>
        <p className="max-w-xs text-[12px] text-muted-foreground/60">
          Static HTML and React/Vite apps preview in-browser; Next.js needs <code>next dev</code>, which
          this sandbox can&rsquo;t run. Use Deploy to see it live.
        </p>
      </div>
    );
  }

  if (!finalHtml) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 p-6 text-center", className)}>
        <Monitor className="size-10 text-muted-foreground/30" />
        <p className="text-sm font-medium">Multi-Device Preview</p>
        <p className="text-[12px] text-muted-foreground/60">
          Load a project with <code>index.html</code> or a React/Vite app to preview across devices simultaneously.
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
      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
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
