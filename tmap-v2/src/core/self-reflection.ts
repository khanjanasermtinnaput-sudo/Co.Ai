// Self Reflection Engine — Co.AI Master Prompt v1.0 Part 5.11.
//
// Extreme-only, final engineering inspection that runs after Validator and
// before Review. It is NOT another planning stage and NOT another
// implementation stage — it is a read-only structural inspection that
// produces an Engineering Reflection Report. Like Quality Gate
// (core/quality-gate.ts), this is pure and non-LLM on purpose: architectural/
// security/performance smells are cheap, deterministic pattern checks, and
// keeping this off the LLM avoids yet another expensive round trip on a tier
// that is already the most expensive one available.
//
// Per spec: "Reflection may improve implementation. Reflection must not
// redesign the project." This engine only reports findings — it never
// mutates files or triggers a regeneration loop (Quality Gate already owns
// the correction loop, earlier in the pipeline).

import type { CodeFile, PlanStep, EngineeringReflectionReport, ReflectionFinding } from '../types.js';
import type { EngineeringDomain } from './engineering-classifier.js';
import type { EngineeringQualityReport } from './quality-gate.js';

export interface SelfReflectionInput {
  files: CodeFile[];
  plan: PlanStep[];
  domains: EngineeringDomain[];
  /** Quality Gate's own report, when available — reused rather than
   *  re-deriving coverage so the two stages never disagree. */
  qualityGate?: EngineeringQualityReport;
  domainByFile?: (path: string) => EngineeringDomain | undefined;
}

const LARGE_FILE_LINES = 400;
const LONG_LINE_CHARS = 140;
const LONG_LINE_DENSITY_THRESHOLD = 0.15; // fraction of lines over LONG_LINE_CHARS to flag a file

function lineCount(content: string): number {
  return content.split('\n').length;
}

// ── Requirement Coverage ─────────────────────────────────────────────────────

function requirementCoverageFindings(input: SelfReflectionInput): ReflectionFinding[] {
  const { qualityGate } = input;
  if (!qualityGate) return [];
  return qualityGate.missingFiles.map((f) => ({
    category: 'requirement-coverage' as const,
    file: f,
    severity: 'critical' as const,
    message: `planned file was never produced (coverage ${qualityGate.coveragePct}%) — overlooked requirement`,
  }));
}

// ── Architecture: a file whose content looks like it belongs to a different
// domain than its path suggests — a cheap "mixed responsibility" signal. ────

const DOMAIN_CONTENT_SIGNS: Partial<Record<EngineeringDomain, RegExp>> = {
  database: /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i,
  frontend: /<[a-zA-Z][^>]*>[\s\S]*<\/[a-zA-Z]+>|useState\(|useEffect\(/,
};

function architectureFindings(files: CodeFile[], domainByFile?: (path: string) => EngineeringDomain | undefined): ReflectionFinding[] {
  if (!domainByFile) return [];
  const findings: ReflectionFinding[] = [];
  for (const file of files) {
    const expected = domainByFile(file.path);
    if (!expected) continue;
    for (const [domain, sign] of Object.entries(DOMAIN_CONTENT_SIGNS) as [EngineeringDomain, RegExp][]) {
      if (domain === expected) continue;
      if (sign.test(file.content)) {
        findings.push({
          category: 'architecture',
          file: file.path,
          severity: 'warning',
          message: `file classified as '${expected}' contains ${domain}-shaped code — possible mixed responsibility`,
        });
        break;
      }
    }
  }
  return findings;
}

// ── Security ──────────────────────────────────────────────────────────────────

const SECURITY_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\beval\s*\(/, message: 'eval() executes arbitrary strings as code — a common injection vector' },
  { pattern: /rejectUnauthorized\s*:\s*false/, message: 'TLS certificate verification disabled (rejectUnauthorized: false)' },
  {
    pattern: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9+/_.-]{8,}['"]/i,
    message: 'possible hardcoded credential/secret literal — use environment variables instead',
  },
  {
    pattern: /(SELECT|INSERT|UPDATE|DELETE)\b[^;]{0,200}['"]\s*\+\s*[a-zA-Z_$]/i,
    message: 'SQL string concatenation — use parameterized queries to avoid SQL injection',
  },
];

function securityFindings(files: CodeFile[]): ReflectionFinding[] {
  const findings: ReflectionFinding[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, message } of SECURITY_PATTERNS) {
        if (pattern.test(lines[i])) {
          findings.push({ category: 'security', file: file.path, line: i + 1, severity: 'critical', message });
        }
      }
    }
  }
  return findings;
}

// ── Performance ───────────────────────────────────────────────────────────────

const SERVER_PATH = /\b(server|routes?|controllers?|api)\//i;

