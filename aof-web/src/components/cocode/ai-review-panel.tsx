"use client";

// ── AI Code Review Engine (Phase 40) ─────────────────────────────────────────
// Comprehensive AI-powered code review with actionable suggestions.
// Reviews: logic, performance, security, naming, tests, architecture.
// Output: structured review with severity, category, line, and diff.

import { useState } from "react";
import {
  Star, Loader2, ThumbsUp, ThumbsDown, ChevronDown, ChevronRight,
  RefreshCw, Wand2, Copy, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";

type ReviewCategory = "logic" | "performance" | "security" | "naming" | "tests" | "architecture" | "style" | "docs";
type ReviewSeverity = "critical" | "suggestion" | "praise" | "question";

interface ReviewComment {
  id: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  line: number | null;
  title: string;
  description: string;
  suggestion: string | null;
  autoFixable: boolean;
}

interface ReviewResult {
  score: number;
  summary: string;
  comments: ReviewComment[];
  lgtm: boolean;
  requestedChanges: number;
  generatedAt: number;
}

const SEV_STYLE: Record<ReviewSeverity, { color: string; bg: string; label: string }> = {
  critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", label: "Critical" },
  suggestion: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", label: "Suggestion" },
  praise: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", label: "Praise" },
  question: { color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/30", label: "Question" },
};

const CAT_EMOJI: Record<ReviewCategory, string> = {
  logic: "🧠", performance: "⚡", security: "🔒",
  naming: "📝", tests: "🧪", architecture: "🏗️", style: "🎨", docs: "📚",
};

function parseReviewFromAI(text: string): ReviewResult {
  // Try structured JSON first
  const jsonMatch = text.match(/```json\n?([\s\S]*?)```/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]) as ReviewResult; } catch {}
  }

  // Fall back to extracting structured comments from prose
  const comments: ReviewComment[] = [];
  const lines = text.split("\n");
  let id = 0;

  for (const line of lines) {
    if (/^\s*[•\-\*]\s/.test(line)) {
      const text = line.replace(/^\s*[•\-\*]\s/, "").trim();
      if (text.length > 10) {
        const sev: ReviewSeverity =
          /critical|must|broken|bug|error/i.test(text) ? "critical"
          : /good|nice|well|excellent|great/i.test(text) ? "praise"
          : /\?/.test(text) ? "question"
          : "suggestion";

        const cat: ReviewCategory =
          /security|xss|sql|injection/i.test(text) ? "security"
          : /performance|memo|cache|render/i.test(text) ? "performance"
          : /test/i.test(text) ? "tests"
          : /name|variable|function/i.test(text) ? "naming"
          : /architecture|pattern|structure/i.test(text) ? "architecture"
          : /comment|doc|jsdoc/i.test(text) ? "docs"
          : "logic";

        comments.push({
          id: String(++id),
          category: cat,
          severity: sev,
          line: null,
          title: text.slice(0, 80),
          description: text,
          suggestion: null,
          autoFixable: false,
        });
      }
    }
  }

  // Extract score
  const scoreMatch = text.match(/(?:score|rating)[:\s]+(\d+)/i);
  const score = scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : 70;
  const summaryMatch = text.match(/(?:summary|overview)[:\s]+([^\n]+)/i);

  return {
    score,
    summary: summaryMatch?.[1] ?? text.slice(0, 200),
    comments,
    lgtm: score >= 80 && comments.filter((c) => c.severity === "critical").length === 0,
    requestedChanges: comments.filter((c) => c.severity === "critical").length,
    generatedAt: Date.now(),
  };
}

