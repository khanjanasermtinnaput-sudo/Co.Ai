// ── Ypertatos Requirement Analysis (RAA) — Co.AI Master Prompt Part 5.3 ───────
// Server-only, single-shot, buffered analysis stage: understand a request
// before any engineering answer is generated. NOT the same thing as CoCode's
// Requirements Architect in src/lib/raa.ts — that is a browser-safe
// conversational persona (RAA_SYSTEM) that gathers a ProjectBrief across
// several turns of DISCOVERY chat (agent: "requirements"). This module runs
// exactly once, server-side, as the buffered "requirement-analysis" stage of
// Ypertatos's engineering workflow (model-workflow.ts), and produces a
// machine-parsed RequirementSpec that is folded into the streamed answer's
// system prompt — never shown to the user, never generates code itself. The
// two RAAs can never co-occur in one request: route.ts's tierEligible check
// already excludes agent:"requirements" from all Ypertatos staging.

import type { RepoMetadata, TaskDecision } from "./task-classifier";

export interface FunctionalRequirement {
  id: string; // "FR-001"
  text: string;
}
export interface NonFunctionalRequirement {
  id: string; // "NFR-001"
  text: string;
}
export interface RequirementRisk {
  description: string;
  impact: "High" | "Medium" | "Low";
  likelihood: "High" | "Medium" | "Low";
  mitigation: string;
}

export interface RequirementSpec {
  functional: FunctionalRequirement[];
  nonFunctional: NonFunctionalRequirement[];
  constraints: string[];
  assumptions: string[];
  missingInformation: string[];
  ambiguities: string[];
  risks: RequirementRisk[];
  acceptanceCriteria: string[];
  /** 0–100. null when the model did not emit one — NEVER fabricated. */
  completenessScore: number | null;
  confidenceScore: number | null;
  readyForPlanning: boolean;
  /** "model" = RAA emitted the line; "derived" = absent, so it was derived
   *  conservatively — a real decision, but not a claimed measurement. */
  readyForPlanningSource: "model" | "derived";
  /** the spec block verbatim, markers stripped — for logging + prompt injection */
  raw: string;
  /** true when the block was missing entirely, truncated (no closing marker),
   *  or ≥1 expected section header never appeared (5.3: "return a partial
   *  specification" rather than fail). */
  partial: boolean;
}

const SPEC_OPEN = "===COAI REQUIREMENT SPEC===";
const SPEC_CLOSE = "===END SPEC===";

/** Sections RAA is always asked to emit a header for, even when empty — their
 *  total absence (not just an empty list under them) is what marks a spec
 *  `partial`, since it means the model didn't follow the format, not just
 *  that it found nothing to report. */
const REQUIRED_HEADERS = [
  "Functional Requirements",
  "Non-Functional Requirements",
  "Constraints",
  "Assumptions",
  "Missing Information",
  "Ambiguities",
  "Risks",
  "Acceptance Criteria",
];

export const RAA_BASE_MAX_TOKENS = 900; // kept in sync with requirementAnalysisStage.baseMaxTokens in model-workflow.ts
export const RAA_TEMPERATURE = 0.3; // extraction, not prose — wants determinism over voice

