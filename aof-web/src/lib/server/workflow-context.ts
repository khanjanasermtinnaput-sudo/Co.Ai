// ── Workflow Context Builder — local, zero-provider-call (Model Workflow) ────
// Co.AI Master Prompt Part 4.2: the Context Builder "is NOT another AI... is
// NOT another provider call... must execute locally". This module selects the
// minimum relevant slice of conversation history for the current message and
// REPLACES the history sent to the provider — unlike the LLM-based Context
// Builder this superseded, it can never add tokens, only save them (see the
// guard at the bottom of buildWorkflowContext).
//
// Sibling of simple-task-detector.ts: deterministic, sub-20ms, no network, no
// LLM call. Never throws — any internal failure degrades to "recent messages
// only", which is also the required behavior when nothing scores as relevant.

export interface WorkflowHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface WorkflowContextInput {
  message: string;
  history: WorkflowHistoryItem[];
  /** Most recent turns kept verbatim regardless of relevance. Default 4. */
  recentTurns?: number;
  /** Cap on the compressed digest of older, relevant turns. Default 1200 chars. */
  maxContextChars?: number;
  /** Per-message truncation before a selected older turn enters the digest. Default 400. */
  maxPerMessageChars?: number;
}

export interface WorkflowContextStats {
  inputMessages: number;
  keptMessages: number;
  selectedMessages: number;
  inputChars: number;
  outputChars: number;
  charsSaved: number;
  /** True when scoring found nothing relevant (or input was too small/malformed
   *  to score) and the result fell back to recent-messages-only. */
  degraded: boolean;
}

export interface WorkflowContextResult {
  /** REPLACES the history the caller sends to the provider. */
  history: WorkflowHistoryItem[];
  /** System-prompt addendum summarizing relevant older turns. "" when none apply. */
  digest: string;
  stats: WorkflowContextStats;
}

const DEFAULT_RECENT_TURNS = 4;
const DEFAULT_MAX_CONTEXT_CHARS = 1200;
const DEFAULT_MAX_PER_MESSAGE_CHARS = 400;
const SCORE_THRESHOLD = 0.15;
const MAX_SELECTED = 3;
const MAX_SCORED_CHARS = 4000;

// ── Script-aware tokenizer ────────────────────────────────────────────────────
// Thai is not a JS regex "word" character and has no word spaces, so whitespace
// splitting collapses Thai lexical overlap to ~0 — every Thai conversation would
// score as "nothing relevant". Latin/digit runs tokenize normally; Thai runs are
// emitted as character trigrams (keeping vowels/tone marks, since stripping them
// merges distinct words) — the standard dictionary-free proxy for Thai overlap.

const LATIN_RE = /[a-z0-9]+/g;
const THAI_RE = /[฀-๿]+/g;

function thaiTrigrams(run: string): string[] {
  if (run.length < 3) return [run];
  const out: string[] = [];
  for (let i = 0; i <= run.length - 3; i++) out.push(run.slice(i, i + 3));
  return out;
}

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().match(LATIN_RE) ?? []) {
    if (t.length >= 2) out.add(t);
  }
  for (const run of text.match(THAI_RE) ?? []) {
    for (const tri of thaiTrigrams(run)) out.add(tri);
  }
  return out;
}

// ── Scoring ────────────────────────────────────────────────────────────────

function lexicalCoverage(queryTokens: Set<string>, content: string): number {
  if (queryTokens.size === 0) return 0;
  const msgTokens = tokenize(content.slice(0, MAX_SCORED_CHARS));
  let hits = 0;
  for (const t of queryTokens) if (msgTokens.has(t)) hits++;
  return hits / queryTokens.size;
}

/** Recency is a tie-breaker AMONG lexically relevant candidates, never a
 *  stand-alone source of relevance — without the lex>0 gate, a totally
 *  unrelated message can still cross SCORE_THRESHOLD on recency alone once
 *  recencyFrac >= 0.6 (0.25 * 0.6 = 0.15), which would select irrelevant
 *  recent turns purely because they're recent. */
