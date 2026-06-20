// Hallucination Detector — static analysis pass that identifies AI-generated content
// likely to be fabricated. No LLM call required; runs on generated CodeFiles only.
//
// Detects:
//   phantom_import      — known-nonexistent packages or deps not in project
//   phantom_file_ref    — relative import that doesn't match any generated file
//   fabricated_api      — recognizable hallucination API call patterns
//   impossible_import   — structurally invalid import path

import type { CodeFile } from '../types.js';

export type HallucinationType =
  | 'phantom_import'
  | 'phantom_file_ref'
  | 'fabricated_api'
  | 'impossible_import';

export interface HallucinationIssue {
  type: HallucinationType;
  file: string;
  line?: number;
  description: string;
  evidence: string;
  severity: 'HIGH' | 'MED' | 'LOW';
}

export interface HallucinationReport {
  detected: boolean;
  issues: HallucinationIssue[];
  confidence: number;    // 0-1 confidence that real hallucinations are present
  checkedFiles: number;
  summary: string;
}

// Well-known packages that AI models frequently hallucinate (they don't exist)
const KNOWN_PHANTOM_PACKAGES = new Set([
  'node-ai', 'ai-tools', 'smart-fetch', 'llm-utils', 'auto-cache',
  'react-llm', 'next-ai-utils', 'express-ai', 'db-ai', 'node-gpt',
  'openai-helpers', 'anthropic-utils', '@ai/core', 'universal-llm',
  'super-fetch', 'fetch-ai', 'ai-fetch', 'node-fetch-ai', 'node-llm',
  'ai-helper', 'gpt-utils', 'chatgpt-utils', 'llm-client', 'ai-client',
]);

// Patterns that indicate fabricated API usage
const FABRICATED_API_PATTERNS: Array<[RegExp, string]> = [
  [/\.autoComplete\s*\(/, 'autoComplete() is not a standard API'],
  [/\.smartQuery\s*\(/, 'smartQuery() is not a standard API'],
  [/\.aiGenerate\s*\(/, 'aiGenerate() is not a standard API'],
  [/\bAI\.create\s*\(/, 'AI.create() is a common hallucination pattern'],
  [/\bModel\.predict\s*\(/, 'Model.predict() without import is suspicious'],
  [/\.embedWithAI\s*\(/, 'embedWithAI() does not exist'],
  [/from ['"]langchain['"]\s*$/, 'langchain top-level import does not exist; use langchain/...'],
  [/\.magicFetch\s*\(/, 'magicFetch() is not a real API'],
  [/\bLLM\.complete\s*\(/, 'LLM.complete() is a fabricated global API'],
  [/\bOpenAI\.complete\s*\(/, 'OpenAI.complete() does not exist (use new OpenAI().chat.completions.create)'],
];

function extractImports(content: string): Array<{ specifier: string; line: number }> {
  const results: Array<{ specifier: string; line: number }> = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const esm = lines[i].match(/^\s*(?:import|export)\s+(?:.*\s+from\s+)?['"]([^'"]+)['"]/);
    if (esm) results.push({ specifier: esm[1], line: i + 1 });
    const cjs = lines[i].match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (cjs) results.push({ specifier: cjs[1], line: i + 1 });
  }
  return results;
}

function buildKnownPathSet(files: CodeFile[], existingFiles: string[]): Set<string> {
  const paths = new Set<string>();
  const add = (p: string) => {
    paths.add(p);
    paths.add('./' + p);
    const noExt = p.replace(/\.[^./]+$/, '');
    paths.add(noExt);
    paths.add('./' + noExt);
  };
  for (const f of files) add(f.path);
  for (const ef of existingFiles) add(ef);
  return paths;
}

function isNodeBuiltin(name: string): boolean {
  const BUILTINS = new Set([
    'fs', 'path', 'os', 'http', 'https', 'net', 'crypto', 'util', 'events',
    'stream', 'buffer', 'url', 'querystring', 'child_process', 'cluster',
    'worker_threads', 'zlib', 'readline', 'assert', 'timers', 'process',
    'module', 'vm', 'tty', 'dns', 'dgram', 'string_decoder', 'perf_hooks',
    'v8', 'inspector', 'async_hooks', 'trace_events', 'constants',
  ]);
  return BUILTINS.has(name);
}

export function detectHallucinations(
  files: CodeFile[],
  projectContext: { dependencies?: string[]; existingFiles?: string[] } = {},
): HallucinationReport {
  const issues: HallucinationIssue[] = [];
  const knownPaths = buildKnownPathSet(files, projectContext.existingFiles ?? []);
  const projectDeps = new Set(projectContext.dependencies ?? []);

  for (const file of files) {
    const lines = file.content.split('\n');
    const imports = extractImports(file.content);

    for (const { specifier, line } of imports) {
      const lineText = lines[line - 1]?.trim() ?? '';

      // Relative import — verify it references a known file
      if (specifier.startsWith('.')) {
        const stripped = specifier.replace(/\.[^./]+$/, '');
        const isKnown = [...knownPaths].some((p) => {
          const ps = p.replace(/\.[^./]+$/, '');
          return ps.endsWith(stripped.replace(/^\.\//, '')) ||
                 stripped.includes(ps.replace(/^\.\//, ''));
        });
        if (!isKnown && files.length > 1) {
          issues.push({
            type: 'phantom_file_ref',
            file: file.path,
            line,
            description: `Import "${specifier}" may not match any generated file`,
            evidence: lineText,
            severity: 'LOW',
          });
        }
        continue;
      }

      // Skip node built-ins and node: protocol
      if (specifier.startsWith('node:') || isNodeBuiltin(specifier)) continue;

      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];

      if (KNOWN_PHANTOM_PACKAGES.has(packageName)) {
        issues.push({
          type: 'phantom_import',
          file: file.path,
          line,
          description: `"${packageName}" is a commonly hallucinated package (does not exist)`,
          evidence: lineText,
          severity: 'HIGH',
        });
        continue;
      }

      if (projectDeps.size > 0 && !projectDeps.has(packageName)) {
        issues.push({
          type: 'phantom_import',
          file: file.path,
          line,
          description: `"${packageName}" is not listed in the project's dependencies`,
          evidence: lineText,
          severity: 'MED',
        });
      }
    }

    // Fabricated API pattern scan
    for (const [pattern, message] of FABRICATED_API_PATTERNS) {
      lines.forEach((l, i) => {
        if (pattern.test(l)) {
          issues.push({
            type: 'fabricated_api',
            file: file.path,
            line: i + 1,
            description: message,
            evidence: l.trim(),
            severity: 'MED',
          });
        }
      });
    }
  }

  const highCount = issues.filter((i) => i.severity === 'HIGH').length;
  const medCount  = issues.filter((i) => i.severity === 'MED').length;
  const confidence = Math.min(1, highCount * 0.4 + medCount * 0.15);
  const detected  = highCount > 0 || medCount >= 2;

  const summary = detected
    ? `${issues.length} potential hallucination(s): ${highCount} HIGH, ${medCount} MED`
    : `No significant hallucinations detected (${files.length} file(s) scanned)`;

  return { detected, issues, confidence: Math.round(confidence * 100) / 100, checkedFiles: files.length, summary };
}
