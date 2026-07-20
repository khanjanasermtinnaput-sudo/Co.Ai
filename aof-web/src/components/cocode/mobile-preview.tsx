"use client";

// ── Mobile Preview (Phase 39) ─────────────────────────────────────────────────
// Real device-frame previews for iOS and Android at native resolutions.
// Renders the live preview content inside device shells.
// Supports orientation toggle, dark mode, and zoomed/actual-size view.

import { useState, useMemo } from "react";
import { Smartphone, RotateCcw, Moon, Sun, Maximize2, Minimize2, ServerCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { buildPreview } from "@/lib/cocode/preview-runtime";
import { Button } from "@/components/ui/button";

interface DeviceSpec {
  id: string;
  name: string;
  width: number;
  height: number;
  pixelRatio: number;
  os: "ios" | "android";
  borderRadius: number;
}

const DEVICES: DeviceSpec[] = [
  { id: "iphone-15-pro", name: "iPhone 15 Pro", width: 393, height: 852, pixelRatio: 3, os: "ios", borderRadius: 47 },
  { id: "iphone-se", name: "iPhone SE", width: 375, height: 667, pixelRatio: 2, os: "ios", borderRadius: 40 },
  { id: "pixel-8", name: "Pixel 8", width: 412, height: 915, pixelRatio: 2.625, os: "android", borderRadius: 40 },
  { id: "galaxy-s24", name: "Galaxy S24", width: 360, height: 780, pixelRatio: 3, os: "android", borderRadius: 44 },
];

export function MobilePreview({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const [selectedDevice, setSelectedDevice] = useState<string>("iphone-15-pro");
  const [landscape, setLandscape] = useState(false);
  const [dark, setDark] = useState(false);
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");

  const device = DEVICES.find((d) => d.id === selectedDevice) ?? DEVICES[0];

  const previewWidth = landscape ? device.height : device.width;
  const previewHeight = landscape ? device.width : device.height;

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);
  const preview = useMemo(() => {
    try { return buildPreview(allFiles); } catch { return { kind: "empty" as const, html: null }; }
  }, [allFiles]);
  const html = useMemo(() => {
    if (!preview.html) return null;
    return dark && preview.html.includes("<html")
      ? preview.html.replace(/<html([^>]*)>/, `<html$1 class="dark">`)
      : preview.html;
  }, [preview.html, dark]);
  const srcDoc = html;

  // Scale to fit the panel (max ~320px wide)
  const maxDisplay = 280;
  const scale = zoom === "fit" ? Math.min(maxDisplay / previewWidth, 520 / previewHeight) : 1;

  const displayW = Math.round(previewWidth * scale);
  const displayH = Math.round(previewHeight * scale);

  const notchHeight = device.os === "ios" ? Math.round(44 * scale) : Math.round(28 * scale);

  if (preview.kind === "nextjs") {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-3 p-6 text-center", className)}>
        <ServerCog className="size-10 text-muted-foreground/30" />
        <p className="text-sm font-medium">Next.js needs a dev server</p>
        <p className="max-w-xs text-[12px] text-muted-foreground/60">
          Static HTML and React/Vite apps preview in-browser; Next.js needs <code>next dev</code>, which
          this sandbox can&rsquo;t run.
        </p>
      </div>
    );
  }

  if (!srcDoc) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-3 p-6 text-center", className)}>
        <Smartphone className="size-10 text-muted-foreground/30" />
        <p className="text-sm font-medium">Mobile Preview</p>
        <p className="max-w-xs text-[12px] text-muted-foreground/60">
          Load a project with <code>index.html</code> or a React/Vite app to preview it on a device frame.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Smartphone className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Mobile Preview</span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 px-3 py-2">
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-[11px] outline-none focus:border-primary/40"
        >
          {DEVICES.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setLandscape((l) => !l)}
          title={landscape ? "Switch to Portrait" : "Switch to Landscape"}
          className={cn("rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors", landscape && "text-primary")}
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          title={dark ? "Light mode" : "Dark mode"}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => z === "fit" ? "actual" : "fit")}
          title={zoom === "fit" ? "Actual size" : "Fit to panel"}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {zoom === "fit" ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
        </button>
      </div>

      {/* Device info */}
      <div className="flex items-center justify-center gap-3 border-b border-border/30 py-1.5 text-[10px] text-muted-foreground/50">
        <span>{previewWidth}×{previewHeight}</span>
        <span>@{device.pixelRatio}x</span>
        <span className={cn("rounded px-1 py-0.5", device.os === "ios" ? "text-blue-400" : "text-green-400")}>{device.os === "ios" ? "iOS" : "Android"}</span>
        {landscape && <span className="text-amber-400">Landscape</span>}
      </div>

      {/* Preview */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4">
        <div className="relative shrink-0" style={{ width: displayW, height: displayH }}>
          {/* Device shell */}
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            style={{
              borderRadius: device.borderRadius * scale,
              border: "2px solid rgba(255,255,255,0.12)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 20px 60px rgba(0,0,0,0.5)",
              background: "transparent",
            }}
          />

          {/* Status bar (notch / pill) */}
          <div
            className="absolute top-0 left-1/2 z-20 -translate-x-1/2 pointer-events-none"
            style={{
              width: device.os === "ios" ? Math.round(120 * scale) : Math.round(80 * scale),
              height: notchHeight,
              background: "#000",
              borderRadius: device.os === "ios" ? "0 0 20px 20px" : "0 0 12px 12px",
            }}
          />

          {/* Iframe content */}
          <iframe
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
            className="absolute inset-0 w-full h-full border-0"
            style={{ borderRadius: device.borderRadius * scale }}
            title={`Mobile preview — ${device.name}`}
          />
        </div>
      </div>
    </div>
  );
}
