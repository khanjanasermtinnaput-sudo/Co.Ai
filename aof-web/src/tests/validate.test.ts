// P8 — shared zod validation helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { parseJsonBody, parseQuery, parseParams } from "@/lib/server/validate.js";

const Body = z.object({ code: z.string().min(1).max(8) });

function jsonReq(body: unknown): Request {
  return new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

test("parseJsonBody accepts a valid body", async () => {
  const r = await parseJsonBody(jsonReq({ code: "ABCD" }), Body);
  assert.equal(r.error, undefined);
  assert.equal(r.data?.code, "ABCD");
});

test("parseJsonBody rejects a wrong-typed field with 400", async () => {
  const r = await parseJsonBody(jsonReq({ code: 123 }), Body);
  assert.ok(r.error);
  assert.equal(r.error!.status, 400);
});

test("parseJsonBody rejects malformed JSON with 400", async () => {
  const bad = new Request("http://x/api", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
  const r = await parseJsonBody(bad, Body);
  assert.ok(r.error);
  assert.equal(r.error!.status, 400);
});

test("parseQuery validates search params", () => {
  const ok = parseQuery(new Request("http://x/api?page=2"), z.object({ page: z.string() }));
  assert.equal(ok.data?.page, "2");
  const bad = parseQuery(new Request("http://x/api"), z.object({ page: z.string() }));
  assert.ok(bad.error);
  assert.equal(bad.error!.status, 400);
});

test("parseParams validates route params", () => {
  const ok = parseParams({ id: "abc" }, z.object({ id: z.string() }));
  assert.equal(ok.data?.id, "abc");
  const bad = parseParams({}, z.object({ id: z.string() }));
  assert.ok(bad.error);
});