function performanceFindings(files: CodeFile[]): ReflectionFinding[] {
  const findings: ReflectionFinding[] = [];
  for (const file of files) {
    if (SERVER_PATH.test(file.path) && /\bfs\.(readFileSync|writeFileSync|existsSync)\b/.test(file.content)) {
      findings.push({
        category: 'performance', file: file.path, severity: 'warning',
        message: 'synchronous filesystem call in a server/request path can block the event loop under load',
      });
    }
    if (/JSON\.parse\(\s*JSON\.stringify\(/.test(file.content)) {
      findings.push({
        category: 'performance', file: file.path, severity: 'warning',
        message: 'JSON.parse(JSON.stringify(...)) deep-clone is slow on large objects — prefer structuredClone or a targeted copy',
      });
    }
  }
  return findings;
}

// ── Maintainability ───────────────────────────────────────────────────────────

function maintainabilityFindings(files: CodeFile[]): ReflectionFinding[] {
  const findings: ReflectionFinding[] = [];
  for (const file of files) {
    const lines = lineCount(file.content);
    if (lines > LARGE_FILE_LINES) {
      findings.push({
        category: 'maintainability', file: file.path, severity: 'warning',
        message: `file is ${lines} lines — consider splitting into smaller, single-responsibility modules`,
      });
    }
  }
  return findings;
}

// ── Scalability ───────────────────────────────────────────────────────────────

const MODULE_LEVEL_STATE = /^(export\s+)?const\s+\w+\s*[:=]\s*(new Map\(|new Set\(|\[\]|\{\})/m;

function scalabilityFindings(files: CodeFile[]): ReflectionFinding[] {
  const findings: ReflectionFinding[] = [];
  for (const file of files) {
    if (SERVER_PATH.test(file.path) && MODULE_LEVEL_STATE.test(file.content)) {
      findings.push({
        category: 'scalability', file: file.path, severity: 'info',
        message: 'module-level in-memory collection used as state — will not survive a restart or scale across multiple instances',
      });
    }
  }
  return findings;
}

// ── Reliability ───────────────────────────────────────────────────────────────

function reliabilityFindings(files: CodeFile[]): ReflectionFinding[] {
  const findings: ReflectionFinding[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\.then\s*\(/.test(lines[i]) && !/\.catch\s*\(/.test(lines.slice(i, i + 3).join('\n'))) {
        findings.push({
          category: 'reliability', file: file.path, line: i + 1, severity: 'info',
          message: 'promise chain with no nearby .catch() — an unhandled rejection here fails silently',
        });
      }
    }
  }
  return findings;
}

// ── Readability ───────────────────────────────────────────────────────────────

function readabilityFindings(files: CodeFile[]): ReflectionFinding[] {
  const findings: ReflectionFinding[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    if (!lines.length) continue;
    const longLines = lines.filter((l) => l.length > LONG_LINE_CHARS).length;
    if (longLines / lines.length > LONG_LINE_DENSITY_THRESHOLD) {
      findings.push({
        category: 'readability', file: file.path, severity: 'info',
        message: `${longLines}/${lines.length} lines exceed ${LONG_LINE_CHARS} characters — consider wrapping for readability`,
      });
    }
  }
  return findings;
}

// ── Documentation / Testing (batch-level, not per-file) ──────────────────────

function documentationFindings(files: CodeFile[], domains: EngineeringDomain[]): ReflectionFinding[] {
  if (!domains.includes('documentation')) return [];
  const hasDocs = files.some((f) => /\.md$/i.test(f.path) || /readme/i.test(f.path));
  if (hasDocs) return [];
  return [{
    category: 'documentation', file: '(batch)', severity: 'info',
    message: 'task was classified as touching documentation, but no README/markdown file was produced',
  }];
}

function testingFindings(files: CodeFile[], domains: EngineeringDomain[]): ReflectionFinding[] {
  if (domains.includes('testing')) return [];
  const hasTests = files.some((f) => /\.(test|spec)\.[jt]sx?$/.test(f.path) || /__tests__\//.test(f.path));
  if (hasTests || !files.length) return [];
  return [{
    category: 'testing', file: '(batch)', severity: 'info',
    message: 'no automated tests were generated for this change — consider a follow-up testing pass',
  }];
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export function runSelfReflection(input: SelfReflectionInput): EngineeringReflectionReport {
  const findings: ReflectionFinding[] = [
    ...requirementCoverageFindings(input),
    ...architectureFindings(input.files, input.domainByFile),
    ...securityFindings(input.files),
    ...performanceFindings(input.files),
    ...maintainabilityFindings(input.files),
    ...scalabilityFindings(input.files),
    ...reliabilityFindings(input.files),
    ...readabilityFindings(input.files),
    ...documentationFindings(input.files, input.domains),
    ...testingFindings(input.files, input.domains),
  ];

  const categoriesCovered = [...new Set(findings.map((f) => f.category))];
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  const summary = findings.length === 0
    ? 'reflection: no findings — implementation looks clean across all inspected categories'
    : `reflection: ${findings.length} finding(s) across ${categoriesCovered.length} categor${categoriesCovered.length === 1 ? 'y' : 'ies'} (${criticalCount} critical, ${warningCount} warning, ${infoCount} info)`;

  return { findings, categoriesCovered, criticalCount, warningCount, infoCount, summary };
}
