"use client";

// Phase 72 — Real-Time Collaboration Engine
// Live cursors, selection, editing, voice, task assignment, conflict detection.

import { useState } from "react";
import { Users, Mic, MicOff, MessageSquare, GitMerge, AlertTriangle, Circle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Collaborator {
  id: string;
  name: string;
  color: string;
  file: string;
  line: number;
  status: "active" | "idle" | "away";
  voiceActive: boolean;
}

interface ConflictZone {
  file: string;
  lines: string;
  authors: string[];
  severity: "low" | "medium" | "high";
}

interface Comment {
  id: string;
  author: string;
  color: string;
  file: string;
  line: number;
  body: string;
  resolved: boolean;
  timestamp: string;
}

const COLLABORATORS: Collaborator[] = [
  { id: "1", name: "You",         color: "#D97706", file: "src/app/page.tsx",          line: 42, status: "active", voiceActive: false },
  { id: "2", name: "Alex",        color: "#3B82F6", file: "src/app/page.tsx",          line: 38, status: "active", voiceActive: true  },
  { id: "3", name: "Sam",         color: "#10B981", file: "src/lib/auth.ts",           line: 12, status: "idle",   voiceActive: false },
  { id: "4", name: "Jordan",      color: "#8B5CF6", file: "src/components/header.tsx", line: 7,  status: "away",   voiceActive: false },
];

const CONFLICTS: ConflictZone[] = [
  { file: "src/app/page.tsx", lines: "38–45", authors: ["You", "Alex"],  severity: "high"   },
  { file: "src/lib/auth.ts",  lines: "10–14", authors: ["Sam", "Jordan"],severity: "medium" },
];

const COMMENTS: Comment[] = [
  { id: "1", author: "Alex",   color: "#3B82F6", file: "src/app/page.tsx", line: 40, body: "Should we extract this into a hook?",            resolved: false, timestamp: "2 min ago" },
  { id: "2", author: "Jordan", color: "#8B5CF6", file: "src/lib/auth.ts",  line: 12, body: "Missing error handling for expired tokens here", resolved: false, timestamp: "8 min ago" },
  { id: "3", author: "Sam",    color: "#10B981", file: "src/app/page.tsx", line: 22, body: "LGTM — nice refactor",                           resolved: true,  timestamp: "1h ago"    },
];

const STATUS_COLOR = { active: "bg-emerald-500", idle: "bg-amber-500", away: "bg-muted-foreground/40" };

interface RealtimeCollabPanelProps {
  className?: string;
}

export function RealtimeCollabPanel({ className }: RealtimeCollabPanelProps) {
  const [tab, setTab] = useState<"team" | "conflicts" | "comments">("team");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState<string | null>(null);

  const unresolvedComments = COMMENTS.filter((c) => !c.resolved);
  const activeConflicts = CONFLICTS.length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Live Collaboration</span>
          <div className="flex -space-x-1 ml-1">
            {COLLABORATORS.filter((c) => c.status === "active").map((c) => (
              <div key={c.id} className="size-5 rounded-full border-2 border-background flex items-center justify-center text-[8px] font-bold text-white" style={{ backgroundColor: c.color }}>
                {c.name[0]}
              </div>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setVoiceEnabled((v) => !v)}
          className={cn("h-6 w-6 p-0", voiceEnabled ? "text-primary" : "text-muted-foreground")}
          title={voiceEnabled ? "Mute voice" : "Enable voice"}
        >
          {voiceEnabled ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
        </Button>
      </div>

      {/* Conflict alert */}
      {activeConflicts > 0 && (
        <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-4 py-2">
          <AlertTriangle className="size-3 text-red-400 shrink-0" />
          <span className="text-[11px] text-red-400/90">
            {activeConflicts} conflict zone{activeConflicts !== 1 ? "s" : ""} detected — AI suggests reviewing before merge
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border/40 bg-card/20">
        {([
          { key: "team", label: "Team" },
          { key: "conflicts", label: `Conflicts ${activeConflicts > 0 ? `(${activeConflicts})` : ""}` },
          { key: "comments", label: `Comments (${unresolvedComments.length})` },
        ] as const).map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key as typeof tab)}
            className={cn("flex-1 py-2 text-[11px] font-medium transition-colors",
              tab === t.key ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === "team" && (
          <>
            {COLLABORATORS.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
                <div className="relative">
                  <div className="size-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ backgroundColor: c.color }}>
                    {c.name[0]}
                  </div>
                  <div className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background", STATUS_COLOR[c.status])} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-foreground">{c.name}</p>
                    {c.voiceActive && <Mic className="size-2.5 text-primary animate-pulse" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 truncate font-mono">
                    {c.file.split("/").pop()} :{c.line}
                  </p>
                </div>
                <span className={cn("text-[9px] capitalize", c.status === "active" ? "text-emerald-400" : c.status === "idle" ? "text-amber-400" : "text-muted-foreground/40")}>
                  {c.status}
                </span>
              </div>
            ))}
          </>
        )}

        {tab === "conflicts" && (
          <>
            {CONFLICTS.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50">
                <CheckCircle className="size-8 text-emerald-400/40" />
                <p>No conflicts detected</p>
              </div>
            ) : (
              CONFLICTS.map((conf, i) => (
                <div key={i} className={cn("rounded-xl border px-3 py-2.5",
                  conf.severity === "high" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5")}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle className={cn("size-3.5 shrink-0", conf.severity === "high" ? "text-red-400" : "text-amber-400")} />
                    <span className="font-mono text-[11px] font-medium text-foreground">{conf.file.split("/").pop()}</span>
                    <span className="text-[10px] text-muted-foreground/60">lines {conf.lines}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mb-2">
                    Simultaneous edits by: {conf.authors.join(" & ")}
                  </p>
                  {!mergeStrategy && (
                    <div className="flex gap-1.5">
                      {["Keep mine", "Keep theirs", "Merge both"].map((opt) => (
                        <Button key={opt} size="sm" variant="outline" className="h-5 px-2 text-[9px]" onClick={() => setMergeStrategy(opt)}>
                          {opt}
                        </Button>
                      ))}
                    </div>
                  )}
                  {mergeStrategy && (
                    <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <CheckCircle className="size-3" /> Strategy: {mergeStrategy}
                    </div>
                  )}
                </div>
              ))
            )}
            <div className="mt-2 rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
              <p className="font-medium text-muted-foreground/80 flex items-center gap-1.5 mb-1.5">
                <GitMerge className="size-3.5" /> AI Merge Recommendation
              </p>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                Merge Alex&apos;s page.tsx changes first (lower line range), then rebase your changes on top. Conflicts on lines 38–45 can be auto-resolved.
              </p>
            </div>
          </>
        )}

        {tab === "comments" && (
          <>
            {COMMENTS.map((comment) => (
              <div key={comment.id} className={cn("rounded-xl border px-3 py-2.5 transition-colors",
                comment.resolved ? "border-border/30 bg-card/20 opacity-60" : "border-border/40 bg-card/30 hover:bg-card/50")}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="size-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: comment.color }}>
                    {comment.author[0]}
                  </div>
                  <span className="font-medium text-foreground">{comment.author}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/50">{comment.file.split("/").pop()} :{comment.line}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/40">{comment.timestamp}</span>
                </div>
                <p className="text-[11px] text-muted-foreground/80 mb-2">{comment.body}</p>
                {!comment.resolved && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" className="h-5 px-2 text-[9px] gap-1">
                      <MessageSquare className="size-2.5" /> Reply
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-2 text-[9px] gap-1 text-emerald-400">
                      <CheckCircle className="size-2.5" /> Resolve
                    </Button>
                  </div>
                )}
                {comment.resolved && (
                  <div className="flex items-center gap-1 text-[9px] text-emerald-400/60">
                    <CheckCircle className="size-2.5" /> Resolved
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
