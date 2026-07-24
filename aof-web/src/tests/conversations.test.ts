import { test } from "node:test";
import assert from "node:assert/strict";
import { toChatMessages, mergeServerMessages, titleFrom } from "../lib/conversations.js";
import type { ChatMessageT } from "../lib/types.js";

// ── titleFrom ─────────────────────────────────────────────────────────────────
// Shared by CoChat (chat-store's autoTitle) and CoCode (code-store's
// persistCocodeTurn/migrateGuestCocode/adoptProjectId) so a conversation's
// title looks the same regardless of which product surface created it.

test("collapses internal whitespace and passes short text through unchanged", () => {
  assert.equal(titleFrom("hello   world\n\tagain"), "hello world again");
});

test("truncates text over 42 chars with an ellipsis", () => {
  const long = "a".repeat(60);
  const title = titleFrom(long);
  assert.equal(title, `${"a".repeat(42)}…`);
  assert.equal(title.length, 43);
});

test("falls back to 'New chat' for empty or whitespace-only text", () => {
  assert.equal(titleFrom(""), "New chat");
  assert.equal(titleFrom("   \n  "), "New chat");
});

// ── toChatMessages ────────────────────────────────────────────────────────────
// Pure mapper from server message rows (GET /api/conversations/[id]/messages)
// to the client's ChatMessageT shape — the core of chat-store's loadMessages
// reconciliation. Tested directly so this logic doesn't need a Supabase/network
// mock.

test("maps id, role, content, createdAt straight through", () => {
  const [msg] = toChatMessages([
    { id: "m1", role: "user", content: "hello", created_at: "2026-01-01T00:00:00.000Z" },
  ]);
  assert.equal(msg.id, "m1");
  assert.equal(msg.role, "user");
  assert.equal(msg.content, "hello");
  assert.equal(msg.createdAt, "2026-01-01T00:00:00.000Z");
});

test("falls back to a generated createdAt when the row has none", () => {
  const [msg] = toChatMessages([{ id: "m1", role: "assistant", content: "hi" }]);
  assert.ok(typeof msg.createdAt === "string" && msg.createdAt.length > 0);
});

test("maps model through, and omits it when absent", () => {
  const [withModel] = toChatMessages([
    { id: "m1", role: "assistant", content: "hi", model: "normal" },
  ]);
  assert.equal(withModel.model, "normal");

  const [withoutModel] = toChatMessages([{ id: "m2", role: "assistant", content: "hi" }]);
  assert.equal(withoutModel.model, undefined);
});

test("reconstructs route from route_target/route_label with an empty reason", () => {
  const [msg] = toChatMessages([
    {
      id: "m1",
      role: "assistant",
      content: "hi",
      route_target: "code",
      route_label: "CoCode",
    },
  ]);
  assert.deepEqual(msg.route, { target: "code", label: "CoCode", reason: "" });
});

test("omits route entirely when target or label is missing", () => {
  const [noTarget] = toChatMessages([
    { id: "m1", role: "assistant", content: "hi", route_label: "CoCode" },
  ]);
  assert.equal(noTarget.route, undefined);

  const [noLabel] = toChatMessages([
    { id: "m2", role: "assistant", content: "hi", route_target: "code" },
  ]);
  assert.equal(noLabel.route, undefined);
});

test("preserves message order and count across a full conversation", () => {
  const rows = [
    { id: "m1", role: "user", content: "first" },
    { id: "m2", role: "assistant", content: "second" },
    { id: "m3", role: "user", content: "third" },
  ];
  const messages = toChatMessages(rows);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((m) => m.id), ["m1", "m2", "m3"]);
});

test("handles an empty row list", () => {
  assert.deepEqual(toChatMessages([]), []);
});

// ── mergeServerMessages ───────────────────────────────────────────────────────
// Regression coverage for the "disappearing message" bug: loadMessages() used to
// replace a conversation's messages outright with whatever the server returned.
// A hydration fetch landing between newConversation()'s create-POST and that
// turn's save (still mid-stream) got back `[]` and wiped the turn out from under
// the user. mergeServerMessages() must keep any local-only message instead.

function msg(id: string, content = ""): ChatMessageT {
  return { id, role: "user", content, createdAt: "2026-01-01T00:00:00.000Z" };
}

test("keeps a mid-stream local turn when the server hasn't saved it yet", () => {
  const local = [msg("user-1"), msg("assistant-1")];
  const merged = mergeServerMessages(local, []);
  assert.deepEqual(merged.map((m) => m.id), ["user-1", "assistant-1"]);
});

test("prefers the server's copy of a message that exists on both sides", () => {
  const local = [msg("m1", "still streaming")];
  const server = [msg("m1", "final saved content")];
  const merged = mergeServerMessages(local, server);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, "final saved content");
});

test("appends local-only messages after the full server history, preserving order", () => {
  const server = [msg("m1"), msg("m2")];
  const local = [msg("m1"), msg("m2"), msg("m3-instream")];
  const merged = mergeServerMessages(local, server);
  assert.deepEqual(merged.map((m) => m.id), ["m1", "m2", "m3-instream"]);
});

test("returns just the server list when nothing is local-only", () => {
  const server = [msg("m1"), msg("m2")];
  const merged = mergeServerMessages(server, server);
  assert.deepEqual(merged.map((m) => m.id), ["m1", "m2"]);
});
