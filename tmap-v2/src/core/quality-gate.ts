// Quality Gate — engineering-completeness checkpoint for Ypertatos High.
//
// NOT a reviewer (that's the Reviewer agent / review.ts) and NOT the
// score/retry LLM loop in review-gate.ts (that scores a single conversational
// answer). This is a pure, static, non-LLM check: does the implementation
// actually cover the plan, and does it contain placeholder/stub code. Fast
// and deterministic on purpose — coverage and "is this a TODO" are not
// judgment calls, and keeping this off the LLM avoids another expensive round
// trip on every correction cycle.

import ts from 'typescript';
import type { CodeFile, PlanStep, ValidationResult } from '../types.js';
import type { EngineeringDomain } from './engineering-classifier.js';

export type PlaceholderKind =
  | 'TODO'
  | 'FIXME'
  | 'NOT_IMPLEMENTED'
  | 'COMING_SOON'
  | 'EMPTY_FUNCTION'
  | 'MOCK'
  | 'PLACEHOLDER_UI';

export interface PlaceholderFinding {
  file: string;
  line: number;
  kind: PlaceholderKind;
  snippet: string;
}

export interface TaskCoverageEntry {
  taskId: string;
  file: string;
  domain?: EngineeringDomain;
  status: 'complete' | 'missing';
}

export interface EngineeringQualityReport {
  coveragePct: number;
  taskCoverage: TaskCoverageEntry[];
  placeholders: PlaceholderFinding[];
  missingFiles: string[];
  warnings: string[];
  criticalErrors: string[];
  minorErrors: string[];
  suggestedCorrections: string[];
  readyForValidation: boolean;
  cycle: number;
}

export interface QualityGateInput {
  plan: PlanStep[];
  files: CodeFile[];
  validations: ValidationResult[];
  domainByFile?: (path: string) => EngineeringDomain | undefined;
  cycle: number;
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/').toLowerCase();
}

// ── Coverage ──────────────────────────────────────────────────────────────────

function checkCoverage(
  plan: PlanStep[],
  files: CodeFile[],
  domainByFile?: (path: string) => EngineeringDomain | undefined,
): { taskCoverage: TaskCoverageEntry[]; missingFiles: string[]; coveragePct: number } {
  const producedPaths = new Set(files.map((f) => normalizePath(f.path)));
  const taskCoverage: TaskCoverageEntry[] = [];
  const missingFiles: string[] = [];

  for (const step of plan) {
    const present = producedPaths.has(normalizePath(step.file));
    taskCoverage.push({
      taskId: step.file,
      file: step.file,
      domain: domainByFile?.(step.file),
      status: present ? 'complete' : 'missing',
    });
    if (!present) missingFiles.push(step.file);
  }

  const coveragePct = plan.length === 0 ? 100 : Math.round(((plan.length - missingFiles.length) / plan.length) * 100);
  return { taskCoverage, missingFiles, coveragePct };
}

// ── Placeholder detection ────────────────────────────────────────────────────

const LINE_PATTERNS: Array<{ kind: PlaceholderKind; pattern: RegExp }> = [
  { kind: 'TODO', pattern: /\bTODO\b/ },
  { kind: 'FIXME', pattern: /\bFIXME\b/ },
  { kind: 'COMING_SOON', pattern: /coming soon/i },
  { kind: 'NOT_IMPLEMENTED', pattern: /not\s+implement(ed)?(\s+yet)?/i },
  { kind: 'NOT_IMPLEMENTED', pattern: /throw\s+new\s+Error\(\s*['"`].*(todo|not implemented).*['"`]\s*\)/i },
  { kind: 'MOCK', pattern: /\bmock(ed)?\s+(implementation|data|response)\b/i },
];

const FRONTEND_EXT = /\.(tsx|jsx)$/i;

function scanLinesForPlaceholders(file: CodeFile): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  const lines = file.content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { kind, pattern } of LINE_PATTERNS) {
      if (pattern.test(line)) {
        const resolvedKind: PlaceholderKind =
          FRONTEND_EXT.test(file.path) && (kind === 'COMING_SOON' || kind === 'NOT_IMPLEMENTED')
            ? 'PLACEHOLDER_UI'
            : kind;
        findings.push({ file: file.path, line: i + 1, kind: resolvedKind, snippet: line.trim().slice(0, 160) });
        break; // one finding per line is enough signal
      }
    }
  }
  return findings;
}

/** Walk a TS/TSX AST for function-like nodes whose body is a literally empty
 *  block — a stronger signal than regex for "stub function," and doesn't
 *  false-positive on legitimate strings containing the word "empty" etc. */
function scanEmptyFunctions(file: CodeFile): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch {
    return findings;
  }

  const visit = (node: ts.Node): void => {
    const isFunctionLike =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      (ts.isArrowFunction(node) && ts.isBlock(node.body));

    if (isFunctionLike) {
      const body = (node as ts.FunctionLikeDeclaration).body;
      if (body && ts.isBlock(body) && body.statements.length === 0) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        const name = (node as ts.FunctionLikeDeclaration).name?.getText(source) ?? '(anonymous)';
        findings.push({
          file: file.path,
          line: line + 1,
          kind: 'EMPTY_FUNCTION',
          snippet: `empty function body: ${name}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function detectPlaceholders(files: CodeFile[]): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  for (const file of files) {
    findings.push(...scanLinesForPlaceholders(file));
    if (file.language === 'typescript' || /\.tsx?$/i.test(file.path)) {
      findings.push(...scanEmptyFunctions(file));
    }
  }
  return findings;
}

// ── Gate ──────────────────────────────────────────────────────────────────────

export function runQualityGate(input: QualityGateInput): EngineeringQualityReport {
  const { taskCoverage, missingFiles, coveragePct } = checkCoverage(input.plan, input.files, input.domainByFile);
  const placeholders = detectPlaceholders(input.files);

  const criticalErrors: string[] = [
    ...missingFiles.map((f) => `missing: planned file was never produced — ${f}`),
    ...placeholders.map((p) => `${p.kind} at ${p.file}:${p.line} — ${p.snippet}`),
  ];

  const failedValidations = input.validations.filter((v) => !v.passed);
  const minorErrors = failedValidations.map((v) => v.logs);

  const warnings: string[] = [];
  if (input.plan.length === 0) warnings.push('no plan was available to check coverage against');

  const suggestedCorrections: string[] = [
    ...missingFiles.map((f) => `generate the missing file: ${f}`),
    ...placeholders.map((p) => `replace the ${p.kind} at ${p.file}:${p.line} with a real implementation`),
  ];

  const readyForValidation = missingFiles.length === 0 && placeholders.length === 0;

  return {
    coveragePct,
    taskCoverage,
    placeholders,
    missingFiles,
    warnings,
    criticalErrors,
    minorErrors,
    suggestedCorrections,
    readyForValidation,
    cycle: input.cycle,
  };
}
