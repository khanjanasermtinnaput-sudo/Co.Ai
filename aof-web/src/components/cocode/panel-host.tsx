"use client";

// ── Panel host — lazy-loaded panel components + the renderer that picks one ──
// Pulled out of cocode-workspace.tsx so the shell file is composition, not a
// 30-import wall. Every panel stays individually code-split (lazy()) exactly
// as before — this is a pure extraction, no bundling behavior change.

import { lazy } from "react";
import { Loader2 } from "lucide-react";
import type { IDEPanel } from "@/store/cocode-ide-store";

export const FileExplorer    = lazy(() => import("./file-explorer").then((m) => ({ default: m.FileExplorer })));
export const MonacoEditor    = lazy(() => import("./monaco-editor").then((m) => ({ default: m.MonacoEditor })));
const DiffViewer      = lazy(() => import("./diff-viewer").then((m) => ({ default: m.DiffViewer })));
const LivePreview     = lazy(() => import("./live-preview").then((m) => ({ default: m.LivePreview })));
const KnowledgeGraphView = lazy(() => import("./knowledge-graph-view").then((m) => ({ default: m.KnowledgeGraphView })));
const CheckpointPanel = lazy(() => import("./checkpoint-panel").then((m) => ({ default: m.CheckpointPanel })));
const GitHubPanel     = lazy(() => import("./github-panel").then((m) => ({ default: m.GitHubPanel })));
const RefactorMenu    = lazy(() => import("./refactor-menu").then((m) => ({ default: m.RefactorMenu })));
const TestingAgent    = lazy(() => import("./testing-agent").then((m) => ({ default: m.TestingAgent })));
const MultiPreview    = lazy(() => import("./multi-preview").then((m) => ({ default: m.MultiPreview })));
const DependencyPanel = lazy(() => import("./dependency-panel").then((m) => ({ default: m.DependencyPanel })));
const DocsGenerator   = lazy(() => import("./docs-generator").then((m) => ({ default: m.DocsGenerator })));
const DiagnosticsPanel = lazy(() => import("./diagnostics-panel").then((m) => ({ default: m.DiagnosticsPanel })));
const PairPanel       = lazy(() => import("./pair-panel").then((m) => ({ default: m.PairPanel })));
const DeploymentPanel = lazy(() => import("./deployment-panel").then((m) => ({ default: m.DeploymentPanel })));
const CICDBuilder     = lazy(() => import("./cicd-builder").then((m) => ({ default: m.CICDBuilder })));
const CollaborationPanel = lazy(() => import("./collaboration-panel").then((m) => ({ default: m.CollaborationPanel })));
const EnvManager      = lazy(() => import("./env-manager").then((m) => ({ default: m.EnvManager })));
const PerformancePanel = lazy(() => import("./performance-panel").then((m) => ({ default: m.PerformancePanel })));
const SecurityPanel   = lazy(() => import("./security-panel").then((m) => ({ default: m.SecurityPanel })));
const ApiStudio       = lazy(() => import("./api-studio").then((m) => ({ default: m.ApiStudio })));
const DatabaseStudio  = lazy(() => import("./database-studio").then((m) => ({ default: m.DatabaseStudio })));
const AIReviewPanel   = lazy(() => import("./ai-review-panel").then((m) => ({ default: m.AIReviewPanel })));
const MobilePreview   = lazy(() => import("./mobile-preview").then((m) => ({ default: m.MobilePreview })));
const TestGeneratorPanel = lazy(() => import("./test-generator-panel").then((m) => ({ default: m.TestGeneratorPanel })));
const SemanticSearchPanel = lazy(() => import("./semantic-search-panel").then((m) => ({ default: m.SemanticSearchPanel })));
const CodeTranslatorPanel = lazy(() => import("./code-translator-panel").then((m) => ({ default: m.CodeTranslatorPanel })));
const ChangelogPanel  = lazy(() => import("./changelog-panel").then((m) => ({ default: m.ChangelogPanel })));
const ArchitecturePanel = lazy(() => import("./architecture-panel").then((m) => ({ default: m.ArchitecturePanel })));
const RuntimeMonitor  = lazy(() => import("./runtime-monitor").then((m) => ({ default: m.RuntimeMonitor })));
const AccessibilityPanel = lazy(() => import("./accessibility-panel").then((m) => ({ default: m.AccessibilityPanel })));
const I18nPanel       = lazy(() => import("./i18n-panel").then((m) => ({ default: m.I18nPanel })));
const CoveragePanel   = lazy(() => import("./coverage-panel").then((m) => ({ default: m.CoveragePanel })));
const ScaffolderPanel = lazy(() => import("./scaffolder-panel").then((m) => ({ default: m.ScaffolderPanel })));

export function PanelLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
    </div>
  );
}

/** Renders whichever panel is active in the right rail. A plain lookup table,
 *  not a switch — adding a panel is a one-line entry in PANEL_DEFS plus one
 *  line here. */
export function ActivePanel({ panel }: { panel: IDEPanel }) {
  const map: Partial<Record<IDEPanel, React.ReactNode>> = {
    diff:               <DiffViewer />,
    preview:            <LivePreview className="h-full" />,
    "multi-preview":    <MultiPreview className="h-full" />,
    github:             <GitHubPanel />,
    graph:              <KnowledgeGraphView />,
    checkpoints:        <CheckpointPanel />,
    explorer:           <RefactorMenu className="overflow-y-auto" />,
    tests:              <TestingAgent />,
    deps:               <DependencyPanel className="h-full" />,
    docs:               <DocsGenerator className="h-full" />,
    diagnostics:        <DiagnosticsPanel className="h-full" />,
    pair:               <PairPanel className="h-full" />,
    deploy:             <DeploymentPanel className="h-full" />,
    cicd:               <CICDBuilder className="h-full" />,
    collab:             <CollaborationPanel className="h-full" />,
    env:                <EnvManager className="h-full" />,
    perf:               <PerformancePanel className="h-full" />,
    security:           <SecurityPanel className="h-full" />,
    api:                <ApiStudio className="h-full" />,
    db:                 <DatabaseStudio className="h-full" />,
    mobile:             <MobilePreview className="h-full" />,
    review:             <AIReviewPanel className="h-full" />,
    testgen:            <TestGeneratorPanel className="h-full" />,
    search:             <SemanticSearchPanel className="h-full" />,
    translate:          <CodeTranslatorPanel className="h-full" />,
    changelog:          <ChangelogPanel className="h-full" />,
    arch:               <ArchitecturePanel className="h-full" />,
    runtime:            <RuntimeMonitor className="h-full" />,
    a11y:               <AccessibilityPanel className="h-full" />,
    i18n:               <I18nPanel className="h-full" />,
    coverage:           <CoveragePanel className="h-full" />,
    scaffold:           <ScaffolderPanel className="h-full" />,
  };
  return <>{map[panel] ?? null}</>;
}
