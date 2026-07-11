"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { PANEL_DEFS } from "@/lib/cocode/adaptive-panels";
import type { IDEPanel } from "@/store/cocode-ide-store";

interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  category: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  developerMode: boolean;
  onToggleDeveloperMode: () => void;
}

export function CommandPalette({
  open,
  onClose,
  developerMode,
  onToggleDeveloperMode,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);
  const setViewMode = useCocodeIDEStore((s) => s.setViewMode);
  const github = useCocodeIDEStore((s) => s.github);

  const commands: Command[] = [
    // Panel commands
    ...Object.values(PANEL_DEFS)
      .filter((def) => !def.devModeOnly || developerMode)
      .map((def) => ({
        id: `panel:${def.id}`,
        label: `Open ${def.label}`,
        description: def.description,
        shortcut: def.shortcut,
        category: "Panels",
        action: () => {
          setViewMode("editor");
          setRightPanel(def.id as IDEPanel);
          onClose();
        },
      })),
    // Workspace actions
    {
      id: "action:dev-mode",
      label: developerMode ? "Disable Developer Mode" : "Enable Developer Mode",
      description: "Show or hide advanced AI engineering tools",
      shortcut: "Ctrl+Shift+`",
      category: "Workspace",
      action: () => {
        onToggleDeveloperMode();
        onClose();
      },
    },
    {
      id: "action:close-panel",
      label: "Close Active Panel",
      description: "Close the currently open right panel",
      shortcut: "Escape",
      category: "Workspace",
      action: () => {
        setRightPanel(null);
        onClose();
      },
    },
    // Git actions — only if connected
    ...(github.connected
      ? [
          {
            id: "git:commit",
            label: "Commit Changes",
            description: "Commit current changes to GitHub",
            category: "Git",
            action: () => {
              setViewMode("editor");
              setRightPanel("github");
              onClose();
            },
          },
          {
            id: "git:pr",
            label: "Open Pull Request",
            description: "Create a pull request on GitHub",
            category: "Git",
            action: () => {
              setViewMode("editor");
              setRightPanel("github");
              onClose();
            },
          },
          {
            id: "git:branch",
            label: "Switch Branch",
            description: `Current: ${github.repo?.branch ?? "unknown"}`,
            category: "Git",
            action: () => {
              setViewMode("editor");
              setRightPanel("github");
              onClose();
            },
          },
        ]
      : []),
  ];

  const filtered = query.trim()
    ? commands.filter((c) => {
        const q = query.toLowerCase();
        return (
          c.label.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
        );
      })
    : commands;

  // Flat ordered list for keyboard navigation
  const grouped = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    acc[cmd.category] = [...(acc[cmd.category] ?? []), cmd];
    return acc;
  }, {});

  const flatOrdered: Command[] = Object.values(grouped).flat();

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, flatOrdered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        flatOrdered[selectedIdx]?.action();
      }
      if (e.key === "Escape") {
        onClose();
      }
    },
    [flatOrdered, selectedIdx, onClose],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[290] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[14vh] px-4 pointer-events-none">
        <div
          className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-border/70 bg-card/98 shadow-2xl backdrop-blur-2xl pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search header */}
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search commands, panels, actions…"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            <kbd className="shrink-0 rounded border border-border/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              esc
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto py-1.5">
            {Object.entries(grouped).map(([category, cmds]) => (
              <div key={category}>
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  {category}
                </div>
                {cmds.map((cmd) => {
                  const flatIdx = flatOrdered.indexOf(cmd);
                  const isSelected = flatIdx === selectedIdx;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                        isSelected
                          ? "bg-primary/10"
                          : "hover:bg-white/5",
                      )}
                      onMouseEnter={() => setSelectedIdx(flatIdx)}
                      onClick={cmd.action}
                    >
                      <ChevronRight
                        className={cn(
                          "size-3 shrink-0 transition-opacity",
                          isSelected ? "opacity-100 text-primary" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-foreground">
                          {cmd.label}
                        </div>
                        {cmd.description && (
                          <div className="truncate text-[11px] text-muted-foreground/60">
                            {cmd.description}
                          </div>
                        )}
                      </div>
                      {cmd.shortcut && (
                        <kbd className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {flatOrdered.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground/50">
                No commands match &ldquo;{query}&rdquo;
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="flex items-center gap-4 border-t border-border/40 px-4 py-2 text-[10px] text-muted-foreground/40">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> select</span>
            <span><kbd className="font-mono">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </>
  );
}
