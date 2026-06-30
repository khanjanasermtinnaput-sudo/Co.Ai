// ── Deployment Engine (Phase 31) ─────────────────────────────────────────────
// Detects project framework/target, generates deploy configs, tracks deploy status.

export type DeployTarget = "vercel" | "netlify" | "railway" | "cloudflare" | "github-pages";
export type DeployStatus = "idle" | "building" | "deploying" | "success" | "failed";

export interface DeployConfig {
  target: DeployTarget;
  buildCommand: string;
  outputDir: string;
  envVars: Record<string, string>;
  nodeVersion: string;
  installCommand: string;
}

export interface DeployLog {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface DeployResult {
  status: DeployStatus;
  url: string | null;
  deployId: string | null;
  logs: DeployLog[];
  duration: number;
  error: string | null;
}

// ── Framework detection → suggested config ────────────────────────────────────

export function detectDeployConfig(
  files: Array<{ path: string; content: string }>,
  projectMap?: Record<string, unknown> | null,
): DeployConfig {
  const hasPkg = files.find((f) => f.path === "package.json");
  const pkg = hasPkg ? (() => { try { return JSON.parse(hasPkg.content); } catch { return {}; } })() as Record<string, unknown> : {};
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;

  const isNext = "next" in deps;
  const isVite = "vite" in deps;
  const isCRA = "react-scripts" in deps;
  const isNuxt = "nuxt" in deps;
  const isSvelte = "svelte" in deps;
  const isAstro = "astro" in deps;
  const isRemix = "@remix-run/react" in deps || "@remix-run/node" in deps;
  const isStatic = !hasPkg || (!isNext && !isVite && !isCRA && !isNuxt && !isSvelte && !isAstro && !isRemix);

  // Default output dirs
  let buildCmd = scripts["build"] ?? "npm run build";
  let outputDir = ".next";
  let target: DeployTarget = "vercel";

  if (isNext) { outputDir = ".next"; target = "vercel"; }
  else if (isVite) { outputDir = "dist"; target = "netlify"; buildCmd = buildCmd || "vite build"; }
  else if (isCRA) { outputDir = "build"; target = "netlify"; }
  else if (isNuxt) { outputDir = ".output"; target = "vercel"; }
  else if (isSvelte) { outputDir = "build"; target = "cloudflare"; }
  else if (isAstro) { outputDir = "dist"; target = "cloudflare"; }
  else if (isRemix) { outputDir = "public/build"; target = "railway"; }
  else if (isStatic) { outputDir = "."; target = "github-pages"; buildCmd = ""; }

  const nodeVersion = (pkg.engines as Record<string, string> | undefined)?.node?.replace(/[^0-9.]/g, "") ?? "20";

  return {
    target,
    buildCommand: buildCmd,
    outputDir,
    envVars: {},
    nodeVersion,
    installCommand: "package-lock.json" in Object.fromEntries(files.map((f) => [f.path, 1]))
      ? "npm ci"
      : "npm install",
  };
}

// ── CI/CD YAML generators (Phase 32) ─────────────────────────────────────────

export type CICDTarget = "github-actions" | "gitlab-ci" | "circleci" | "bitbucket";

export interface CICDConfig {
  target: CICDTarget;
  triggers: Array<"push" | "pr" | "schedule">;
  steps: Array<"install" | "lint" | "typecheck" | "test" | "build" | "deploy">;
  deployTarget: DeployTarget | null;
}

export function generateGitHubActions(
  config: CICDConfig,
  deployConfig: DeployConfig,
): string {
  const stepMap: Record<string, string> = {
    install: `      - name: Install dependencies\n        run: ${deployConfig.installCommand}`,
    lint: `      - name: Lint\n        run: npm run lint`,
    typecheck: `      - name: Type check\n        run: npm run typecheck`,
    test: `      - name: Test\n        run: npm test -- --watchAll=false`,
    build: `      - name: Build\n        run: ${deployConfig.buildCommand}`,
    deploy: config.deployTarget === "vercel"
      ? `      - name: Deploy to Vercel\n        uses: amondnet/vercel-action@v25\n        with:\n          vercel-token: \${{ secrets.VERCEL_TOKEN }}\n          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}\n          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}\n          working-directory: ./`
      : config.deployTarget === "netlify"
      ? `      - name: Deploy to Netlify\n        uses: nwtgck/actions-netlify@v3\n        with:\n          publish-dir: './${deployConfig.outputDir}'\n          production-branch: main\n        env:\n          NETLIFY_AUTH_TOKEN: \${{ secrets.NETLIFY_AUTH_TOKEN }}\n          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_SITE_ID }}`
      : `      - name: Deploy\n        run: echo "Configure deployment target in workflow"`,
  };

  const triggerMap: Record<string, string> = {
    push: "    - main\n    - master",
    pr: "",
    schedule: "  schedule:\n    - cron: '0 0 * * 0'",
  };

  const onPush = config.triggers.includes("push");
  const onPR = config.triggers.includes("pr");

  const on = [
    onPush ? `  push:\n    branches:\n${triggerMap.push}` : "",
    onPR ? `  pull_request:\n    branches:\n      - main` : "",
    config.triggers.includes("schedule") ? triggerMap.schedule : "",
  ].filter(Boolean).join("\n");

  const steps = config.steps.map((s) => stepMap[s] ?? "").filter(Boolean).join("\n");

  return `name: CI/CD Pipeline

on:
${on}

env:
  NODE_VERSION: '${deployConfig.nodeVersion}'

jobs:
  ci:
    name: Build & Deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
          cache: 'npm'

${steps}
`;
}

export function generateGitLabCI(config: CICDConfig, deployConfig: DeployConfig): string {
  return `image: node:${deployConfig.nodeVersion}

cache:
  paths:
    - node_modules/

stages:
  - install
  - test
  - build
  - deploy

install:
  stage: install
  script:
    - ${deployConfig.installCommand}

${config.steps.includes("lint") ? `lint:\n  stage: test\n  script:\n    - npm run lint` : ""}

${config.steps.includes("test") ? `test:\n  stage: test\n  script:\n    - npm test -- --watchAll=false` : ""}

build:
  stage: build
  script:
    - ${deployConfig.buildCommand}
  artifacts:
    paths:
      - ${deployConfig.outputDir}/

deploy:
  stage: deploy
  script:
    - echo "Configure deployment in .env.ci"
  only:
    - main
`;
}