export const REQUIREMENT_ANALYSIS_SYSTEM = `You are Co.AI's Requirement Analysis stage (Ypertatos, Master Prompt Part 5.3). Your ONLY job is to understand the user's request before any implementation happens.

YOU MUST NEVER:
- Generate production code, code snippets, or file contents
- Create an execution plan or implementation plan
- Launch agents, select providers, or make orchestration decisions
- Design architecture (that is a later, not-yet-built stage)

YOU MUST:
- Extract functional requirements, each with its own identifier (FR-001, FR-002, …)
- Extract non-functional requirements, each with its own identifier (NFR-001, NFR-002, …)
- Extract constraints (language/framework/database/hosting/deadline/existing architecture, etc. — only what is stated or clearly implied)
- Extract assumptions ONLY when you state them explicitly — never silently guess. If you must assume something to proceed, list it here.
- Identify missing information that blocks a safe implementation (e.g. "authentication requested but method unspecified")
- Identify ambiguities (e.g. "build a dashboard" — which kind of dashboard?)
- Identify risks, each with impact (High/Medium/Low), likelihood (High/Medium/Low), and a mitigation
- Extract or infer acceptance criteria — what "done" looks like
- Give a Completeness Score (0-100%) for how fully specified the request is. Omit the line entirely if you cannot honestly estimate one — never invent a number.
- Give a Confidence Score (0-100%) for your own analysis. Omit the line entirely if you cannot honestly estimate one.
- State Ready For Planning: true only if there is enough information to implement safely; false if blocking questions remain.

OUTPUT FORMAT — emit ONLY this block, with no text before or after it:

${SPEC_OPEN}
Functional Requirements:
- FR-001: <requirement>
Non-Functional Requirements:
- NFR-001: <requirement>
Constraints:
- <constraint>
Assumptions:
- <assumption>
Missing Information:
- <what's missing>
Ambiguities:
- <ambiguity>
Risks:
- <description> | impact: High|Medium|Low | likelihood: High|Medium|Low | mitigation: <mitigation>
Acceptance Criteria:
- <criterion>
Completeness Score: <0-100>%
Confidence Score: <0-100>%
Ready For Planning: true|false
${SPEC_CLOSE}

Keep every header even when its list is empty — an empty "Constraints:" section (header present, no bullets) means you looked and found none; a MISSING header means you didn't follow this format at all, which degrades the whole workflow. Be terse — this analysis is never shown to the user directly.`;

