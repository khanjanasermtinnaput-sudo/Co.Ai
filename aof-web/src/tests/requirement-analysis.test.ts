// ── requirement-analysis.ts — Ypertatos RAA parsing + prompt injection (no network) ──
// Master Prompt Part 5.3. Locks in: the tolerant line-walk parser never
// throws and never fabricates a metric (scores are `number | null`, never a
// computed substitute), `Ready For Planning` is either taken verbatim from
// the model or explicitly labelled "derived", and requirementSpecSystemAddon()
// renders the three distinct answer contracts (ready / lead-with-questions /
// clarify-only) correctly.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRequirementSpec,
  requirementSpecSystemAddon,
  raaUnavailableAddon,
  type RequirementSpec,
} from "../lib/server/requirement-analysis";

const FULL_BLOCK = `Here you go:

===COAI REQUIREMENT SPEC===
Functional Requirements:
- FR-001: Users can create an account with email and password
- FR-002: Users can log in and receive a JWT
Non-Functional Requirements:
- NFR-001: Login must respond within 300ms under normal load
Constraints:
- Must use PostgreSQL
- Must be deployed on Vercel
Assumptions:
- Email verification is out of scope for this iteration
Missing Information:
- Password reset flow is not specified
Ambiguities:
- "account" could mean an individual or an organization account
Risks:
- JWT secret leakage | impact: High | likelihood: Low | mitigation: store secret in env var, rotate quarterly
Acceptance Criteria:
- A user can register, log in, and receive a valid JWT
Completeness Score: 72%
Confidence Score: 80%
Ready For Planning: false
===END SPEC===`;

test("a full well-formed block parses every section, preserves FR/NFR ids, and parses risk fields", () => {
  const spec = parseRequirementSpec(FULL_BLOCK);
  assert.equal(spec.partial, false);
  assert.deepEqual(spec.functional, [
    { id: "FR-001", text: "Users can create an account with email and password" },
    { id: "FR-002", text: "Users can log in and receive a JWT" },
  ]);
  assert.deepEqual(spec.nonFunctional, [{ id: "NFR-001", text: "Login must respond within 300ms under normal load" }]);
  assert.deepEqual(spec.constraints, ["Must use PostgreSQL", "Must be deployed on Vercel"]);
  assert.deepEqual(spec.assumptions, ["Email verification is out of scope for this iteration"]);
  assert.deepEqual(spec.missingInformation, ["Password reset flow is not specified"]);
  assert.equal(spec.ambiguities.length, 1);
  assert.equal(spec.risks.length, 1);
  assert.equal(spec.risks[0].impact, "High");
  assert.equal(spec.risks[0].likelihood, "Low");
  assert.match(spec.risks[0].mitigation, /rotate quarterly/);
  assert.match(spec.risks[0].description, /JWT secret leakage/);
  assert.deepEqual(spec.acceptanceCriteria, ["A user can register, log in, and receive a valid JWT"]);
  assert.equal(spec.completenessScore, 72);
  assert.equal(spec.confidenceScore, 80);
  assert.equal(spec.readyForPlanning, false);
  assert.equal(spec.readyForPlanningSource, "model");
});

test("multi-word headers correctly terminate the preceding list (no leakage across sections)", () => {
  const spec = parseRequirementSpec(FULL_BLOCK);
  // Assumptions must not have picked up the Missing Information bullet.
  assert.ok(!spec.assumptions.some((a) => a.includes("Password reset")));
  // Missing Information must not have picked up the Ambiguities bullet.
  assert.ok(!spec.missingInformation.some((m) => m.includes("individual or an organization")));
  // Risks must not have picked up the Acceptance Criteria bullet.
  assert.ok(!spec.risks.some((r) => r.description.includes("can register")));
});

test("a truncated block (stream cut mid-Risks, no closing marker) → partial:true, no throw, prior sections retained", () => {
  const truncated = FULL_BLOCK.slice(0, FULL_BLOCK.indexOf("- JWT secret leakage") + "- JWT secret lea".length);
  assert.doesNotThrow(() => parseRequirementSpec(truncated));
  const spec = parseRequirementSpec(truncated);
  assert.equal(spec.partial, true);
  assert.equal(spec.functional.length, 2);
  assert.equal(spec.constraints.length, 2);
  assert.equal(spec.missingInformation.length, 1);
});

