"use client";

// ── CI/CD Pipeline Builder (Phase 32) ────────────────────────────────────────
// Generate GitHub Actions or GitLab CI YAML. Preview the generated YAML and
// save it directly to the virtual FS. CircleCI and Bitbucket Pipelines have no
// generator yet, so they're listed as disabled "Soon" targets rather than
// producing a placeholder file.

import { useState, useMemo } from "react";
import { GitMerge, Download, FolderOpen, Copy, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import {
  detectDeployConfig,
  generateGitHubActions,
  generateGitLabCI,
  type CICDConfig,
  type CICDTarget,
  type DeployTarget,
} from "@/lib/cocode/deployment";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { PanelHeader } from "@/components/cocode/panel-header";

const CICD_TARGETS: Array<{ id: CICDTarget; label: string; file: string; comingSoon?: boolean }> = [
  { id: "github-actions", label: "GitHub Actions", file: ".github/workflows/ci.yml" },
  { id: "gitlab-ci", label: "GitLab CI", file: ".gitlab-ci.yml" },
  { id: "circleci", label: "CircleCI", file: ".circleci/config.yml", comingSoon: true },
  { id: "bitbucket", label: "Bitbucket Pipelines", file: "bitbucket-pipelines.yml", comingSoon: true },
];

const STEPS_OPTIONS: Array<{ id: CICDConfig["steps"][0]; label: string }> = [
  { id: "install", label: "Install" },
  { id: "lint", label: "Lint" },
  { id: "typecheck", label: "Type Check" },
  { id: "test", label: "Test" },
  { id: "build", label: "Build" },
  { id: "deploy", label: "Deploy" },
];

export function CICDBuilder({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const projectMap = useCocodeIDEStore((s) => s.projectMap);
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);

  const [target, setTarget] = useState<CICDTarget>("github-actions");
  const [steps, setSteps] = useState<Set<CICDConfig["steps"][0]>>(
    new Set(["install", "lint", "typecheck", "test", "build"]),
  );
  const [triggers, setTriggers] = useState<Set<CICDConfig["triggers"][0]>>(new Set(["push", "pr"]));
  const [copied, setCopied] = useState(false);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);
  const deployConfig = useMemo(() => detectDeployConfig(allFiles, projectMap), [allFiles, projectMap]);

  const config: CICDConfig = useMemo(() => ({
    target,
    triggers: [...triggers] as CICDConfig["triggers"],
    steps: STEPS_OPTIONS.filter((s) => steps.has(s.id)).map((s) => s.id),
    deployTarget: steps.has("deploy") ? deployConfig.target : null,
  }), [target, triggers, steps, deployConfig]);

  const yaml = useMemo(() => {
    if (target === "github-actions") return generateGitHubActions(config, deployConfig);
    if (target === "gitlab-ci") return generateGitLabCI(config, deployConfig);
    return `# ${target} pipeline\n# Support coming soon — contribute at github.com/coagentix\n`;
  }, [config, deployConfig, target]);

  const targetInfo = CICD_TARGETS.find((t) => t.id === target)!;

  function toggleStep(id: CICDConfig["steps"][0]) {
    setSteps((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleTrigger(id: CICDConfig["triggers"][0]) {
    setTriggers((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function copyYaml() {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function saveToFS() {
    upsertFile(targetInfo.file, yaml);
  }

  function downloadYaml() {
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = targetInfo.file.split("/").pop()!;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={GitMerge} title="CI/CD Builder">
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void copyYaml()} title="Copy YAML">
            {copied ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={saveToFS} title={`Save to ${targetInfo.file}`}>
            <FolderOpen className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={downloadYaml} title="Download">
            <Download className="size-3.5" />
          </Button>
        </div>
      </PanelHeader>

      <div className="flex min-h-0 flex-1">
        {/* Config panel */}
        <div className="w-44 shrink-0 space-y-4 overflow-y-auto border-r border-border/50 p-3">
          {/* Platform */}
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Platform</p>
            {CICD_TARGETS.map((t) => (
              <button key={t.id} type="button" disabled={t.comingSoon}
                onClick={() => setTarget(t.id)}
                title={t.comingSoon ? "No generator for this platform yet" : undefined}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                  t.comingSoon
                    ? "cursor-not-allowed text-muted-foreground/40"
                    : target === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                )}>
                {t.label}
                {t.comingSoon && (
                  <span className="ml-auto rounded border border-border/60 px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground/60">
                    Soon
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Triggers */}
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Triggers</p>
            {(["push", "pr", "schedule"] as const).map((t) => (
              <label key={t} className="mb-1 flex cursor-pointer items-center gap-2 text-[12px]">
                <input type="checkbox" checked={triggers.has(t)} onChange={() => toggleTrigger(t)}
                  className="accent-primary" />
                <span className="text-muted-foreground capitalize">{t === "pr" ? "Pull Request" : t}</span>
              </label>
            ))}
          </div>

          {/* Steps */}
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Steps</p>
            {STEPS_OPTIONS.map((s) => (
              <label key={s.id} className="mb-1 flex cursor-pointer items-center gap-2 text-[12px]">
                <input type="checkbox" checked={steps.has(s.id)} onChange={() => toggleStep(s.id)}
                  className="accent-primary" />
                <span className="text-muted-foreground">{s.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* YAML preview */}
        <div className="console-surface min-w-0 flex-1 overflow-auto p-4">
          <pre className="font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre">{yaml}</pre>
        </div>
      </div>
    </div>
  );
}
