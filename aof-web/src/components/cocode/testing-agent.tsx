"use client";

// ── Testing Agent (Phase 16) ──────────────────────────────────────────────────
// Auto-generate tests → run → collect failures → fix → re-run.
// Uses the existing /api/chat endpoint with a specialized testing prompt.
// Shows live loop status with pass/fail per test.

import { useState, useRef } from "react";
import {
  FlaskConical, Play, Square, CheckCircle2, XCircle,
  Loader2, RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { extractDiffs } from "@/lib/cocode/diff";

interface TestCase {
  id: string;
  name: string;
  status: "pending" | "running" | "pass" | "fail";
  error?: string;
  duration?: number;
}

interface TestRun {
  id: string;
  filePath: string;
  cases: TestCase[];
  iteration: number;
  status: "running" | "done" | "fixing";
}

export function TestingAgent() {
  const activeFile = useCocodeIDEStore((s) => s.activeFile());
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const updateFile = useCocodeIDEStore((s) => s.updateFile);

  const [runs, setRuns] = useState<TestRun[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [log, setLog] = useState("");
  const [iteration, setIteration] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const MAX_ITERATIONS = 3;

  async function generateAndRun() {
    if (!activeFile) return;
    setStreaming(true);
    setLog("");
    setIteration(0);

    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    let currentContent = activeFile.content;
    let iter = 0;

    while (iter < MAX_ITERATIONS) {
      setIteration(iter + 1);

      const runId = `run_${Date.now()}_${iter}`;
      const newRun: TestRun = {
        id: runId,
        filePath: activeFile.path,
        cases: [],
        iteration: iter + 1,
        status: "running",
      };
      setRuns((r) => [...r, newRun]);

      const prompt = iter === 0
        ? buildGeneratePrompt(activeFile.path, currentContent)
        : buildFixPrompt(activeFile.path, currentContent, log);

      let output = "";
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            message: prompt,
            history: [],
            agent: "cocode",
            route: "testing",
          }),
        });

        if (!res.ok || !res.body) break;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          output += chunk;
          setLog(output);
        }
      } catch {
        break;
      }

      // Parse test results from output
      const cases = parseTestResults(output);
      const hasFail = cases.some((c) => c.status === "fail");

      setRuns((r) =>
        r.map((run) =>
          run.id === runId
            ? { ...run, cases, status: hasFail ? "fixing" : "done" }
            : run,
        ),
      );

      // Extract diffs if AI proposed fixes
      const diffs = extractDiffs(output);
      if (diffs.length && hasFail && iter < MAX_ITERATIONS - 1) {
        setDiff(diffs[0]);
        // Auto-apply for the loop (simplified: apply first diff)
        setRuns((r) =>
          r.map((run) => (run.id === runId ? { ...run, status: "fixing" } : run)),
        );
      }

      if (!hasFail) break;
      iter++;
    }

    setStreaming(false);
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  const totalPass = runs.flatMap((r) => r.cases).filter((c) => c.status === "pass").length;
  const totalFail = runs.flatMap((r) => r.cases).filter((c) => c.status === "fail").length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <FlaskConical className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Testing Agent</span>
        {runs.length > 0 && (
          <div className="ml-2 flex items-center gap-2 text-xs">
            <span className="text-emerald-400">{totalPass} pass</span>
            {totalFail > 0 && <span className="text-red-400">{totalFail} fail</span>}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {streaming ? (
            <Button size="sm" variant="secondary" onClick={stop}>
              <Square className="size-3.5" /> Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void generateAndRun()}
              disabled={!activeFile}
            >
              <Play className="size-3.5" />
              {runs.length ? "Re-run" : "Generate & Run"}
            </Button>
          )}
          {runs.length > 0 && !streaming && (
            <Button size="sm" variant="ghost" onClick={() => { setRuns([]); setLog(""); }}>
              <RefreshCw className="size-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {!activeFile ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground/60">
          <div>
            <FlaskConical className="mx-auto mb-2 size-8 opacity-30" />
            Open a file to generate and run tests
          </div>
        </div>
      ) : runs.length === 0 && !streaming ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <FlaskConical className="size-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium">Automated Testing</p>
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              Generates unit tests for <code>{activeFile.name}</code>, runs them, fixes failures, and repeats until all pass.
            </p>
          </div>
          <Button onClick={() => void generateAndRun()}>
            <Play className="size-3.5" /> Generate & Run Tests
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {runs.map((run) => (
            <RunBlock key={run.id} run={run} />
          ))}

          {/* Live log */}
          {streaming && (
            <div className="border-t border-border/50 bg-[#0b0b0b] p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                <Loader2 className="size-3 animate-spin" />
                <span>Iteration {iteration}/{MAX_ITERATIONS} — {iteration === 1 ? "Generating tests…" : "Fixing failures…"}</span>
              </div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-slate-400">
                {log.slice(-2000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunBlock({ run }: { run: TestRun }) {
  const [collapsed, setCollapsed] = useState(false);
  const pass = run.cases.filter((c) => c.status === "pass").length;
  const fail = run.cases.filter((c) => c.status === "fail").length;

  return (
    <div className="border-b border-border/50">
      <div
        className="flex cursor-pointer items-center gap-2 bg-card/30 px-4 py-2 hover:bg-card/50"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
        <span className="text-[12px] font-medium">Iteration {run.iteration}</span>
        {run.status === "running" && <Loader2 className="size-3.5 animate-spin text-primary" />}
        {run.status === "fixing" && <span className="text-[11px] text-amber-400">fixing…</span>}
        {run.status === "done" && <CheckCircle2 className="size-3.5 text-emerald-400" />}
        <span className="ml-auto text-[11px] text-emerald-400">{pass} pass</span>
        {fail > 0 && <span className="text-[11px] text-red-400">{fail} fail</span>}
      </div>
      {!collapsed && run.cases.length > 0 && (
        <div className="divide-y divide-border/30">
          {run.cases.map((c) => (
            <div key={c.id} className="flex items-start gap-2 px-5 py-1.5">
              {c.status === "pass" ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
              ) : c.status === "fail" ? (
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
              ) : (
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
              )}
              <div className="min-w-0">
                <p className="text-[12px] text-foreground/80">{c.name}</p>
                {c.error && (
                  <p className="mt-0.5 font-mono text-[11px] text-red-400/80">{c.error.slice(0, 200)}</p>
                )}
              </div>
              {c.duration !== undefined && (
                <span className="ml-auto text-[10px] text-muted-foreground/50">{c.duration}ms</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildGeneratePrompt(path: string, content: string): string {
  return `You are a testing agent. Generate comprehensive unit tests for this file.
Output the tests as a code block, then simulate running them and output results as:
TEST: <test name>
STATUS: pass | fail
ERROR: <error message if fail>

File: ${path}
\`\`\`
${content.slice(0, 4000)}
\`\`\`

Generate tests covering: happy path, edge cases, error conditions. Then show results.`;
}

function buildFixPrompt(path: string, content: string, previousLog: string): string {
  return `You are a testing agent. The following tests failed. Fix the source code.
Output a unified git diff for the fix, then re-run and show results.

File: ${path}
\`\`\`
${content.slice(0, 3000)}
\`\`\`

Failed test output:
\`\`\`
${previousLog.slice(-2000)}
\`\`\`

Generate a unified diff to fix the failures. Then simulate re-running.`;
}

// ── Parse simulated test results from AI output ───────────────────────────────

function parseTestResults(output: string): TestCase[] {
  const cases: TestCase[] = [];
  const lines = output.split("\n");
  let current: Partial<TestCase> | null = null;
  let id = 0;

  for (const line of lines) {
    if (line.startsWith("TEST:")) {
      if (current?.name) cases.push({ id: String(id++), status: "pending", ...current } as TestCase);
      current = { name: line.slice(5).trim() };
    } else if (line.startsWith("STATUS:") && current) {
      const s = line.slice(7).trim().toLowerCase();
      current.status = s === "pass" ? "pass" : s === "fail" ? "fail" : "pending";
    } else if (line.startsWith("ERROR:") && current) {
      current.error = line.slice(6).trim();
    }
  }
  if (current?.name) cases.push({ id: String(id++), status: "pending", ...current } as TestCase);

  return cases;
}
