// Hermetic smoke tests for the CLI's file-safety pipeline:
// parseCodeBlocks → generatePatch → validatePatch → applyChanges → snapshot/rollback.
// Everything runs inside a throwaway temp directory — no network, no repo writes.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// files.ts binds its snapshot dir to process.cwd() at import time, so enter the
// temp sandbox BEFORE importing it — keeps .coai-snapshots out of the repo.
const sandbox = mkdtempSync(join(tmpdir(), "coai-smoke-"));
const startCwd = process.cwd();
process.chdir(sandbox);

const { parseCodeBlocks, applyChanges, createSnapshot, rollbackSnapshot, fileExists, readFileContent } =
  await import("../files.js");
const { generatePatch, validatePatch } = await import("../patch.js");

const root = join(sandbox, "repo");

before(() => {
  mkdirSync(root, { recursive: true });
});

after(() => {
  process.chdir(startCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

// ── parseCodeBlocks ───────────────────────────────────────────────────────────

test("parseCodeBlocks parses a path-annotated fenced block into a create change", () => {
  const raw = "Here you go:\n```ts\n// path: src/hello.ts\nexport const hi = 1;\n```\n";
  const changes = parseCodeBlocks(raw, root);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].op, "create");
  assert.equal(changes[0].path, "src/hello.ts");
  assert.equal(changes[0].content, "export const hi = 1;\n");
});

test("parseCodeBlocks marks an existing target as edit, not create", () => {
  writeFileSync(join(root, "existing.ts"), "old\n");
  const raw = "```ts\n// path: existing.ts\nnew\n```";
  const changes = parseCodeBlocks(raw, root);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].op, "edit");
});

test("parseCodeBlocks ignores fenced blocks without a path annotation", () => {
  const raw = "```ts\nconst noPath = true;\n```";
  assert.equal(parseCodeBlocks(raw, root).length, 0);
});

// ── validatePatch (repository protection layer) ───────────────────────────────

test("validatePatch blocks path traversal and absolute paths", () => {
  const patch = generatePatch([
    { op: "create", path: "../outside.ts", content: "x" },
    { op: "create", path: "/etc/passwd", content: "x" },
  ]);
  const r = validatePatch(root, patch);
  assert.equal(r.valid, false);
  assert.equal(r.errors.length, 2);
});

test("validatePatch blocks protected paths (.env, .git/)", () => {
  const patch = generatePatch([
    { op: "create", path: ".env", content: "SECRET=1" },
    { op: "edit", path: ".git/config", content: "x" },
  ]);
  const r = validatePatch(root, patch);
  assert.equal(r.valid, false);
});

test("validatePatch rejects an edit whose target does not exist", () => {
  const patch = generatePatch([{ op: "edit", path: "missing.ts", content: "x" }]);
  const r = validatePatch(root, patch);
  assert.equal(r.valid, false);
  assert.ok(r.errors[0].includes("does not exist"));
});

test("validatePatch warns on deletions but keeps the patch valid", () => {
  writeFileSync(join(root, "doomed.ts"), "bye\n");
  const patch = generatePatch([{ op: "delete", path: "doomed.ts" }]);
  const r = validatePatch(root, patch);
  assert.equal(r.valid, true);
  assert.equal(r.warnings.length, 1);
});

test("validatePatch accepts a clean create", () => {
  const patch = generatePatch([{ op: "create", path: "ok.ts", content: "fine\n" }], {
    prompt: "make ok.ts",
  });
  const r = validatePatch(root, patch);
  assert.equal(r.valid, true);
  assert.equal(r.errors.length, 0);
  assert.ok(patch.id.length > 0);
  assert.ok(!Number.isNaN(Date.parse(patch.createdAt)));
});

// ── applyChanges round-trip ───────────────────────────────────────────────────

test("applyChanges creates, edits, renames and deletes files", () => {
  applyChanges(root, [{ op: "create", path: "a/b.ts", content: "v1\n" }]);
  assert.equal(readFileContent(root, "a/b.ts"), "v1\n");

  applyChanges(root, [{ op: "edit", path: "a/b.ts", content: "v2\n" }]);
  assert.equal(readFileContent(root, "a/b.ts"), "v2\n");

  applyChanges(root, [{ op: "rename", path: "a/b.ts", newPath: "a/c.ts" }]);
  assert.equal(fileExists(root, "a/b.ts"), false);
  assert.equal(readFileContent(root, "a/c.ts"), "v2\n");

  applyChanges(root, [{ op: "delete", path: "a/c.ts" }]);
  assert.equal(fileExists(root, "a/c.ts"), false);
});

// ── snapshot / rollback safety net ────────────────────────────────────────────

test("rollbackSnapshot restores the pre-change content after a bad edit", () => {
  writeFileSync(join(root, "precious.ts"), "original\n");
  const changes = [{ op: "edit" as const, path: "precious.ts", content: "clobbered\n" }];

  const snapId = createSnapshot(root, changes);
  applyChanges(root, changes);
  assert.equal(readFileContent(root, "precious.ts"), "clobbered\n");

  rollbackSnapshot(snapId);
  assert.equal(readFileContent(root, "precious.ts"), "original\n");
});