function scoreMessage(queryTokens: Set<string>, content: string, recencyFrac: number): number {
  const lex = lexicalCoverage(queryTokens, content);
  if (lex === 0) return 0;
  return 0.75 * lex + 0.25 * recencyFrac;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function charsOf(msgs: WorkflowHistoryItem[]): number {
  return msgs.reduce((n, m) => n + (m.content?.length ?? 0), 0);
}

/** Truncate at a sentence/newline boundary when one exists past the halfway
 *  point, so a selected message doesn't end mid-word. */
function truncateAtBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
  return lastBreak > max * 0.5 ? slice.slice(0, lastBreak + 1) : slice;
}

function degradedResult(
  history: WorkflowHistoryItem[],
  recent: WorkflowHistoryItem[],
  inputChars: number,
): WorkflowContextResult {
  const outputChars = charsOf(recent);
  return {
    history: recent,
    digest: "",
    stats: {
      inputMessages: history.length,
      keptMessages: recent.length,
      selectedMessages: 0,
      inputChars,
      outputChars,
      charsSaved: Math.max(0, inputChars - outputChars),
      degraded: true,
    },
  };
}

export function buildWorkflowContext(input: WorkflowContextInput): WorkflowContextResult {
  const recentTurns = input?.recentTurns ?? DEFAULT_RECENT_TURNS;
  const maxContextChars = input?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const maxPerMessageChars = input?.maxPerMessageChars ?? DEFAULT_MAX_PER_MESSAGE_CHARS;
  const history = Array.isArray(input?.history) ? input.history : [];
  const inputChars = charsOf(history);
  const cut = Math.max(0, history.length - Math.max(0, recentTurns));
  const recent = history.slice(cut);

  try {
    const older = history.slice(0, cut);
    const queryTokens = tokenize(String(input?.message ?? ""));
    if (queryTokens.size === 0 || older.length === 0) {
      return degradedResult(history, recent, inputChars);
    }

    const scored = older.map((m, i) => ({
      msg: m,
      idx: i,
      score: scoreMessage(queryTokens, String(m?.content ?? ""), (i + 1) / older.length),
    }));

    const selected = scored
      .filter((s) => s.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SELECTED)
      .sort((a, b) => a.idx - b.idx);

    if (selected.length === 0) {
      return degradedResult(history, recent, inputChars);
    }

    const pieces: string[] = [];
    let used = 0;
    for (const s of selected) {
      const truncated = truncateAtBoundary(String(s.msg.content ?? ""), maxPerMessageChars);
      if (used + truncated.length > maxContextChars) {
        if (pieces.length === 0) pieces.push(truncated.slice(0, Math.max(0, maxContextChars - used)));
        break;
      }
      pieces.push(`${s.msg.role === "user" ? "User" : "Assistant"}: ${truncated}`);
      used += truncated.length;
    }

    const digestBody = pieces.join("\n");
    if (!digestBody) return degradedResult(history, recent, inputChars);

    // Deliberately lean: this is the model's own prior conversation, not
    // untrusted external data (contrast buildSearchContext's heavier framing),
    // and every byte of wrapper text competes with the guard below — a verbose
    // label can erase the savings from dropping a handful of short messages.
    const digest = `Earlier relevant context:\n${digestBody}`;

    // Token-saving guard: this stage exists to save tokens, never add them. If
    // the digest plus the kept-verbatim recent turns would be no smaller than
    // the original history, drop the digest and fall back to recent-only.
    const outputChars = digest.length + charsOf(recent);
    if (outputChars >= inputChars) {
      return degradedResult(history, recent, inputChars);
    }

    return {
      history: recent,
      digest,
      stats: {
        inputMessages: history.length,
        keptMessages: recent.length,
        selectedMessages: selected.length,
        inputChars,
        outputChars,
        charsSaved: inputChars - outputChars,
        degraded: false,
      },
    };
  } catch {
    return degradedResult(history, recent, inputChars);
  }
}
