import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveSystemStatus,
  statusDot,
  type ProviderHealth,
  type ProviderStatusLevel,
} from "../lib/health.js";

function provider(status: ProviderStatusLevel): ProviderHealth {
  return {
    id: "p",
    label: "Provider",
    status,
    note: "",
    configured: status !== "DISCONNECTED",
    primary: false,
    checkedAt: new Date().toISOString(),
  };
}

test("no providers → UNKNOWN", () => {
  assert.equal(deriveSystemStatus([]), "UNKNOWN");
});

test("all UNKNOWN → UNKNOWN", () => {
  assert.equal(deriveSystemStatus([provider("UNKNOWN"), provider("UNKNOWN")]), "UNKNOWN");
});

test("all CONNECTED → OPERATIONAL", () => {
  assert.equal(deriveSystemStatus([provider("CONNECTED"), provider("CONNECTED")]), "OPERATIONAL");
});

test("all DISCONNECTED → DOWN (never appears operational when AI is down)", () => {
  assert.equal(deriveSystemStatus([provider("DISCONNECTED"), provider("DISCONNECTED")]), "DOWN");
});

test("one CONNECTED + one DISCONNECTED → DEGRADED", () => {
  assert.equal(deriveSystemStatus([provider("CONNECTED"), provider("DISCONNECTED")]), "DEGRADED");
});

test("only DEGRADED providers → DEGRADED (still usable)", () => {
  assert.equal(deriveSystemStatus([provider("DEGRADED")]), "DEGRADED");
});

test("CONNECTED + DEGRADED → DEGRADED", () => {
  assert.equal(deriveSystemStatus([provider("CONNECTED"), provider("DEGRADED")]), "DEGRADED");
});

test("DISCONNECTED + UNKNOWN (no usable provider) → DOWN", () => {
  assert.equal(deriveSystemStatus([provider("DISCONNECTED"), provider("UNKNOWN")]), "DOWN");
});

test("status dots map to the documented emojis", () => {
  assert.equal(statusDot("CONNECTED"), "🟢");
  assert.equal(statusDot("DEGRADED"), "🟡");
  assert.equal(statusDot("DISCONNECTED"), "🔴");
  assert.equal(statusDot("UNKNOWN"), "⚪");
});