export function AIReviewPanel({ className }: { className?: string }) {
  const activeFile = useCocodeIDEStore((s) => s.activeFile());
  const allFiles = useCocodeIDEStore((s) => s.allFiles);
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);

  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [scope, setScope] = useState<"file" | "project">("file");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<Record<string, "up" | "down">>({});

  async function runReview() {
    setReviewing(true);
    setReview(null);

    const content = scope === "file"
      ? (activeFile ? `File: ${activeFile.path}\n\`\`\`\n${activeFile.content.slice(0, 4000)}\n\`\`\`` : "")
      : allFiles().slice(0, 8).map((f) => `File: ${f.path}\n\`\`\`\n${f.content.slice(0, 600)}\n\`\`\``).join("\n\n---\n\n");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `You are a senior software engineer conducting a thorough code review. Review the following code and provide:
1. Overall score (0-100)
2. A brief summary
3. Bullet points for: critical issues, suggestions, praise, and questions
4. Focus on: logic correctness, performance, security, naming, test coverage, architecture

Format your response with a "Score: X" line and "Summary: ..." line, then bullet points.

${content}`,
          history: [],
          agent: "cocode",
          route: "review",
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
      setReview(parseReviewFromAI(full));
    } finally {
      setReviewing(false);
    }
  }

  async function generateFix(comment: ReviewComment) {
    if (!activeFile) return;
    setFixing(comment.id);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Generate a unified git diff to fix this code review issue:\nIssue: ${comment.title}\n${comment.description}\nFile: ${activeFile.path}\n\`\`\`\n${activeFile.content.slice(0, 2000)}\n\`\`\``,
        history: [],
        agent: "cocode",
        route: "fix",
      }),
    });

    if (res.ok && res.body) {
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
      if (diffs.length) { setDiff(diffs[0]); setRightPanel("diff"); }
    }

    setFixing(null);
  }

  function scoreColor(s: number) {
    if (s >= 80) return "text-emerald-400";
    if (s >= 60) return "text-amber-400";
    return "text-red-400";
  }

  const critical = review?.comments.filter((c) => c.severity === "critical") ?? [];
  const suggestions = review?.comments.filter((c) => c.severity === "suggestion") ?? [];
  const praises = review?.comments.filter((c) => c.severity === "praise") ?? [];
  const questions = review?.comments.filter((c) => c.severity === "question") ?? [];

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Star className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">AI Code Review</span>
        {review && (
          <div className="ml-auto flex items-center gap-2">
            <span className={cn("text-sm font-bold", scoreColor(review.score))}>{review.score}/100</span>
            {review.lgtm && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">LGTM</span>}
            {review.requestedChanges > 0 && (
              <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                {review.requestedChanges} change{review.requestedChanges !== 1 ? "s" : ""} requested
              </span>
            )}
          </div>
        )}
      </div>

      {/* Config */}
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-2">
        <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-secondary/20 p-0.5">
          {(["file", "project"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                scope === s ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground",
              )}>
              {s === "file" ? "Active File" : "Whole Project"}
            </button>
          ))}
        </div>
        <Button size="sm" className="ml-auto" onClick={() => void runReview()} disabled={reviewing || (!activeFile && scope === "file")}>
          {reviewing ? <><Loader2 className="size-3.5 animate-spin" /> Reviewing…</> : <><RefreshCw className="size-3.5" /> {review ? "Re-review" : "Review"}</>}
        </Button>
      </div>

      {!review && !reviewing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <Star className="size-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium">AI Code Review</p>
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              Senior engineer review covering logic, performance, security, naming, tests, and architecture.
            </p>
          </div>
          <Button onClick={() => void runReview()} disabled={!activeFile && scope === "file"}>
            <Star className="size-3.5" /> Start Review
          </Button>
        </div>
      ) : reviewing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-[12px] text-muted-foreground/60">Reviewing code…</p>
        </div>
      ) : review && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Summary */}
          <div className="border-b border-border/50 p-4">
            <div className="mb-2 flex items-center gap-3">
              <div className="relative size-14">
                <svg viewBox="0 0 60 60" className="size-full -rotate-90">
                  <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="6" className="text-border/50" />
                  <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="6"
                    strokeDasharray={`${review.score * 1.508} 150.8`}
                    className={scoreColor(review.score)} strokeLinecap="round" />
                </svg>
                <span className={cn("absolute inset-0 flex items-center justify-center text-sm font-bold", scoreColor(review.score))}>
                  {review.score}
                </span>
              </div>
              <p className="flex-1 text-[12px] text-muted-foreground/80">{review.summary}</p>
            </div>
            <div className="flex gap-3 text-[11px]">
              {critical.length > 0 && <span className="text-red-400">{critical.length} critical</span>}
              {suggestions.length > 0 && <span className="text-amber-400">{suggestions.length} suggestions</span>}
              {praises.length > 0 && <span className="text-emerald-400">{praises.length} praise</span>}
            </div>
          </div>

          {/* Comments */}
          {([
            { label: "Critical Issues", items: critical },
            { label: "Suggestions", items: suggestions },
            { label: "Questions", items: questions },
            { label: "Praise", items: praises },
          ] as const).map(({ label, items }) => items.length > 0 && (
            <div key={label}>
              <div className="bg-card/20 px-4 py-2 text-[11px] font-semibold text-muted-foreground/70">
                {label} ({items.length})
              </div>
              {items.map((c) => (
                <ReviewCommentRow
                  key={c.id}
                  comment={c}
                  expanded={expanded === c.id}
                  onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
                  onFix={() => void generateFix(c)}
                  fixing={fixing === c.id}
                  feedback={feedbacks[c.id]}
                  onFeedback={(f) => setFeedbacks((prev) => ({ ...prev, [c.id]: f }))}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCommentRow({
  comment, expanded, onToggle, onFix, fixing, feedback, onFeedback,
}: {
  comment: ReviewComment;
  expanded: boolean;
  onToggle: () => void;
  onFix: () => void;
  fixing: boolean;
  feedback?: "up" | "down";
  onFeedback: (f: "up" | "down") => void;
}) {
  const sev = SEV_STYLE[comment.severity];
  return (
    <div className="border-b border-border/30">
      <button type="button" onClick={onToggle}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-white/[0.03]">
        {expanded ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        <span className="shrink-0 text-sm">{CAT_EMOJI[comment.category]}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px]">{comment.title}</p>
          {comment.line && <p className="text-[11px] text-muted-foreground/50">Line {comment.line}</p>}
        </div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", sev.color)}>
          {sev.label}
        </span>
      </button>

      {expanded && (
        <div className={cn("mx-4 mb-2 rounded-lg border p-3 text-[12px]", sev.bg)}>
          <p className="mb-2">{comment.description}</p>
          {comment.suggestion && (
            <p className="mb-2 text-[11px] text-muted-foreground/70 italic">Suggestion: {comment.suggestion}</p>
          )}
          <div className="flex items-center gap-2">
            {comment.severity !== "praise" && (
              <Button size="sm" variant="secondary" onClick={onFix} disabled={fixing}>
                {fixing ? <><Loader2 className="size-3.5 animate-spin" /> Fixing…</> : <><Wand2 className="size-3.5" /> Fix</>}
              </Button>
            )}
            <button type="button" onClick={() => onFeedback("up")}
              className={cn("ml-auto text-muted-foreground/40 hover:text-emerald-400", feedback === "up" && "text-emerald-400")}>
              <ThumbsUp className="size-3.5" />
            </button>
            <button type="button" onClick={() => onFeedback("down")}
              className={cn("text-muted-foreground/40 hover:text-red-400", feedback === "down" && "text-red-400")}>
              <ThumbsDown className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
