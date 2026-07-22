"use client";

// ── File Explorer (Phase 5) ───────────────────────────────────────────────────
// Full file tree with: CRUD, drag & drop, search, multi-select, keyboard shortcuts,
// pinned files, recent files, folder collapse, file preview on hover.

import {
  useState, useRef, useCallback, useEffect, memo,
} from "react";
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  Plus, Trash2, Edit2, Search, Pin, X, FilePlus,
  FolderPlus, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import {
  isFile, isDir, flattenFiles,
  type VirtualNode, type VirtualFile, type VirtualDir,
} from "@/lib/cocode/virtual-fs";

// ── File icon by extension ────────────────────────────────────────────────────
function FileIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  const color =
    ext === "ts" || ext === "tsx" ? "text-sky-400" :
    ext === "js" || ext === "jsx" ? "text-yellow-400" :
    ext === "css" || ext === "scss" ? "text-pink-400" :
    ext === "json" ? "text-amber-400" :
    ext === "md" || ext === "mdx" ? "text-slate-300" :
    ext === "py" ? "text-green-400" :
    "text-muted-foreground";
  return <File className={cn("size-3.5 shrink-0", color, className)} />;
}

// ── Tree node component ───────────────────────────────────────────────────────

interface TreeNodeProps {
  node: VirtualNode;
  depth: number;
  selectedPaths: Set<string>;
  onSelect: (path: string, multi?: boolean) => void;
  onExpand: (path: string) => void;
  expandedDirs: Set<string>;
  onContextMenu: (e: React.MouseEvent, node: VirtualNode) => void;
  dragging: string | null;
  onDragStart: (path: string) => void;
  onDrop: (targetPath: string) => void;
  searchQuery: string;
}

const TreeNode = memo(function TreeNode({
  node, depth, selectedPaths, onSelect, onExpand, expandedDirs,
  onContextMenu, dragging, onDragStart, onDrop, searchQuery,
}: TreeNodeProps) {
  const isSelected = selectedPaths.has(node.path);
  const isDraggingOver = dragging !== null && dragging !== node.path;
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const activeTab = useCocodeIDEStore((s) => s.activeTab);
  const isActive = isFile(node) && activeTab === node.path;

  if (isDir(node)) {
    const expanded = expandedDirs.has(node.path) || node.expanded;
    return (
      <div>
        <div
          className={cn(
            "group flex cursor-pointer select-none items-center gap-1 rounded-sm px-2 py-0.5 text-[13px]",
            "hover:bg-foreground/[0.05]",
            isSelected && "bg-primary/10",
            isDraggingOver && "outline outline-1 outline-primary/40",
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onExpand(node.path)}
          onContextMenu={(e) => onContextMenu(e, node)}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={() => onDrop(node.path)}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
          )}
          {expanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-amber-400/80" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-amber-400/80" />
          )}
          <span className="truncate text-muted-foreground group-hover:text-foreground">
            {node.name}
          </span>
        </div>
        {expanded && node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPaths={selectedPaths}
            onSelect={onSelect}
            onExpand={onExpand}
            expandedDirs={expandedDirs}
            onContextMenu={onContextMenu}
            dragging={dragging}
            onDragStart={onDragStart}
            onDrop={onDrop}
            searchQuery={searchQuery}
          />
        ))}
      </div>
    );
  }

  const file = node as VirtualFile;
  const highlight = searchQuery && file.name.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div
      className={cn(
        "group flex cursor-pointer select-none items-center gap-1.5 rounded-sm px-2 py-0.5 text-[13px]",
        "hover:bg-foreground/[0.05]",
        isActive && "bg-primary/15 text-foreground",
        isSelected && !isActive && "bg-foreground/[0.06]",
        highlight && "ring-1 ring-inset ring-primary/30",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      draggable
      onClick={(e) => {
        onSelect(file.path, e.metaKey || e.ctrlKey);
        openTab(file.path);
      }}
      onDragStart={() => onDragStart(file.path)}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      <FileIcon name={file.name} />
      <span className={cn("truncate", isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
        {searchQuery
          ? file.name.split(new RegExp(`(${searchQuery})`, "gi")).map((part, i) =>
              part.toLowerCase() === searchQuery.toLowerCase()
                ? <mark key={i} className="rounded bg-primary/25 text-foreground not-italic">{part}</mark>
                : part,
            )
          : file.name}
      </span>
      {file.dirty && (
        <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-400/80" title="Unsaved" />
      )}
    </div>
  );
});

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  node: VirtualNode;
}

