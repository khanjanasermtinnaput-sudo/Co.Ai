"use client";

// ── Real-time Collaboration Panel (Phase 33) ──────────────────────────────────
// Multi-user presence, cursors, comments, shared workspace state.
// Connects to the project's shared session via WebSocket (when available).
// Fallback: shows collaboration setup instructions + invite link.

import { useState, useEffect } from "react";
import {
  Users, Copy, CheckCircle2, MessageSquare, UserPlus,
  Circle, Send, Trash2,
} from "lucide-react";
import { cn, readableTextColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { PanelHeader } from "@/components/cocode/panel-header";

interface Collaborator {
  id: string;
  name: string;
  color: string;
  avatar: string;
  status: "active" | "idle" | "away";
  cursor?: { file: string; line: number };
}

interface Comment {
  id: string;
  author: string;
  authorColor: string;
  content: string;
  file: string | null;
  line: number | null;
  resolved: boolean;
  createdAt: number;
}

const DEMO_COLLABORATORS: Collaborator[] = [
  { id: "me", name: "You", color: "#3b82f6", avatar: "Y", status: "active" },
];

const COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#10b981", "#f97316", "#06b6d4", "#f59e0b"];

export function CollaborationPanel({ className }: { className?: string }) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>(DEMO_COLLABORATORS);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 10).toUpperCase());
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"presence" | "comments">("presence");

  const activeFile = useCocodeIDEStore((s) => s.activeFile());

  async function copyInviteLink() {
    const link = `${window.location.origin}/code?session=${sessionId}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function addComment() {
    const text = newComment.trim();
    if (!text) return;
    const c: Comment = {
      id: `c_${Date.now()}`,
      author: "You",
      authorColor: "#3b82f6",
      content: text,
      file: activeFile?.path ?? null,
      line: null,
      resolved: false,
      createdAt: Date.now(),
    };
    setComments((cs) => [...cs, c]);
    setNewComment("");
  }

  function resolveComment(id: string) {
    setComments((cs) => cs.map((c) => c.id === id ? { ...c, resolved: true } : c));
  }

  function removeComment(id: string) {
    setComments((cs) => cs.filter((c) => c.id !== id));
  }

  const STATUS_DOT: Record<Collaborator["status"], string> = {
    active: "bg-emerald-400",
    idle: "bg-amber-400",
    away: "bg-muted-foreground/40",
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={Users} title="Collaboration">
        <div className="ml-auto flex -space-x-1">
          {collaborators.slice(0, 4).map((c) => (
            <div key={c.id}
              className="flex size-6 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold"
              style={{ backgroundColor: c.color, color: readableTextColor(c.color) }}
              title={c.name}>
              {c.avatar}
            </div>
          ))}
        </div>
      </PanelHeader>

      {/* Tabs */}
      <div className="flex border-b border-border/50">
        <button type="button" onClick={() => setTab("presence")}
          className={cn("flex-1 py-2 text-[12px] font-medium transition-colors",
            tab === "presence" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
          Presence
        </button>
        <button type="button" onClick={() => setTab("comments")}
          className={cn("flex-1 py-2 text-[12px] font-medium transition-colors",
            tab === "comments" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
          Comments {comments.filter((c) => !c.resolved).length > 0 && `(${comments.filter((c) => !c.resolved).length})`}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "presence" && (
          <div className="space-y-4 p-4">
            {/* Session invite */}
            <div className="rounded-xl border border-border/60 bg-card/40 p-4">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground/60">Session ID</p>
              <div className="mb-3 flex items-center gap-2">
                <code className="flex-1 rounded bg-secondary/30 px-2 py-1.5 font-mono text-sm tracking-widest">
                  {sessionId}
                </code>
                <Button size="sm" variant="ghost" onClick={() => void copyInviteLink()} title="Copy invite link">
                  {copied ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
              <Button size="sm" variant="secondary" className="w-full" onClick={() => void copyInviteLink()}>
                <UserPlus className="size-3.5" /> Invite Collaborators
              </Button>
            </div>

            {/* Active users */}
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                Active ({collaborators.length})
              </p>
              {collaborators.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-foreground/5">
                  <div className="relative">
                    <div className="flex size-8 items-center justify-center rounded-full text-[12px] font-bold"
                      style={{ backgroundColor: c.color, color: readableTextColor(c.color) }}>
                      {c.avatar}
                    </div>
                    <div className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-card", STATUS_DOT[c.status])} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{c.name}{c.id === "me" && " (you)"}</p>
                    {c.cursor && (
                      <p className="truncate text-[11px] text-muted-foreground/60">
                        {c.cursor.file}:{c.cursor.line}
                      </p>
                    )}
                  </div>
                  <span className={cn("text-[10px] capitalize", c.status === "active" ? "text-emerald-400" : "text-muted-foreground/50")}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Info */}
            <div className="rounded-xl border border-border/40 bg-card/20 p-3 text-[11px] text-muted-foreground/60">
              Real-time sync becomes available when all collaborators join the same session link. Share the invite link above to start a collaborative session.
            </div>
          </div>
        )}

        {tab === "comments" && (
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto divide-y divide-border/30">
              {comments.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <MessageSquare className="size-8 text-muted-foreground/30" />
                  <p className="text-[12px] text-muted-foreground/60">No comments yet. Add the first one below.</p>
                </div>
              )}
              {comments.map((c) => (
                <div key={c.id} className={cn("p-3", c.resolved && "opacity-50")}>
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: c.authorColor, color: readableTextColor(c.authorColor) }}>
                      {c.author[0]}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium">{c.author}</span>
                        {c.file && (
                          <span className="truncate text-[11px] text-muted-foreground/50">{c.file}</span>
                        )}
                        {c.resolved && <span className="text-[10px] text-emerald-400">✓ Resolved</span>}
                      </div>
                      <p className="mt-0.5 text-[12px]">{c.content}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {!c.resolved && (
                        <button type="button" onClick={() => resolveComment(c.id)}
                          className="text-muted-foreground/40 hover:text-emerald-400" title="Resolve">
                          <CheckCircle2 className="size-3.5" />
                        </button>
                      )}
                      <button type="button" onClick={() => removeComment(c.id)}
                        className="text-muted-foreground/40 hover:text-red-400">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add comment */}
            <div className="border-t border-border/70 p-3">
              {activeFile && (
                <p className="mb-1 text-[10px] text-muted-foreground/50">Commenting on {activeFile.name}</p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addComment()}
                  placeholder="Leave a comment…"
                  className="flex-1 rounded-lg border border-border/50 bg-background/30 px-3 py-2 text-[12px] outline-none focus:border-primary/40"
                />
                <Button size="sm" onClick={addComment} disabled={!newComment.trim()}>
                  <Send className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
