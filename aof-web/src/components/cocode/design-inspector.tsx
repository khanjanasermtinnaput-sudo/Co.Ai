"use client";

// ── Live Design Inspector (Phase 23) ─────────────────────────────────────────
// AI-first DevTools: inspect spacing, typography, color, border, shadow,
// responsive breakpoints, accessibility, and animations.
// All changes produce a Git Diff — never edit files directly.

import { useState } from "react";
import {
  Ruler, Type, Palette, Box, Layers, Monitor, Accessibility,
  Play, ChevronDown, Loader2, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";

type InspectorTab = "spacing" | "typography" | "color" | "border" | "shadow" | "responsive" | "a11y" | "animation";

const TABS: Array<{ id: InspectorTab; icon: React.ElementType; label: string }> = [
  { id: "spacing", icon: Ruler, label: "Spacing" },
  { id: "typography", icon: Type, label: "Type" },
  { id: "color", icon: Palette, label: "Color" },
  { id: "border", icon: Box, label: "Border" },
  { id: "shadow", icon: Layers, label: "Shadow" },
  { id: "responsive", icon: Monitor, label: "Responsive" },
  { id: "a11y", icon: Accessibility, label: "A11y" },
  { id: "animation", icon: Play, label: "Motion" },
];

interface StyleValue {
  property: string;
  value: string;
  tailwindEquivalent: string | null;
}

const SPACING_SCALE = ["0", "1", "2", "4", "6", "8", "10", "12", "16", "20", "24", "32", "40", "48"];
const FONT_SIZES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl"];
const FONT_WEIGHTS = ["font-thin", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold", "font-extrabold"];
const COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#10b981", "#06b6d4",
  "#f59e0b", "#ef4444", "#64748b", "#ffffff", "#0f172a",
];
const SHADOWS = ["shadow-none", "shadow-sm", "shadow", "shadow-md", "shadow-lg", "shadow-xl", "shadow-2xl"];
const BORDER_RADIUS = ["rounded-none", "rounded-sm", "rounded", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-full"];
const BREAKPOINTS = [
  { label: "Mobile", width: 375, icon: "📱" },
  { label: "Tablet", width: 768, icon: "📲" },
  { label: "Laptop", width: 1280, icon: "💻" },
  { label: "Desktop", width: 1920, icon: "🖥️" },
];

export function DesignInspector({ className }: { className?: string }) {
  const [tab, setTab] = useState<InspectorTab>("spacing");
  const [generating, setGenerating] = useState(false);
  const [pendingChange, setPendingChange] = useState<StyleValue | null>(null);
  const activeFile = useCocodeIDEStore((s) => s.activeFile());
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);

  async function generateDiffForChange(property: string, value: string, twClass: string | null) {
    if (!activeFile) return;
    setGenerating(true);
    setPendingChange({ property, value, tailwindEquivalent: twClass });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Generate a unified git diff to change the CSS property "${property}" to "${value}"${twClass ? ` (Tailwind: ${twClass})` : ""} in the active component. File: ${activeFile.path}\n\`\`\`\n${activeFile.content.slice(0, 3000)}\n\`\`\`\nOnly output the diff.`,
          history: [],
          agent: "cocode",
          route: "refactor",
        }),
      });

      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
      }

      const { extractDiffs } = await import("@/lib/cocode/diff");
      const diffs = extractDiffs(full);
      if (diffs.length) {
        setDiff(diffs[0]);
        setRightPanel("diff");
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Tab strip */}
      <div className="flex overflow-x-auto border-b border-border/70 bg-card/30 no-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium transition-colors",
                tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {!activeFile ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/50">
          Open a file to inspect
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {generating && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-[12px] text-primary">
              <Loader2 className="size-3.5 animate-spin" />
              Generating diff for {pendingChange?.property}…
            </div>
          )}

          {tab === "spacing" && (
            <SpacingPanel onChange={generateDiffForChange} />
          )}
          {tab === "typography" && (
            <TypographyPanel onChange={generateDiffForChange} />
          )}
          {tab === "color" && (
            <ColorPanel onChange={generateDiffForChange} />
          )}
          {tab === "border" && (
            <BorderPanel onChange={generateDiffForChange} />
          )}
          {tab === "shadow" && (
            <ShadowPanel onChange={generateDiffForChange} />
          )}
          {tab === "responsive" && (
            <ResponsivePanel />
          )}
          {tab === "a11y" && (
            <A11yPanel file={activeFile} />
          )}
          {tab === "animation" && (
            <AnimationPanel onChange={generateDiffForChange} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-panels ────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
      {children}
    </p>
  );
}

