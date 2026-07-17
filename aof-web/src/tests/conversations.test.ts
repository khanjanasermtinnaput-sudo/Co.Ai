import { test } from "node:test";
import assert from "node:assert/strict";
import { toChatMessages } from "../lib/conversations.js";

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
