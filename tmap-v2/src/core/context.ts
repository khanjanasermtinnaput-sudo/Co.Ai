// Project Context Engine — reads existing codebase info and passes it to Planner.
// Scans for package.json, pyproject.toml, go.mod, tsconfig.json, etc.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

export interface ProjectContext {
  type: 'node' | 'python' | 'go' | 'rust' | 'unknown';
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
  existingFiles: string[];
  techStack: string;
  summary: string;
}

/** Scan `rootDir` (default cwd) and return project context for the Planner. */
export function gatherProjectContext(rootDir = process.cwd()): ProjectContext {
  const ctx: ProjectContext = {
    type: 'unknown',
    dependencies: [],
    devDependencies: [],
    scripts: {},
    existingFiles: [],
    techStack: '',
    summary: '',
  };

  // Node.js / TypeScript
  const pkgPath = join(rootDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      ctx.type = 'node';
      ctx.dependencies = Object.keys(pkg.dependencies ?? {});
      ctx.devDependencies = Object.keys(pkg.devDependencies ?? {});
      ctx.scripts = pkg.scripts ?? {};
      const hasTsc = existsSync(join(rootDir, 'tsconfig.json')) || ctx.devDependencies.includes('typescript');
      ctx.techStack = hasTsc ? 'Node.js + TypeScript' : 'Node.js';
      if (ctx.dependencies.includes('react')) ctx.techStack += ' + React';
      if (ctx.dependencies.includes('next')) ctx.techStack += ' + Next.js';
      if (ctx.dependencies.includes('express')) ctx.techStack += ' + Express';
    } catch { /* ignore malformed */ }
  }

  // Python
  const pyprojectPath = join(rootDir, 'pyproject.toml');
  const requirementsPath = join(rootDir, 'requirements.txt');
  if (existsSync(pyprojectPath) || existsSync(requirementsPath)) {
    ctx.type = 'python';
    ctx.techStack = 'Python';
    if (existsSync(requirementsPath)) {
      const lines = readFileSync(requirementsPath, 'utf8').split('\n').filter(Boolean);
      ctx.dependencies = lines.map((l) => l.split(/[=><!]/)[0].trim()).filter(Boolean);
      if (ctx.dependencies.includes('fastapi')) ctx.techStack += ' + FastAPI';
      if (ctx.dependencies.includes('django')) ctx.techStack += ' + Django';
      if (ctx.dependencies.includes('flask')) ctx.techStack += ' + Flask';
    }
  }

  // Go
  const gomodPath = join(rootDir, 'go.mod');
  if (existsSync(gomodPath)) {
    ctx.type = 'go';
    ctx.techStack = 'Go';
    try {
      const gomod = readFileSync(gomodPath, 'utf8');
      const matches = gomod.matchAll(/^\s+(\S+)\s+v[\d.]+/gm);
      ctx.dependencies = [...matches].map((m) => m[1]);
    } catch { /* ignore */ }
  }

  // Rust
  const cargoPath = join(rootDir, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    ctx.type = 'rust';
    ctx.techStack = 'Rust';
  }

  // Scan existing source files (max 200, skip node_modules/.git/dist)
  ctx.existingFiles = scanFiles(rootDir, 200);

  ctx.summary = buildSummary(ctx);
  return ctx;
}

function scanFiles(dir: string, max: number, current: string[] = [], depth = 0): string[] {
  if (depth > 4 || current.length >= max) return current;
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.nexora', '.nexora-server', '__pycache__', '.next', 'coverage']);
  try {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          scanFiles(full, max, current, depth + 1);
        } else if (isSourceFile(entry)) {
          current.push(full.replace(process.cwd() + '/', ''));
        }
      } catch { /* skip inaccessible */ }
      if (current.length >= max) break;
    }
  } catch { /* skip unreadable */ }
  return current;
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.vue', '.svelte', '.sql']);

function isSourceFile(name: string): boolean {
  return SOURCE_EXTS.has(extname(name)) || ['Dockerfile', 'Makefile', 'CMakeLists.txt'].includes(basename(name));
}

function buildSummary(ctx: ProjectContext): string {
  if (ctx.type === 'unknown') return '';
  const lines: string[] = [];
  lines.push(`Tech Stack: ${ctx.techStack}`);
  if (ctx.dependencies.length) lines.push(`Dependencies: ${ctx.dependencies.slice(0, 20).join(', ')}`);
  if (Object.keys(ctx.scripts).length) {
    lines.push(`Scripts: ${Object.entries(ctx.scripts).map(([k, v]) => `${k}="${v}"`).slice(0, 8).join(', ')}`);
  }
  if (ctx.existingFiles.length) {
    lines.push(`Existing files (${ctx.existingFiles.length} total): ${ctx.existingFiles.slice(0, 30).join(', ')}`);
  }
  return lines.join('\n');
}
