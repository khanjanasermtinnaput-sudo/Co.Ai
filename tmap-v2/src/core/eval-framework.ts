// AI Evaluation Framework — 6-dimension LLM-scored evaluation + benchmark suite.
// Dimensions: TaskAdherence (20%) · CodeQuality (20%) · Correctness (25%) ·
//             Security (15%) · Completeness (15%) · Documentation (5%)
// Static signals (hallucination rate, verification failures) modify scores before
// the final weighted average is computed.

import type { LLMCall, Blackboard } from '../types.js';
import { detectHallucinations, type HallucinationReport } from './hallucination-detector.js';
import { verifyCodeFiles, type VerificationReport } from './verifier-agent.js';

export interface EvalDimension {
  name: string;
  weight: number;   // 0-1, all weights sum to 1.0
  score: number;    // 0-100 after penalty adjustments
  rawScore: number; // 0-100 from LLM before penalties
  notes: string[];
}

export interface EvalReport {
  sessionId: string;
  task: string;
  dimensions: EvalDimension[];
  overallScore: number;
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F';
  passed: boolean;         // overall >= 70
  executionTimeMs: number;
  hallucinationReport?: HallucinationReport;
  verificationReport?: VerificationReport;
  summary: string;
  recommendations: string[];
  timestamp: string;
}

export interface BenchmarkTask {
  task: string;
  expectedKeywords?: string[];   // must appear in combined output
  forbiddenPatterns?: string[];  // must NOT appear
}

export interface BenchmarkResult {
  task: string;
  evalReport: EvalReport;
  passedKeywords: boolean;
  passedForbidden: boolean;
  overallPass: boolean;
  timestamp: string;
}

export interface BenchmarkSuite {
  results: BenchmarkResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
    passRate: number;
    executionTimeMs: number;
  };
  timestamp: string;
}

// ── Dimension configuration ───────────────────────────────────────────────────

const DIMENSIONS = [
  { name: 'task_adherence', weight: 0.20 },
  { name: 'code_quality',   weight: 0.20 },
  { name: 'correctness',    weight: 0.25 },
  { name: 'security',       weight: 0.15 },
  { name: 'completeness',   weight: 0.15 },
  { name: 'documentation',  weight: 0.05 },
] as const;

type DimName = typeof DIMENSIONS[number]['name'];

const EVAL_SYS = `You are the Coagentix AI Evaluation Engine.
Score the generated output across 6 dimensions (each 0-100):

1. task_adherence  (20%): Does output match exactly what was requested?
2. code_quality    (20%): Well-structured, readable, idiomatic, follows best practices?
3. correctness     (25%): Logic, data, and implementation factually correct? No visible bugs?
4. security        (15%): No injection, secrets exposure, unsafe APIs, missing validation?
5. completeness    (15%): All required parts present? Edge cases handled?
6. documentation   (5%):  Sufficient comments? Named clearly? Understandable?

Output JSON ONLY (no markdown fences, no preamble):
{
  "task_adherence": { "score": 0-100, "notes": ["<note>"] },
  "code_quality":   { "score": 0-100, "notes": ["<note>"] },
  "correctness":    { "score": 0-100, "notes": ["<note>"] },
  "security":       { "score": 0-100, "notes": ["<note>"] },
  "completeness":   { "score": 0-100, "notes": ["<note>"] },
  "documentation":  { "score": 0-100, "notes": ["<note>"] },
  "recommendations": ["<actionable recommendation>"]
}`;

function scoreToGrade(score: number): 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 78) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

function defaultDimensions(): EvalDimension[] {
  return DIMENSIONS.map(({ name, weight }) => ({
    name,
    weight,
    score: 70,
    rawScore: 70,
    notes: [],
  }));
}

// ── Core evaluation function ──────────────────────────────────────────────────