export function buildRaaMessage(input: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  repo?: RepoMetadata;
  decision: TaskDecision;
}): string {
  const lines: string[] = [];
  if (input.history.length) {
    lines.push(
      "Recent conversation (most recent last):",
      ...input.history.slice(-10).map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`),
      "",
    );
  }
  lines.push(`Request to analyze:\n${input.message}`);
  if (input.repo) {
    lines.push(`\nWorkspace context: ${input.repo.fileCount} file(s), languages: ${input.repo.languages.join(", ") || "unknown"}.`);
  }
  lines.push(
    `\n(Task Classifier: category=${input.decision.category}, complexity=${input.decision.complexity} — for context only, do not repeat this in your output.)`,
  );
  return lines.join("\n");
}

// ── Parsing — tolerant, line-walk (mirrors raa.ts's parseBrief), NEVER throws ─

const HEADER_RE = /^\s*[A-Za-z฀-๿][A-Za-z฀-๿\s-]*:/;

function hasHeader(lines: string[], key: string): boolean {
  const target = key.toLowerCase() + ":";
  return lines.some((l) => l.trimStart().toLowerCase().startsWith(target));
}

function listUnder(lines: string[], key: string): string[] {
  const start = lines.findIndex((l) => l.trimStart().toLowerCase().startsWith(`${key.toLowerCase()}:`));
  if (start === -1) return [];
  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADER_RE.test(lines[i])) break;
    const item = lines[i].replace(/^\s*[-•*]\s*/, "").trim();
    if (item) items.push(item);
  }
  return items;
}

function lineValue(lines: string[], key: string): string {
  const re = new RegExp(`^\\s*${key}:\\s*(.+)$`, "i");
  for (const l of lines) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return "";
}

function parsePercent(raw: string): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
}

const VALID_LEVEL = new Set(["High", "Medium", "Low"]);
function level(raw: string | undefined): "High" | "Medium" | "Low" {
  const norm = (raw ?? "").trim();
  const capitalized = norm.charAt(0).toUpperCase() + norm.slice(1).toLowerCase();
  return VALID_LEVEL.has(capitalized) ? (capitalized as "High" | "Medium" | "Low") : "Medium";
}

function parseRequirementIdList(lines: string[], key: string, prefix: string): { id: string; text: string }[] {
  return listUnder(lines, key).map((raw, i) => {
    const m = raw.match(/^([A-Za-z]+-\d+)\s*:\s*(.+)$/);
    if (m) return { id: m[1], text: m[2].trim() };
    return { id: `${prefix}-${String(i + 1).padStart(3, "0")}`, text: raw };
  });
}

function parseRisks(lines: string[]): RequirementRisk[] {
  return listUnder(lines, "Risks").map((raw) => {
    const parts = raw.split("|").map((p) => p.trim());
    const description = parts[0] ?? raw;
    const get = (key: string): string | undefined => {
      const p = parts.find((p) => p.toLowerCase().startsWith(`${key}:`));
      return p ? p.slice(p.indexOf(":") + 1).trim() : undefined;
    };
    const mitigation = get("mitigation") ?? "";
    return {
      description,
      impact: level(get("impact")),
      likelihood: level(get("likelihood")),
      mitigation,
    };
  });
}

function emptySpec(overrides: Partial<RequirementSpec> = {}): RequirementSpec {
  return {
    functional: [],
    nonFunctional: [],
    constraints: [],
    assumptions: [],
    missingInformation: [],
    ambiguities: [],
    risks: [],
    acceptanceCriteria: [],
    completenessScore: null,
    confidenceScore: null,
    readyForPlanning: false,
    readyForPlanningSource: "derived",
    raw: "",
    partial: true,
    ...overrides,
  };
}

/** Tolerant, line-walk parser. NEVER throws — any internal failure degrades
 *  to an empty, `partial: true` spec rather than propagating (5.3: "return
 *  partial specification... never terminate the workflow unexpectedly"). */
export function parseRequirementSpec(text: string): RequirementSpec {
  try {
    const openIdx = text.indexOf(SPEC_OPEN);
    if (openIdx === -1) {
      // The model ignored the format entirely — we have zero real information,
      // so "ready for planning" must default to false, not be derived from an
      // (accidentally) empty missing-information list.
      return emptySpec({ readyForPlanning: false });
    }
    const bodyStart = openIdx + SPEC_OPEN.length;
    const closeIdx = text.indexOf(SPEC_CLOSE, bodyStart);
    const hasClose = closeIdx !== -1;
    const block = hasClose ? text.slice(bodyStart, closeIdx) : text.slice(bodyStart);
    const lines = block.split("\n");

    const functional = parseRequirementIdList(lines, "Functional Requirements", "FR");
    const nonFunctional = parseRequirementIdList(lines, "Non-Functional Requirements", "NFR");
    const constraints = listUnder(lines, "Constraints");
    const assumptions = listUnder(lines, "Assumptions");
    const missingInformation = listUnder(lines, "Missing Information");
    const ambiguities = listUnder(lines, "Ambiguities");
    const risks = parseRisks(lines);
    const acceptanceCriteria = listUnder(lines, "Acceptance Criteria");

    const completenessScore = parsePercent(lineValue(lines, "Completeness Score"));
    const confidenceScore = parsePercent(lineValue(lines, "Confidence Score"));

    const readyRaw = lineValue(lines, "Ready For Planning");
    let readyForPlanning: boolean;
    let readyForPlanningSource: "model" | "derived";
    if (/^true$/i.test(readyRaw)) {
      readyForPlanning = true;
      readyForPlanningSource = "model";
    } else if (/^false$/i.test(readyRaw)) {
      readyForPlanning = false;
      readyForPlanningSource = "model";
    } else {
      readyForPlanning = missingInformation.length === 0;
      readyForPlanningSource = "derived";
    }

    const missingRequiredHeader = REQUIRED_HEADERS.some((h) => !hasHeader(lines, h));
    const partial = !hasClose || missingRequiredHeader;

    return {
      functional,
      nonFunctional,
      constraints,
      assumptions,
      missingInformation,
      ambiguities,
      risks,
      acceptanceCriteria,
      completenessScore,
      confidenceScore,
      readyForPlanning,
      readyForPlanningSource,
      raw: block.trim(),
      partial,
    };
  } catch {
    return emptySpec({ readyForPlanning: false });
  }
}

// ── System-prompt consumption — the ONLY way RAA's output reaches the model ──

function bulletList(label: string, items: string[]): string {
  return `${label}:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** Fold a RequirementSpec into the final streamed generation's system prompt.
 *  RAA's raw text is never streamed to the user — only this distilled addon
 *  reaches the model. `Ready For Planning` decides the answer's contract (see
 *  route.ts's Requirement Analysis block for the three cases this drives). */
export function requirementSpecSystemAddon(spec: RequirementSpec, opts: { clarifyFirst: boolean }): string {
  const lines: string[] = [
    "── Co.AI Requirement Analysis (internal) ──",
    "A Requirement Analysis stage already ran for this request. Ground your answer in its findings below. " +
      "Never mention this spec, its section names, its markers, or that an analysis stage ran.",
  ];

  if (spec.functional.length) lines.push(bulletList("Functional Requirements", spec.functional.map((f) => `${f.id}: ${f.text}`)));
  if (spec.nonFunctional.length) lines.push(bulletList("Non-Functional Requirements", spec.nonFunctional.map((f) => `${f.id}: ${f.text}`)));
  if (spec.constraints.length) lines.push(bulletList("Constraints", spec.constraints));
  if (spec.assumptions.length) {
    lines.push(bulletList("Assumptions (state these explicitly before your solution — never silently guess beyond them)", spec.assumptions));
  }
  if (spec.acceptanceCriteria.length) {
    lines.push(bulletList("Acceptance Criteria (the solution must satisfy every one of these)", spec.acceptanceCriteria));
  }
  if (spec.risks.length) {
    lines.push(
      bulletList(
        "Risks",
        spec.risks.map((r) => `${r.description} (impact: ${r.impact}, likelihood: ${r.likelihood}) — mitigation: ${r.mitigation}`),
      ),
    );
  }
  if (spec.ambiguities.length) {
    lines.push(bulletList("Ambiguities noted during analysis (resolve or flag these, never silently guess)", spec.ambiguities));
  }

  if (!spec.readyForPlanning && opts.clarifyFirst) {
    lines.push(
      "READY FOR PLANNING: false. EXTREME effort's clarify-first contract applies: do NOT produce an " +
        "implementation. Ask the user 1-3 focused blocking questions drawn from Missing Information below, " +
        "then stop and wait for their answers.",
      bulletList(
        "Missing Information",
        spec.missingInformation.length ? spec.missingInformation : ["(none listed — ask about whatever is still unclear)"],
      ),
    );
  } else if (!spec.readyForPlanning) {
    lines.push(
      "READY FOR PLANNING: false. Lead your reply with 1-3 concrete clarifying questions drawn from Missing " +
        "Information below. THEN give a best-effort provisional answer, explicitly labelled as resting on the " +
        "Assumptions above, and state which parts cannot be safely finalised until the questions are answered. " +
        "Produce exactly one complete reply — never stop at only the questions.",
      bulletList(
        "Missing Information",
        spec.missingInformation.length ? spec.missingInformation : ["(none listed — ask about whatever is still unclear)"],
      ),
    );
  } else {
    lines.push("READY FOR PLANNING: true. Build to the requirements above and satisfy every Acceptance Criterion.");
  }

  return lines.join("\n\n");
}

/** System addon used when the buffered RAA call itself failed (all providers
 *  exhausted, timeout, abort). Honest degradation: says nothing that wasn't
 *  observed, never fabricates a requirement spec. */
export function raaUnavailableAddon(): string {
  return (
    "── Co.AI Requirement Analysis (internal) ──\n\n" +
    "The Requirement Analysis stage could not complete for this turn. Proceed directly, but state any real " +
    "assumptions and open questions in your reply instead of silently guessing. Never mention this note, this " +
    "stage, or that an analysis was attempted."
  );
}