function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const deleteFilePath = useCocodeIDEStore((s) => s.deleteFilePath);
  const createFile = useCocodeIDEStore((s) => s.createFile);
  const renameFilePath = useCocodeIDEStore((s) => s.renameFilePath);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(state.node.name);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const actions = [
    isFile(state.node) && {
      label: "Open",
      icon: <File className="size-3.5" />,
      onClick: () => {
        useCocodeIDEStore.getState().openTab(state.node.path);
        onClose();
      },
    },
    {
      label: "Rename",
      icon: <Edit2 className="size-3.5" />,
      onClick: () => setRenaming(true),
    },
    isDir(state.node) && {
      label: "New File",
      icon: <FilePlus className="size-3.5" />,
      onClick: () => setCreatingFile(true),
    },
    {
      label: "Delete",
      icon: <Trash2 className="size-3.5" />,
      onClick: () => {
        if (isFile(state.node)) deleteFilePath(state.node.path);
        onClose();
      },
      danger: true,
    },
  ].filter(Boolean);

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [onClose]);

  if (renaming) {
    return (
      <div
        className="fixed z-50 rounded-lg border border-border bg-card p-2 shadow-xl"
        style={{ left: state.x, top: state.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const dir = state.node.path.split("/").slice(0, -1).join("/");
              const newPath = dir ? `${dir}/${newName}` : newName;
              renameFilePath(state.node.path, newPath);
              onClose();
            }
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
    );
  }

  if (creatingFile) {
    return (
      <div
        className="fixed z-50 rounded-lg border border-border bg-card p-2 shadow-xl"
        style={{ left: state.x, top: state.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          placeholder="File name"
          className="rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newFileName.trim()) {
              createFile(`${state.node.path}/${newFileName.trim()}`);
              onClose();
            }
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-xl"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {(actions as Array<{ label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }>).map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={a.onClick}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-foreground/5",
            a.danger ? "text-red-400" : "text-muted-foreground",
          )}
        >
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ── Main file explorer ────────────────────────────────────────────────────────

export function FileExplorer() {
  const fs = useCocodeIDEStore((s) => s.fs);
  const createFile = useCocodeIDEStore((s) => s.createFile);
  const renameFilePath = useCocodeIDEStore((s) => s.renameFilePath);
  const recentFiles = useCocodeIDEStore((s) => s.recentFiles);
  const pinnedFiles = useCocodeIDEStore((s) => s.pinnedFiles);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const projectName = useCocodeIDEStore((s) => s.projectName);

  const [search, setSearch] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["/"]));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ kind: "file" | "folder"; x: number; y: number } | null>(null);
  const [createName, setCreateName] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+P → focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSelect = useCallback((path: string, multi = false) => {
    setSelectedPaths((prev) => {
      if (multi) {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
      }
      return new Set([path]);
    });
  }, []);

  const handleExpand = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: VirtualNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleDrop = useCallback((targetPath: string) => {
    if (!dragging || !dragging.includes("/")) return;
    const name = dragging.split("/").pop()!;
    const newPath = isDir(fs) ? `${targetPath}/${name}` : targetPath;
    renameFilePath(dragging, newPath);
    setDragging(null);
  }, [dragging, fs, renameFilePath]);

  // Filtered flat list for search
  const allFiles = flattenFiles(fs);
  const filteredFiles = search
    ? allFiles.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  const hasFiles = fs.children.length > 0;

  return (
    <div className="flex h-full flex-col border-r border-border/70 bg-sidebar text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <span className="flex-1 truncate text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          {projectName}
        </span>
        <button
          type="button"
          title="New File (Ctrl+N)"
          aria-label="New file"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setCreateName("");
            setCreating({ kind: "file", x: r.left, y: r.bottom + 4 });
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <FilePlus className="size-3.5" />
        </button>
        <button
          type="button"
          title="New Folder"
          aria-label="New folder"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setCreateName("");
            setCreating({ kind: "folder", x: r.left, y: r.bottom + 4 });
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>

      {creating && (
        <div
          className="fixed z-50 rounded-lg border border-border bg-card p-2 shadow-xl"
          style={{ left: creating.x, top: creating.y }}
        >
          <input
            autoFocus
            placeholder={creating.kind === "file" ? "File name" : "Folder name"}
            className="rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/50"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onBlur={() => setCreating(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && createName.trim()) {
                createFile(
                  creating.kind === "file" ? createName.trim() : `${createName.trim()}/.gitkeep`,
                );
                setCreating(null);
              }
              if (e.key === "Escape") setCreating(null);
            }}
          />
        </div>
      )}

      {/* Search */}
      <div className="border-b border-border/50 px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files… (⌘P)"
            className="w-full rounded-md border border-border/50 bg-background/30 py-1 pl-6 pr-6 text-[12px] outline-none placeholder:text-muted-foreground/40 focus:border-primary/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Pinned files */}
      {pinnedFiles.length > 0 && !search && (
        <div className="border-b border-border/50 pb-1">
          <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
            Pinned
          </p>
          {pinnedFiles.map((path) => {
            const name = path.split("/").pop() ?? path;
            return (
              <div
                key={path}
                onClick={() => openTab(path)}
                className="flex cursor-pointer items-center gap-1.5 px-3 py-0.5 text-[12px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <Pin className="size-3 shrink-0 text-primary/60" />
                <span className="truncate">{name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent files */}
      {recentFiles.length > 0 && !search && (
        <div className="border-b border-border/50 pb-1">
          <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
            Recent
          </p>
          {recentFiles.slice(0, 5).map((path) => {
            const name = path.split("/").pop() ?? path;
            return (
              <div
                key={path}
                onClick={() => openTab(path)}
                className="flex cursor-pointer items-center gap-1.5 px-3 py-0.5 text-[12px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <FileIcon name={name} />
                <span className="truncate">{name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* File tree / search results */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!hasFiles ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground/50">
            <Folder className="mx-auto mb-2 size-8 opacity-30" />
            No files yet. Connect a GitHub repo or paste AI-generated code.
          </div>
        ) : filteredFiles ? (
          filteredFiles.length === 0 ? (
            <p className="px-4 py-4 text-center text-[12px] text-muted-foreground/50">No files match</p>
          ) : (
            filteredFiles.map((file) => (
              <div
                key={file.path}
                onClick={() => openTab(file.path)}
                className="flex cursor-pointer items-center gap-1.5 px-3 py-0.5 text-[12px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <FileIcon name={file.name} />
                <span className="min-w-0 truncate">{file.path}</span>
              </div>
            ))
          )
        ) : (
          fs.children.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPaths={selectedPaths}
              onSelect={handleSelect}
              onExpand={handleExpand}
              expandedDirs={expandedDirs}
              onContextMenu={handleContextMenu}
              dragging={dragging}
              onDragStart={setDragging}
              onDrop={handleDrop}
              searchQuery={search}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