test("no marker block at all (model ignored the format) → partial, all-empty, readyForPlanning defaults false/derived", () => {
  const spec = parseRequirementSpec("Sure, I can help with that! Let's build a login system for you.");
  assert.equal(spec.partial, true);
  assert.equal(spec.functional.length, 0);
  assert.equal(spec.nonFunctional.length, 0);
  assert.equal(spec.constraints.length, 0);
  assert.equal(spec.risks.length, 0);
  assert.equal(spec.readyForPlanning, false);
  assert.equal(spec.readyForPlanningSource, "derived");
  assert.equal(spec.completenessScore, null);
  assert.equal(spec.confidenceScore, null);
});

test("Completeness Score absent → null, never a computed substitute", () => {
  const withoutCompleteness = FULL_BLOCK.replace(/Completeness Score: 72%\n/, "");
  const spec = parseRequirementSpec(withoutCompleteness);
  assert.equal(spec.completenessScore, null);
  assert.equal(spec.confidenceScore, 80); // the sibling field, still present, still parses
});

test("Ready For Planning absent → derived from missingInformation.length", () => {
  const noMissing = FULL_BLOCK.replace(
    "Missing Information:\n- Password reset flow is not specified\n",
    "Missing Information:\n",
  ).replace("Ready For Planning: false\n", "");
  const specA = parseRequirementSpec(noMissing);
  assert.equal(specA.missingInformation.length, 0);
  assert.equal(specA.readyForPlanning, true);
  assert.equal(specA.readyForPlanningSource, "derived");

  const withMissing = FULL_BLOCK.replace("Ready For Planning: false\n", "");
  const specB = parseRequirementSpec(withMissing);
  assert.equal(specB.missingInformation.length, 1);
  assert.equal(specB.readyForPlanning, false);
  assert.equal(specB.readyForPlanningSource, "derived");
});

test("parseRequirementSpec never throws on empty, garbage, or huge input", () => {
  assert.doesNotThrow(() => parseRequirementSpec(""));
  assert.doesNotThrow(() => parseRequirementSpec("===COAI REQUIREMENT SPEC==="));
  assert.doesNotThrow(() => parseRequirementSpec("🎉".repeat(50_000)));
  assert.doesNotThrow(() => parseRequirementSpec(FULL_BLOCK.split("").reverse().join("")));
});

// ── requirementSpecSystemAddon() — the only path RAA's output reaches the model ──

function specWith(overrides: Partial<RequirementSpec>): RequirementSpec {
  return {
    functional: [{ id: "FR-001", text: "Users can log in" }],
    nonFunctional: [],
    constraints: [],
    assumptions: ["No email verification required"],
    missingInformation: ["Which auth provider to use"],
    ambiguities: [],
    risks: [],
    acceptanceCriteria: ["User can log in and reach the dashboard"],
    completenessScore: 60,
    confidenceScore: 70,
    readyForPlanning: true,
    readyForPlanningSource: "model",
    raw: "",
    partial: false,
    ...overrides,
  };
}

test("requirementSpecSystemAddon always includes acceptance criteria and assumptions, and the never-mention rule", () => {
  const addon = requirementSpecSystemAddon(specWith({}), { clarifyFirst: false });
  assert.match(addon, /Acceptance Criteria/);
  assert.match(addon, /User can log in and reach the dashboard/);
  assert.match(addon, /Assumptions/);
  assert.match(addon, /No email verification required/);
  assert.match(addon, /Never mention this spec/);
});

test("readyForPlanning:false + clarifyFirst:false → lead-with-questions-then-provisional-answer contract", () => {
  const addon = requirementSpecSystemAddon(specWith({ readyForPlanning: false }), { clarifyFirst: false });
  assert.match(addon, /provisional answer/);
  assert.match(addon, /Which auth provider to use/);
  assert.ok(!addon.includes("do NOT produce an implementation"));
});

test("readyForPlanning:false + clarifyFirst:true → clarification-only contract, no provisional-answer language", () => {
  const addon = requirementSpecSystemAddon(specWith({ readyForPlanning: false }), { clarifyFirst: true });
  assert.match(addon, /do NOT produce an implementation/);
  assert.match(addon, /Which auth provider to use/);
  assert.ok(!addon.includes("provisional answer"));
});

test("readyForPlanning:true → build-to-spec contract, no clarification language", () => {
  const addon = requirementSpecSystemAddon(specWith({ readyForPlanning: true }), { clarifyFirst: false });
  assert.match(addon, /READY FOR PLANNING: true/);
  assert.ok(!addon.includes("provisional answer"));
  assert.ok(!addon.includes("do NOT produce an implementation"));
});

test("raaUnavailableAddon degrades honestly with no fabricated spec content", () => {
  const addon = raaUnavailableAddon();
  assert.match(addon, /could not complete/);
  assert.match(addon, /Never mention this note/);
});
