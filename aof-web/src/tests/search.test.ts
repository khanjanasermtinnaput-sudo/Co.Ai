import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSearch } from "../lib/server/search/manager";
import {
  encodeSourcesFrame,
  decodeFrames,
  makeSourcesNotice,
  type Citation,
} from "../lib/errors";

// ── decideSearch ──────────────────────────────────────────────────────────────
test("searches when the router classified the turn as search", () => {
  assert.equal(decideSearch("anything", "search").search, true);
});

test("searches on freshness signals", () => {
  for (const q of ["latest React version", "news today", "current Bitcoin price"]) {
    assert.equal(decideSearch(q).search, true, q);
  }
});

test("skips search for static knowledge", () => {
  assert.equal(decideSearch("explain recursion").search, false);
  assert.equal(decideSearch("write a haiku about the sea").search, false);
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
