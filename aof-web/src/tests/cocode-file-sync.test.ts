import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIncomingFiles, diffStalePaths } from "../lib/cocode/file-sync-helpers.js";

// ── parseIncomingFiles ────────────────────────────────────────────────────────

test("keeps well-formed entries with path and content", () => {
  const files = parseIncomingFiles([
    { path: "src/a.ts", content: "a" },
    { path: "src/b.ts", content: "", sha: "abc" },
  ]);
  assert.deepEqual(files, [
    { path: "src/a.ts", content: "a" },
    { path: "src/b.ts", content: "", sha: "abc" },
  ]);
});

test("drops entries missing path or content, or with the wrong type", () => {
  const files = parseIncomingFiles([
    { path: "ok.ts", content: "x" },
    { path: 123, content: "x" },
    { content: "no path" },
    { path: "no-content.ts" },
    null,
    "just a string",
  ]);
  assert.deepEqual(files, [{ path: "ok.ts", content: "x" }]);
});

test("returns [] for a non-array or missing input", () => {
  assert.deepEqual(parseIncomingFiles(undefined), []);
  assert.deepEqual(parseIncomingFiles(null), []);
  assert.deepEqual(parseIncomingFiles("not an array"), []);
  assert.deepEqual(parseIncomingFiles({ path: "x", content: "y" }), []);
});

// ── diffStalePaths ────────────────────────────────────────────────────────────
// The core of PUT /api/projects/[id]/files's replace semantics: whatever was
// saved but isn't in the new batch must be deleted, so a plain file delete or
// a rename in the workspace is reflected server-side too.

test("returns [] when every saved path is still present in the new batch", () => {
  const stale = diffStalePaths(
    ["a.ts", "b.ts"],
    [{ path: "a.ts", content: "1" }, { path: "b.ts", content: "2" }],
  );
  assert.deepEqual(stale, []);
});

test("flags a deleted file — saved path absent from the new batch", () => {
  const stale = diffStalePaths(
    ["a.ts", "b.ts"],
    [{ path: "a.ts", content: "1" }],
  );
  assert.deepEqual(stale, ["b.ts"]);
});

test("flags the old path of a rename, keeps the new path implicitly untouched", () => {
  const stale = diffStalePaths(
    ["old/name.ts"],
    [{ path: "new/name.ts", content: "1" }],
  );
  assert.deepEqual(stale, ["old/name.ts"]);
});

test("an empty incoming batch marks every existing path stale (workspace cleared)", () => {
  const stale = diffStalePaths(["a.ts", "b.ts"], []);
  assert.deepEqual(stale, ["a.ts", "b.ts"]);
});

test("nothing saved yet means nothing can be stale", () => {
  const stale = diffStalePaths([], [{ path: "a.ts", content: "1" }]);
  assert.deepEqual(stale, []);
});