export async function evaluateOutput(
  call: LLMCall,
  bb: Blackboard,
  opts: { includeHallucination?: boolean; includeVerification?: boolean } = {},
): Promise<EvalReport> {
  const startMs = Date.now();

  const outputText = bb.files.length > 0
    ? bb.files.map((f) => `=== ${f.path} ===\n${f.content.slice(0, 700)}`).join('\n\n')
    : bb.reviewText || '(no code output)';

  const hallucinationReport: HallucinationReport | undefined =
    opts.includeHallucination !== false && bb.files.length > 0
      ? detectHallucinations(bb.files)
      : undefined;

  const verificationReport: VerificationReport | undefined =
    opts.includeVerification !== false && bb.files.length > 0
      ? verifyCodeFiles(bb.files)
      : undefined;

  let dimensions = defaultDimensions();
  let recommendations: string[] = [];

  try {
    const raw = await call([
      { role: 'system', content: EVAL_SYS },
      {
        role: 'user',
        content: `Task: ${bb.task}\n\n` +
          `Context: ${bb.files.length} file(s) generated in ${bb.iterations} iteration(s)\n\n` +
          `Output:\n${outputText}`,
      },
    ], { temperature: 0.1, maxTokens: 1000 });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      recommendations = Array.isArray(parsed.recommendations)
        ? (parsed.recommendations as unknown[]).map(String)
        : [];

      dimensions = DIMENSIONS.map(({ name, weight }) => {
        const v = parsed[name] as { score?: unknown; notes?: unknown } | undefined;
        const rawScore = Math.max(0, Math.min(100, Number(v?.score ?? 70)));
        return {
          name,
          weight,
          score: rawScore,
          rawScore,
          notes: Array.isArray(v?.notes) ? (v.notes as unknown[]).map(String) : [],
        };
      });
    }
  } catch { /* use defaults */ }

  // Apply penalties for hallucinations and verification failures
  if (hallucinationReport?.detected) {
    const highCount = hallucinationReport.issues.filter((i) => i.severity === 'HIGH').length;
    const medCount  = hallucinationReport.issues.filter((i) => i.severity === 'MED').length;
    const penalty   = Math.min(30, highCount * 15 + medCount * 5);
    const dim = dimensions.find((d) => d.name === 'correctness');
    if (dim && penalty > 0) {
      dim.score = Math.max(0, dim.score - penalty);
      dim.notes.push(`Hallucination penalty: -${penalty}pt (${hallucinationReport.summary})`);
    }
  }

  if (verificationReport && !verificationReport.passed) {
    const highCount = verificationReport.issues.filter((i) => i.severity === 'HIGH').length;
    const penalty   = Math.min(20, highCount * 10);
    const dim = dimensions.find((d) => d.name === 'code_quality');
    if (dim && penalty > 0) {
      dim.score = Math.max(0, dim.score - penalty);
      dim.notes.push(`Verification penalty: -${penalty}pt (${verificationReport.summary})`);
    }
  }

  const overallScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  const executionTimeMs = Date.now() - startMs;

  return {
    sessionId: bb.sessionId,
    task: bb.task,
    dimensions,
    overallScore,
    grade: scoreToGrade(overallScore),
    passed: overallScore >= 70,
    executionTimeMs,
    hallucinationReport,
    verificationReport,
    summary: `Score ${overallScore}/100 (${scoreToGrade(overallScore)}) · ${bb.files.length} file(s) · ${bb.iterations} iteration(s) · ${executionTimeMs}ms`,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

// ── Benchmark helpers ─────────────────────────────────────────────────────────

export function checkExpectedKeywords(files: CodeFile[], keywords: string[]): boolean {
  const combined = files.map((f) => f.content).join('\n').toLowerCase();
  return keywords.every((k) => combined.includes(k.toLowerCase()));
}

export function checkForbiddenPatterns(files: CodeFile[], patterns: string[]): boolean {
  const combined = files.map((f) => f.content).join('\n');
  return patterns.every((p) => !combined.includes(p));
}

// ── Default benchmark tasks ───────────────────────────────────────────────────

export const DEFAULT_BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    task: 'Create a TypeScript function that validates an email address using regex',
    expectedKeywords: ['function', 'email', 'regex'],
    forbiddenPatterns: ['TODO', 'placeholder'],
  },
  {
    task: 'Write an Express.js route handler that returns a user by ID with proper 404 error handling',
    expectedKeywords: ['router', 'req', 'res', '404'],
    forbiddenPatterns: ['TODO'],
  },
  {
    task: 'Implement a debounce utility function in TypeScript with proper types',
    expectedKeywords: ['function', 'timeout', 'clearTimeout'],
    forbiddenPatterns: [],
  },
  {
    task: 'Create a SQL query to find the top 10 users by total purchase amount with proper JOINs',
    expectedKeywords: ['SELECT', 'JOIN', 'ORDER BY', 'LIMIT'],
    forbiddenPatterns: [],
  },
  {
    task: 'Write a React component that shows a loading spinner while data is being fetched',
    expectedKeywords: ['return', 'loading'],
    forbiddenPatterns: ['TODO'],
  },
];

// CodeFile type alias for use in this module
interface CodeFile { content: string; path?: string }

// ── Benchmark runner ──────────────────────────────────────────────────────────

/**
 * Run a benchmark suite. The caller provides a `runTask` function that
 * executes a TMAP run for each task and returns the resulting blackboard.
 */
export async function runBenchmarkSuite(
  runTask: (task: string) => Promise<{ bb: Blackboard; call: LLMCall }>,
  tasks: BenchmarkTask[] = DEFAULT_BENCHMARK_TASKS,
): Promise<BenchmarkSuite> {
  const startMs = Date.now();
  const results: BenchmarkResult[] = [];

  for (const bt of tasks) {
    try {
      const { bb, call } = await runTask(bt.task);
      const evalReport = await evaluateOutput(call, bb, {
        includeHallucination: true,
        includeVerification: true,
      });

      const passedKeywords = !bt.expectedKeywords?.length ||
        checkExpectedKeywords(bb.files as CodeFile[], bt.expectedKeywords);
      const passedForbidden = !bt.forbiddenPatterns?.length ||
        checkForbiddenPatterns(bb.files as CodeFile[], bt.forbiddenPatterns);

      results.push({
        task: bt.task,
        evalReport,
        passedKeywords,
        passedForbidden,
        overallPass: evalReport.passed && passedKeywords && passedForbidden,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const emptyBb = {
        sessionId: 'benchmark', task: bt.task, mode: 'normal' as const,
        context: '', plan: [], planText: '', files: [], review: [],
        reviewText: '', validations: [], iterations: 0, log: [],
      };
      results.push({
        task: bt.task,
        evalReport: {
          sessionId: 'benchmark', task: bt.task, dimensions: [],
          overallScore: 0, grade: 'F', passed: false, executionTimeMs: 0,
          summary: `Task failed: ${(e as Error).message}`,
          recommendations: [], timestamp: new Date().toISOString(),
        },
        passedKeywords: false,
        passedForbidden: false,
        overallPass: false,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const passed = results.filter((r) => r.overallPass).length;
  const avgScore = results.length
    ? Math.round(results.reduce((s, r) => s + r.evalReport.overallScore, 0) / results.length)
    : 0;

  return {
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      avgScore,
      passRate: results.length ? Math.round((passed / results.length) * 100) : 0,
      executionTimeMs: Date.now() - startMs,
    },
    timestamp: new Date().toISOString(),
  };
}