type OnChange = (property: string, value: string, tw: string | null) => void;

function SpacingPanel({ onChange }: { onChange: OnChange }) {
  return (
    <div className="space-y-4">
      <SectionLabel>Padding</SectionLabel>
      <div className="grid grid-cols-7 gap-1">
        {SPACING_SCALE.map((s) => (
          <button key={s} type="button" onClick={() => onChange("padding", `${parseInt(s) * 4}px`, `p-${s}`)}
            className="rounded border border-border/50 bg-secondary/30 px-1 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
            {s}
          </button>
        ))}
      </div>
      <SectionLabel>Margin</SectionLabel>
      <div className="grid grid-cols-7 gap-1">
        {SPACING_SCALE.map((s) => (
          <button key={s} type="button" onClick={() => onChange("margin", `${parseInt(s) * 4}px`, `m-${s}`)}
            className="rounded border border-border/50 bg-secondary/30 px-1 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
            {s}
          </button>
        ))}
      </div>
      <SectionLabel>Gap</SectionLabel>
      <div className="grid grid-cols-7 gap-1">
        {SPACING_SCALE.slice(0, 10).map((s) => (
          <button key={s} type="button" onClick={() => onChange("gap", `${parseInt(s) * 4}px`, `gap-${s}`)}
            className="rounded border border-border/50 bg-secondary/30 px-1 py-1 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypographyPanel({ onChange }: { onChange: OnChange }) {
  return (
    <div className="space-y-4">
      <SectionLabel>Font Size</SectionLabel>
      <div className="space-y-1">
        {FONT_SIZES.map((cls) => (
          <button key={cls} type="button" onClick={() => onChange("font-size", cls.replace("text-", ""), cls)}
            className="block w-full rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-white/5 hover:text-foreground">
            <span className={cn(cls)}>{cls}</span>
          </button>
        ))}
      </div>
      <SectionLabel>Font Weight</SectionLabel>
      <div className="space-y-1">
        {FONT_WEIGHTS.map((cls) => (
          <button key={cls} type="button" onClick={() => onChange("font-weight", cls.replace("font-", ""), cls)}
            className="block w-full rounded px-2 py-1 text-left text-muted-foreground hover:bg-white/5 hover:text-foreground">
            <span className={cn(cls, "text-sm")}>{cls}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorPanel({ onChange }: { onChange: OnChange }) {
  const [custom, setCustom] = useState("#3b82f6");
  return (
    <div className="space-y-4">
      <SectionLabel>Preset Colors</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => onChange("color", c, null)}
            title={c}
            className="size-7 rounded-full border border-border/50 hover:scale-110 transition-transform"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <SectionLabel>Custom Color</SectionLabel>
      <div className="flex gap-2">
        <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded border border-border/50 bg-transparent" />
        <Button size="sm" variant="secondary" onClick={() => onChange("color", custom, null)}>
          <Wand2 className="size-3.5" /> Apply
        </Button>
      </div>
    </div>
  );
}

function BorderPanel({ onChange }: { onChange: OnChange }) {
  return (
    <div className="space-y-4">
      <SectionLabel>Border Radius</SectionLabel>
      <div className="grid grid-cols-2 gap-1.5">
        {BORDER_RADIUS.map((cls) => (
          <button key={cls} type="button" onClick={() => onChange("border-radius", cls, cls)}
            className="flex items-center justify-center rounded border border-border/50 bg-secondary/30 px-2 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
            {cls}
          </button>
        ))}
      </div>
      <SectionLabel>Border Width</SectionLabel>
      <div className="flex gap-2">
        {["0", "1", "2", "4", "8"].map((w) => (
          <button key={w} type="button" onClick={() => onChange("border-width", `${w}px`, w === "0" ? "border-0" : `border-${w}`)}
            className="flex-1 rounded border bg-secondary/30 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            style={{ borderWidth: parseInt(w) || 1, borderColor: "currentColor" }}>
            {w}px
          </button>
        ))}
      </div>
    </div>
  );
}

function ShadowPanel({ onChange }: { onChange: OnChange }) {
  return (
    <div className="space-y-2">
      <SectionLabel>Box Shadow</SectionLabel>
      {SHADOWS.map((cls) => (
        <button key={cls} type="button" onClick={() => onChange("box-shadow", cls, cls)}
          className="flex w-full items-center justify-between rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
          <span>{cls}</span>
          <div className={cn("size-8 rounded bg-primary/20", cls)} />
        </button>
      ))}
    </div>
  );
}

function ResponsivePanel() {
  const setPreviewWidth = useCocodeIDEStore((s) => s.setPreviewWidth);
  return (
    <div className="space-y-3">
      <SectionLabel>Preview Width</SectionLabel>
      {BREAKPOINTS.map((bp) => (
        <button key={bp.label} type="button" onClick={() => setPreviewWidth(bp.width)}
          className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5 text-left hover:border-primary/40">
          <span className="text-lg">{bp.icon}</span>
          <div>
            <p className="text-[13px] font-medium">{bp.label}</p>
            <p className="text-[11px] text-muted-foreground/60">{bp.width}px</p>
          </div>
        </button>
      ))}
      <div className="mt-2">
        <SectionLabel>Custom Width</SectionLabel>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="e.g. 1024"
            min={280}
            max={3840}
            className="flex-1 rounded-md border border-border/50 bg-background/30 px-2 py-1.5 text-[12px] outline-none focus:border-primary/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = parseInt((e.target as HTMLInputElement).value);
                if (v >= 280) setPreviewWidth(v);
              }
            }}
          />
          <span className="flex items-center text-[12px] text-muted-foreground/60">px</span>
        </div>
      </div>
    </div>
  );
}

function A11yPanel({ file }: { file: { content: string; path: string } }) {
  const issues: Array<{ severity: "error" | "warning"; message: string }> = [];

  if (/<img\b(?![^>]*\balt\s*=)/i.test(file.content))
    issues.push({ severity: "error", message: "<img> missing alt attribute (WCAG 1.1.1)" });
  if (/<button(?![^>]*\b(?:aria-label|title|>.*?<\/button))/i.test(file.content))
    issues.push({ severity: "warning", message: "Button may lack accessible label" });
  if (/<a\b[^>]*href/i.test(file.content) && !file.content.includes("aria-label"))
    issues.push({ severity: "warning", message: "Links may lack descriptive text (WCAG 2.4.4)" });
  if (/tabIndex=\{?-1\}?/.test(file.content))
    issues.push({ severity: "warning", message: "tabIndex=-1 removes element from tab order" });
  if (issues.length === 0)
    issues.push({ severity: "warning", message: "No obvious accessibility issues detected in static analysis" });

  return (
    <div className="space-y-2">
      <SectionLabel>Accessibility Audit</SectionLabel>
      {issues.map((issue, i) => (
        <div key={i} className={cn(
          "rounded-lg border px-3 py-2.5 text-[12px]",
          issue.severity === "error"
            ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        )}>
          {issue.message}
        </div>
      ))}
    </div>
  );
}

function AnimationPanel({ onChange }: { onChange: OnChange }) {
  const anims = [
    { cls: "animate-none", label: "None" },
    { cls: "animate-spin", label: "Spin" },
    { cls: "animate-ping", label: "Ping" },
    { cls: "animate-pulse", label: "Pulse" },
    { cls: "animate-bounce", label: "Bounce" },
    { cls: "transition-all duration-150", label: "Fast Transition" },
    { cls: "transition-all duration-300", label: "Transition" },
    { cls: "transition-all duration-500", label: "Slow Transition" },
  ];
  return (
    <div className="space-y-2">
      <SectionLabel>Animation</SectionLabel>
      {anims.map((a) => (
        <button key={a.cls} type="button" onClick={() => onChange("animation", a.cls, a.cls)}
          className="flex w-full items-center justify-between rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
          <span>{a.label}</span>
          <div className={cn("size-4 rounded bg-primary", a.cls)} />
        </button>
      ))}
    </div>
  );
}
