import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSearch } from "../lib/server/search/manager";
import { normalizeSearchMode } from "../lib/server/search/types";
import {
  encodeSourcesFrame,
  decodeFrames,
  makeSourcesNotice,
  type Citation,
} from "../lib/errors";

// ── Search mode normalisation ─────────────────────────────────────────────────
test("normalizeSearchMode defaults unknown values to auto", () => {
  assert.equal(normalizeSearchMode(undefined), "auto");
  assert.equal(normalizeSearchMode("weird"), "auto");
  assert.equal(normalizeSearchMode("off"), "off");
  assert.equal(normalizeSearchMode("force"), "force");
});

// ── decideSearch ──────────────────────────────────────────────────────────────
test("OFF never searches, even with freshness words", () => {
  assert.equal(decideSearch("latest news today", "off").search, false);
});

test("FORCE always searches, even for static questions", () => {
  assert.equal(decideSearch("what is 2 + 2", "force").search, true);
});

test("AUTO searches when the router classified the turn as search", () => {
  assert.equal(decideSearch("anything", "auto", "search").search, true);
});

test("AUTO searches on freshness signals", () => {
  for (const q of ["latest React version", "news today", "current Bitcoin price"]) {
    assert.equal(decideSearch(q, "auto").search, true, q);
  }
});

test("AUTO skips search for static knowledge", () => {
  assert.equal(decideSearch("explain recursion", "auto").search, false);
  assert.equal(decideSearch("write a haiku about the sea", "auto").search, false);
});

// ── Sources frame round-trip ──────────────────────────────────────────────────
test("a sources frame survives encode → decode and strips from text", () => {
  const citations: Citation[] = [
    { title: "Next.js Docs", url: "https://nextjs.org/docs", snippet: "App Router", source: "Google" },
  ];
  const notice = makeSourcesNotice("Google", "next.js app router", citations);
  const stream = encodeSourcesFrame(notice) + "Here is the answer.";

  const decoded = decodeFrames(stream);
  assert.equal(decoded.text, "Here is the answer.");
  assert.equal(decoded.sources.length, 1);
  assert.equal(decoded.sources[0].provider, "Google");
  assert.equal(decoded.sources[0].sources[0].url, "https://nextjs.org/docs");
});
