"use client";

// ── Changelog Generator Panel (Phase 44) ─────────────────────────────────────
// Parses git log or AI-generates a structured CHANGELOG.md.

import { useState, useMemo } from "react";
import { ScrollText, Loader2, Download, RefreshCw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import {
  parseGitLog, buildChangelog, formatMarkdown, buildAIChangelogPrompt,
  type ParsedCommit,
} from "@/lib/cocode/changelog";
import { PanelHeader } from "@/components/cocode/panel-header";

const COMMIT_TYPE_COLOR: Record<string, string> = {
  feat: "text-emerald-400", fix: "text-red-400", perf: "text-amber-400",
  refactor: "text-blue-400", docs: "text-slate-400", chore: "text-muted-foreground/50",
  test: "text-violet-400", ci: "text-cyan-400", other: "text-muted-foreground/40",
};

const PLACEHOLDER_LOG = `abc1234 feat(auth): add OAuth 2.0 login with GitHub
def5678 fix(api): handle rate limit errors gracefully
789ghij perf(db): index foreign key on user_id
jkl0123 feat(ui): dark mode toggle in settings
mno4567 docs: update README with deployment guide
pqr8901 chore(deps): upgrade next to v15.1.0
stu2345 fix(auth): resolve token refresh race condition`;

export function ChangelogPanel({ className }: { className?: string }) {
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const [gitLog, setGitLog] = useState(PLACEHOLDER_LOG);
  const [version, setVersion] = useState("1.0.0");
  const [mode, setMode] = useState<"parse" | "ai">("parse");
  const [generating, setGenerating] = useState(false);
  const [aiChangelog, setAiChangelog] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const commits = useMemo<ParsedCommit[]>(() => {
    if (!gitLog.trim()) return [];
    return parseGitLog(gitLog);
  }, [gitLog]);

  const release = useMemo(() => buildChangelog(commits, version), [commits, version]);
  const markdown = useMemo(() => formatMarkdown(release), [release]);

  async function generateWithAI() {
    setGenerating(true);
    setAiChangelog("");
    setSavedPath(null);

    const prompt = buildAIChangelogPrompt(gitLog);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, history: [], agent: "cocode", route: "code" }),
    });

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        setAiChangelog(full);
      }
    }
    setGenerating(false);
  }

  function save() {
    const content = mode === "ai" ? aiChangelog : markdown;
    if (!content) return;
    upsertFile("CHANGELOG.md", content);
    setSavedPath("CHANGELOG.md");
    openTab("CHANGELOG.md");
  }

  const output = mode === "ai" ? aiChangelog : markdown;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={ScrollText} title="Changelog Generator" />

      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {/* Mode */}
        <div className="flex rounded-lg border border-border/40 overflow-hidden">
          <button type="button" onClick={() => setMode("parse")}
            className={cn("flex-1 py-2 text-[12px] font-medium transition-colors", mode === "parse" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
            Parse Commits
          </button>
          <button type="button" onClick={() => setMode("ai")}
            className={cn("flex-1 py-2 text-[12px] font-medium transition-colors", mode === "ai" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
            AI Generate
          </button>
        </div>

        {/* Git log input */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Git Log (one commit per line)
          </label>
          <textarea
            value={gitLog}
            onChange={(e) => setGitLog(e.target.value)}
            rows={6}
            placeholder="Paste output of: git log --oneline"
            className="w-full resize-none rounded-lg border border-border/50 console-surface p-3 font-mono text-[12px] outline-none focus:border-primary/40"
          />
          <p className="mt-1 text-[10px] text-muted-foreground/40">Tip: Run <code className="font-mono">git log --oneline</code> and paste here</p>
        </div>

        {mode === "parse" && (
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">Version</label>
            <input type="text" value={version} onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 1.2.0"
              className="w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-[12px] outline-none focus:border-primary/40"
            />
          </div>
        )}

        {/* Parsed commits preview */}
        {mode === "parse" && commits.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] text-muted-foreground/60">{commits.length} commits parsed</p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {commits.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <code className="shrink-0 text-muted-foreground/40">{c.hash}</code>
                  <span className={cn("shrink-0 font-medium", COMMIT_TYPE_COLOR[c.type] ?? "text-foreground/70")}>{c.type}</span>
                  {c.scope && <span className="text-muted-foreground/50">({c.scope})</span>}
                  <span className="truncate">{c.subject}</span>
                  {c.breaking && <span className="shrink-0 text-[10px] text-red-400">BREAKING</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "ai" && (
          <Button onClick={() => void generateWithAI()} disabled={generating || !gitLog.trim()} className="w-full">
            {generating ? <><Loader2 className="size-3.5 animate-spin" /> Generating…</> : <><RefreshCw className="size-3.5" /> Generate with AI</>}
          </Button>
        )}

        {/* Output */}
        {output && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/60">CHANGELOG.md</span>
              <Button size="sm" variant="ghost" onClick={save}><Download className="size-3.5" /> Save</Button>
            </div>
            {savedPath && <p className="mb-2 text-[11px] text-emerald-400">✓ Saved to {savedPath}</p>}
            <pre className="max-h-80 overflow-auto console-surface rounded-lg p-3 font-mono text-[12px] whitespace-pre-wrap">
              {output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
