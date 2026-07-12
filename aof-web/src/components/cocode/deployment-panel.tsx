"use client";

// ── Deployment Engine (Phase 31) ──────────────────────────────────────────────
// Two things this panel can actually do without a backend build service:
//   1. Export the project as a ZIP — works for any project, always.
//   2. Publish to GitHub Pages — real commit + real Pages API call, real URL.
// Vercel/Netlify/Railway/Cloudflare need a provider token we don't have wired
// up, so instead of faking a deploy we say so and point at the ZIP export.

import { useState, useMemo } from "react";
import {
  Rocket, CheckCircle2, XCircle, Loader2, ExternalLink,
  Settings, Copy, Globe, Download, Github, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { detectDeployConfig, type DeployTarget, type DeployConfig, type DeployLog } from "@/lib/cocode/deployment";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

const TARGET_INFO: Record<DeployTarget, { name: string; color: string; emoji: string }> = {
  vercel: { name: "Vercel", color: "bg-black/40 border-white/20 text-white", emoji: "▲" },
  netlify: { name: "Netlify", color: "bg-teal-500/20 border-teal-500/40 text-teal-300", emoji: "◆" },
  railway: { name: "Railway", color: "bg-purple-500/20 border-purple-500/40 text-purple-300", emoji: "🚂" },
  cloudflare: { name: "Cloudflare Pages", color: "bg-orange-500/20 border-orange-500/40 text-orange-300", emoji: "☁️" },
  "github-pages": { name: "GitHub Pages", color: "bg-slate-500/20 border-slate-500/40 text-slate-300", emoji: "🐙" },
};

function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function DeploymentPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const projectName = useCocodeIDEStore((s) => s.projectName);
  const projectMap = useCocodeIDEStore((s) => s.projectMap);
  const github = useCocodeIDEStore((s) => s.github);
  const commitFiles = useCocodeIDEStore((s) => s.commitFiles);

  const [config, setConfig] = useState<DeployConfig | null>(null);
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [status, setStatus] = useState<"idle" | "detecting" | "deploying" | "success" | "failed">("idle");
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  function detectConfig() {
    setStatus("detecting");
    const detected = detectDeployConfig(allFiles, projectMap);
    setConfig(detected);
    setStatus("idle");
  }

  function addLog(level: DeployLog["level"], message: string) {
    setLogs((l) => [...l, { id: `log_${Date.now()}_${l.length}`, timestamp: Date.now(), level, message }]);
  }

  async function exportZip() {
    setExporting(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of allFiles) zip.file(f.path, f.content);
      const blob = await zip.generateAsync({ type: "blob" });
      const slug = slugFor(projectName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function publishToGitHubPages() {
    if (!github.connected || !github.repo) return;
    setStatus("deploying");
    setLogs([]);
    setDeployUrl(null);
    const { fullName, branch } = github.repo;

    try {
      addLog("info", `Committing ${allFiles.length} file(s) to ${fullName}@${branch}…`);
      await commitFiles("Publish via CoCode Deploy", allFiles.map((f) => f.path));
      addLog("success", "Commit pushed.");

      addLog("info", "Enabling GitHub Pages…");
      const enableRes = await fetch(`/api/github?path=${encodeURIComponent(`/repos/${fullName}/pages`)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: { branch, path: "/" } }),
      });
      if (!enableRes.ok && enableRes.status !== 409) {
        const err = await enableRes.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `GitHub Pages API returned ${enableRes.status}`);
      }
      if (enableRes.status === 409) addLog("info", "GitHub Pages was already enabled for this repo.");

      addLog("info", "Fetching Pages status…");
      const statusRes = await fetch(`/api/github?path=${encodeURIComponent(`/repos/${fullName}/pages`)}`);
      const pages = await statusRes.json() as { html_url?: string; status?: string };

      if (pages.html_url) {
        addLog("success", `✓ Published. GitHub Pages status: ${pages.status ?? "unknown"}.`);
        addLog("info", "New builds can take a minute or two to go live — this is the real repo Pages URL.");
        setDeployUrl(pages.html_url);
        setStatus("success");
      } else {
        addLog("warn", "Pages was enabled but hasn't reported a URL yet — check back in a minute.");
        setStatus("success");
      }
    } catch (e) {
      addLog("error", e instanceof Error ? e.message : String(e));
      setStatus("failed");
    }
  }

  const INFO = config ? TARGET_INFO[config.target] : null;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Rocket className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Deploy</span>
        {status === "success" && deployUrl && (
          <a href={deployUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300">
            <Globe className="size-3" /> {deployUrl.replace(/^https?:\/\//, "")}
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        {/* Export — always available, always real */}
        <div className="rounded-xl border border-border/50 bg-card/30 p-3">
          <div className="flex items-center gap-2">
            <Download className="size-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-[13px] font-medium">Export as ZIP</p>
              <p className="text-[11px] text-muted-foreground/60">
                Download the project source to build and deploy it anywhere yourself.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void exportZip()} disabled={exporting || !allFiles.length}>
              {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              Export
            </Button>
          </div>
        </div>

        {!config ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <Rocket className="size-12 text-muted-foreground/30" />
            <div>
              <p className="font-medium">Publish Live</p>
              <p className="mt-1 text-[12px] text-muted-foreground/60">
                Auto-detects your framework to suggest a hosting target.
              </p>
            </div>
            <Button onClick={detectConfig} disabled={!allFiles.length}>
              <Settings className="size-3.5" /> Detect Config
            </Button>
          </div>
        ) : (
          <>
            {/* Target badge */}
            <div className={cn("flex items-center gap-3 rounded-xl border p-3", INFO?.color)}>
              <span className="text-2xl">{INFO?.emoji}</span>
              <div>
                <p className="font-semibold">{INFO?.name}</p>
                <p className="text-[11px] opacity-70">Auto-detected from project structure</p>
              </div>
              <button type="button" onClick={() => setEditing((e) => !e)} className="ml-auto opacity-60 hover:opacity-100">
                <Settings className="size-4" />
              </button>
            </div>

            {/* Config editor */}
            {editing && (
              <div className="space-y-2 rounded-xl border border-border/50 bg-card/30 p-3">
                <ConfigField label="Target" value={config.target}
                  onChange={(v) => setConfig((c) => c ? { ...c, target: v as DeployTarget } : c)} />
                <ConfigField label="Build command" value={config.buildCommand}
                  onChange={(v) => setConfig((c) => c ? { ...c, buildCommand: v } : c)} />
                <ConfigField label="Output dir" value={config.outputDir}
                  onChange={(v) => setConfig((c) => c ? { ...c, outputDir: v } : c)} />
                <ConfigField label="Node version" value={config.nodeVersion}
                  onChange={(v) => setConfig((c) => c ? { ...c, nodeVersion: v } : c)} />
              </div>
            )}

            {config.target === "github-pages" ? (
              !github.connected || !github.repo ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-400">
                  Connect GitHub and load a repo (see the GitHub panel) to publish to GitHub Pages.
                </div>
              ) : (
                <Button className="w-full" onClick={() => void publishToGitHubPages()} disabled={status === "deploying"}>
                  {status === "deploying"
                    ? <><Loader2 className="size-3.5 animate-spin" /> Publishing…</>
                    : <><Github className="size-3.5" /> Publish to GitHub Pages</>}
                </Button>
              )
            ) : (
              <div className="rounded-xl border border-border/50 bg-card/30 p-3 text-[12px] text-muted-foreground/70">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground/80">
                  <Clock className="size-3.5" /> Not configured
                </div>
                {INFO?.name} deploys need a provider access token this workspace doesn&rsquo;t have configured yet.
                Use <span className="font-medium text-foreground/70">Export as ZIP</span> above and deploy it with
                the {INFO?.name} CLI or dashboard, or switch the target to GitHub Pages if this is a static project.
              </div>
            )}

            {/* Log stream */}
            {logs.length > 0 && (
              <div className="rounded-xl border border-border/50 bg-[#0a0a0f] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground/60">Deploy Log</span>
                  {status === "success" && (
                    <CheckCircle2 className="size-4 text-emerald-400" />
                  )}
                  {status === "failed" && (
                    <XCircle className="size-4 text-red-400" />
                  )}
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                  {logs.map((l) => (
                    <div key={l.id} className={cn(
                      l.level === "success" ? "text-emerald-400"
                      : l.level === "error" ? "text-red-400"
                      : l.level === "warn" ? "text-amber-400"
                      : "text-slate-400",
                    )}>
                      <span className="mr-2 text-muted-foreground/30 select-none">›</span>{l.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Success URL */}
            {deployUrl && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <Globe className="size-4 text-emerald-400" />
                <a href={deployUrl} target="_blank" rel="noopener noreferrer"
                  className="flex-1 truncate text-[13px] text-emerald-300 hover:text-emerald-200">
                  {deployUrl}
                </a>
                <button type="button" onClick={() => void navigator.clipboard.writeText(deployUrl)}
                  className="text-muted-foreground hover:text-foreground">
                  <Copy className="size-3.5" />
                </button>
                <a href={deployUrl} target="_blank" rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground">
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ConfigField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border/50 bg-background/30 px-2 py-1.5 text-[12px] outline-none focus:border-primary/40"
      />
    </div>
  );
}
