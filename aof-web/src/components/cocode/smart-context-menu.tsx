"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Edit2, Search, FlaskConical, MessageSquare, Zap, Star,
  FileText, Copy, Scissors, Clipboard, RefreshCw, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { IDEPanel } from "@/store/cocode-ide-store";

interface ContextMenuItem {
  id: string;
  label: string;
  icon: React.ElementType;
  action: () => void;
  shortcut?: string;
  divider?: boolean;
}

type ContextTarget = "function" | "component" | "variable" | "generic";

function detectTarget(text: string): ContextTarget {
  if (!text) return "generic";
  if (/function\s+\w+|=>\s*[\{(]|async\s+function/.test(text)) return "function";
  if (/^[A-Z]\w+/.test(text.trim()) && text.includes("(")) return "component";
  if (/^[a-z_$][a-zA-Z0-9_$]*$/.test(text.trim())) return "variable";
  return "generic";
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSmartContextMenu() {
  const [state, setState] = useState<{
    position: { x: number; y: number } | null;
    selection: string;
  }>({ position: null, selection: "" });

  const close = useCallback(() => setState((s) => ({ ...s, position: null })), []);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      // Skip Monaco's internal context menu area
      const target = e.target as HTMLElement;
      if (target.closest(".monaco-editor")) return;

      const sel = window.getSelection()?.toString().trim() ?? "";
      setState({ position: { x: e.clientX, y: e.clientY }, selection: sel });
      e.preventDefault();
    };
    const onClickAway = () => close();

    document.addEventListener("contextmenu", onContext);
    document.addEventListener("click", onClickAway);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("click", onClickAway);
    };
  }, [close]);

  return { ...state, close };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SmartContextMenuProps {
  position: { x: number; y: number } | null;
  selection: string;
  onClose: () => void;
  onSendToChat: (text: string) => void;
}

export function SmartContextMenu({
  position,
  selection,
  onClose,
  onSendToChat,
}: SmartContextMenuProps) {
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);

  if (!position) return null;

  const target = detectTarget(selection);
  const has = !!selection;

  const openPanel = (id: IDEPanel) => { setRightPanel(id); onClose(); };

  const functionItems: ContextMenuItem[] = [
    { id: "rename",   label: "Rename Symbol",    icon: Edit2,          shortcut: "F2",       action: onClose },
    { id: "refs",     label: "Find References",  icon: Search,         shortcut: "Shift+F12", action: onClose },
    { id: "extract",  label: "Extract Function", icon: Scissors,                              action: () => { openPanel("explorer"); } },
    { id: "tests",    label: "Generate Tests",   icon: FlaskConical,                          action: () => { has && onSendToChat(`Generate tests for:\n\`\`\`\n${selection}\n\`\`\``); openPanel("tests"); } },
    { id: "explain",  label: "Explain Code",     icon: MessageSquare,                         action: () => { has && onSendToChat(`Explain this code:\n\`\`\`\n${selection}\n\`\`\``); onClose(); } },
    { id: "optimize", label: "Optimize",         icon: Zap,                                   action: () => { has && onSendToChat(`Optimize this code:\n\`\`\`\n${selection}\n\`\`\``); onClose(); } },
    { id: "review",   label: "AI Review",        icon: Star,                                  action: () => openPanel("review") },
    { id: "docs",     label: "Generate Docs",    icon: FileText,                              action: () => openPanel("docs") },
  ];

  const componentItems: ContextMenuItem[] = [
    { id: "preview",  label: "Open Preview",     icon: Eye,                                   action: () => openPanel("preview") },
    { id: "rename",   label: "Rename",           icon: Edit2,          shortcut: "F2",       action: onClose },
    { id: "refactor", label: "Refactor",         icon: RefreshCw,                             action: () => openPanel("explorer") },
    { id: "docs",     label: "Create Docs",      icon: FileText,                              action: () => openPanel("docs") },
    { id: "tests",    label: "Generate Tests",   icon: FlaskConical,                          action: () => { has && onSendToChat(`Generate tests for:\n\`\`\`\n${selection}\n\`\`\``); openPanel("tests"); } },
  ];

  const genericItems: ContextMenuItem[] = [
    { id: "copy",    label: "Copy",              icon: Copy,           shortcut: "Ctrl+C",   action: () => { document.execCommand("copy"); onClose(); } },
    { id: "cut",     label: "Cut",               icon: Scissors,       shortcut: "Ctrl+X",   action: () => { document.execCommand("cut");  onClose(); } },
    { id: "paste",   label: "Paste",             icon: Clipboard,      shortcut: "Ctrl+V",   action: () => { document.execCommand("paste"); onClose(); } },
    ...(has ? [
      { id: "explain", label: "Explain Selection", icon: MessageSquare, action: () => { onSendToChat(`Explain:\n\`\`\`\n${selection}\n\`\`\``); onClose(); } },
      { id: "review",  label: "AI Review",         icon: Star,          action: () => openPanel("review") },
    ] : []),
  ];

  const items =
    target === "function"  ? functionItems  :
    target === "component" ? componentItems :
    genericItems;

  const vp = { w: window.innerWidth, h: window.innerHeight };
  const menuH = items.length * 34 + 16;
  const x = Math.min(position.x, vp.w - 200);
  const y = Math.min(position.y, vp.h - menuH);

  return (
    <div
      className="fixed z-[400] min-w-[190px] overflow-hidden rounded-xl border border-border/70 bg-card/98 py-1.5 shadow-2xl backdrop-blur-xl"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {target !== "generic" && (
        <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
          {target}
        </div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px]",
              "text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
            )}
            onClick={item.action}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="shrink-0 text-[10px] text-muted-foreground/40">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
