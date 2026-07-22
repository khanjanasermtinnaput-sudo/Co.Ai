"use client";

// ── Global Command Palette ────────────────────────────────────────────────────
// One palette for the whole app (⌘K / Ctrl+Shift+P). Commands are contextual:
// navigation + theme everywhere; CoCode panel/git commands only inside the
// Code area, so no entry ever points at something that can't run from here.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Search, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV } from "@/lib/constants";
import { isCoCodeArea } from "@/components/layout/sidebar";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";
import { useCocodeIDEStore, type IDEPanel } from "@/store/cocode-ide-store";
import { PANEL_DEFS } from "@/lib/cocode/adaptive-panels";

interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  category: string;
  action: () => void;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const developerMode = useUIStore((s) => s.developerMode);
  const toggleDeveloperMode = useUIStore((s) => s.toggleDeveloperMode);

  const router = useRouter();
  const pathname = usePathname();
  const inCodeArea = isCoCodeArea(pathname);
  const { theme, setTheme } = useTheme();

  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);
  const setViewMode = useCocodeIDEStore((s) => s.setViewMode);
  const github = useCocodeIDEStore((s) => s.github);

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const commands: Command[] = useMemo(() => {
    const navigate: Command[] = [
      ...PRIMARY_NAV.map((item) => ({
        id: `nav:${item.key}`,
        label: `Go to ${item.label}`,
        description: item.description,
        category: "Navigate",
        action: () => {
          router.push(item.href);
          close();
        },
      })),
      {
        id: "nav:new-chat",
        label: "New Chat",
        description: "Start a fresh conversation",
        category: "Navigate",
        action: () => {
          useChatStore.getState().selectConversation(null);
          router.push("/");
          close();
        },
      },
    ];

    const appearance: Command[] = [
      {
        id: "theme:toggle",
        label: theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme",
        category: "Appearance",
        action: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          close();
        },
      },
    ];

    const workspace: Command[] = [
      {
        id: "action:dev-mode",
        label: developerMode ? "Disable Developer Mode" : "Enable Developer Mode",
        description: "Show or hide developer tooling across Co.AI",
        shortcut: "Ctrl+Shift+`",
        category: "Workspace",
        action: () => {
          toggleDeveloperMode();
          close();
        },
      },
    ];

    // CoCode commands only make sense inside the Code area.
    const code: Command[] = inCodeArea
      ? [
          ...Object.values(PANEL_DEFS)
            .filter((def) => !def.devModeOnly || developerMode)
            .map((def) => ({
              id: `panel:${def.id}`,
              label: `Open ${def.label}`,
              description: def.description,
              shortcut: def.shortcut,
              category: def.group,
              action: () => {
                setViewMode("editor");
                setRightPanel(def.id as IDEPanel);
                close();
              },
            })),
          {
            id: "action:close-panel",
            label: "Close Active Panel",
            description: "Close the currently open right panel",
            shortcut: "Escape",
            category: "Workspace",
            action: () => {
              setRightPanel(null);
              close();
            },
          },
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
                    close();
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
                    close();
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
                    close();
                  },
                },
              ]
            : []),
        ]
      : [];

    return [...navigate, ...code, ...appearance, ...workspace];
  }, [router, close, theme, setTheme, developerMode, toggleDeveloperMode, inCodeArea, setViewMode, setRightPanel, github]);

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
        close();
      }
    },
    [flatOrdered, selectedIdx, close],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[290] bg-foreground/40 backdrop-blur-sm"
        onClick={close}
      />

      {/* Palette */}
      <div className="fixed inset-0 z-[300] flex items-start justify-center px-4 pt-[14vh] pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="w-full max-w-[560px] overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-2xl pointer-events-auto"
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
              placeholder="Search commands, pages, panels…"
              aria-label="Search commands"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            <kbd className="shrink-0 rounded border border-border/50 px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
              esc
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto py-1.5">
            {Object.entries(grouped).map(([category, cmds]) => (
              <div key={category}>
                <div className="px-4 py-1.5 text-micro font-semibold uppercase tracking-widest text-muted-foreground/50">
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
                        isSelected ? "bg-primary/10" : "hover:bg-foreground/5",
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
                        <div className="text-body-sm font-medium text-foreground">
                          {cmd.label}
                        </div>
                        {cmd.description && (
                          <div className="truncate text-caption text-muted-foreground/60">
                            {cmd.description}
                          </div>
                        )}
                      </div>
                      {cmd.shortcut && (
                        <kbd className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
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
          <div className="flex items-center gap-4 border-t border-border/40 px-4 py-2 text-micro text-muted-foreground/40">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> select</span>
            <span><kbd className="font-mono">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </>
  );
}
