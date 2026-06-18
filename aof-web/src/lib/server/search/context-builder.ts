// ── Context Builder ───────────────────────────────────────────────────────────
// Turns raw search hits into (1) a grounding block injected into the model's
// system prompt and (2) a list of citations surfaced to the UI. Capped so search
// context never crowds out the conversation.

import { makeSourcesNotice, type Citation, type SourcesNotice } from "@/lib/errors";
import type { SearchOutcome } from "./types";

const MAX_CONTEXT_CHARS = 4000;

export interface BuiltContext {
  /** System-prompt addition instructing the model to ground its answer. */
  systemAddon: string;
  /** Structured citations for the UI (and the in-band sources frame). */
  citations: Citation[];
  notice: SourcesNotice;
}

export function buildSearchContext(outcome: SearchOutcome): BuiltContext {
  const citations: Citation[] = outcome.hits.map((h) => ({
    title: h.title,
    url: h.url,
    snippet: h.snippet,
    source: outcome.provider,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  let budget = MAX_CONTEXT_CHARS;
  outcome.hits.forEach((h, i) => {
    const entry = `[${i + 1}] ${h.title}\n${h.snippet}\n(${h.url})`;
    if (budget - entry.length < 0) return;
    budget -= entry.length;
    lines.push(entry);
  });

  const systemAddon = [
    `LIVE WEB SEARCH RESULTS (retrieved ${today} via ${outcome.provider} for "${outcome.query}"):`,
    "",
    lines.join("\n\n"),
    "",
    "Use these results to ground your answer in current information. Prefer them over " +
      "your training data when they conflict. Cite the sources you rely on inline as [1], [2], etc. " +
      "If the results don't actually answer the question, say so and answer from general knowledge.",
  ].join("\n");

  return { systemAddon, citations, notice: makeSourcesNotice(outcome.provider, outcome.query, citations) };
}
