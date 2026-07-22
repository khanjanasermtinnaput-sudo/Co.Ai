// ── Auto model resolution — CoChat's "Auto" selector ──────────────────────────
// Auto is not a fabricated "AI chooses for you" black box: it reuses the same
// deterministic, already-tested classifier (`classifyRequest()` in router.ts)
// that already runs on every send to power the Route badge — so the reason
// shown to the user is a real signal, not decoration.
//
// Deliberately NOT the server's `simple-task-detector.ts`: that module is
// server-only, scoped to the plain-chat `lite` path, and answers a different
// question (response SHAPE for Mikros), not "which tier should this turn use".
// Wiring it in here would be the second-mechanism-for-one-decision pattern
// aof-web/CLAUDE.md forbids.
//
// Return type is intentionally narrower than ChatModel's superset use — Auto
// can only ever resolve within CoChat's own reachable tiers (Mikros/Kanon);
// Ypertatos is reachable only from CoCode's code-chat path (a server
// invariant), so Auto must never even have the option to ask for it.

import type { Attachment, ChatModel } from "./types";
import { classifyRequest, type TaskCategory } from "./router";

/** Categories substantial enough to warrant Kanon's deeper reasoning. */
const KANON_CATEGORIES = new Set<TaskCategory>([
  "coding",
  "mathematics",
  "data_analysis",
  "science",
  "business",
  "product_design",
  "ui_design",
  "ux_design",
  "multi_step",
]);

export interface AutoModelResolution {
  model: ChatModel;
  reason: string;
}

/** Resolve which tier Auto should use for this message, and why — the `reason`
 *  is shown to the user, so every branch names a real, checkable signal. */
export function resolveAutoModel(text: string, attachments: Attachment[] = []): AutoModelResolution {
  if (attachments.some((a) => a.kind === "code" || a.kind === "document")) {
    return { model: "normal", reason: "Attached files need Kanon's deeper reasoning." };
  }

  const { categories, isMultiStep } = classifyRequest(text, attachments);

  if (isMultiStep) {
    return { model: "normal", reason: "This looks like a multi-part request." };
  }
  const matched = categories.find((c) => KANON_CATEGORIES.has(c));
  if (matched) {
    return { model: "normal", reason: `Detected a ${matched.replace(/_/g, " ")} task.` };
  }

  // Never under-serve: a long message gets the deeper model even with no
  // category match, mirroring the Ypertatos Task Classifier's "low confidence
  // escalates" policy rather than guessing short.
  if (text.trim().length > 240) {
    return { model: "normal", reason: "This is a longer, more involved request." };
  }

  return { model: "lite", reason: "A quick, everyday question." };
}
