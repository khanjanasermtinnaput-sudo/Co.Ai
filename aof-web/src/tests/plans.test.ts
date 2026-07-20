import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  PRICING_TIERS,
  hasFeature,
  minTierForFeature,
  effectiveDailyMessages,
  byokBonusLabel,
  entitlementsEnforced,
} from "../lib/plans";
import { evaluateFeature } from "../lib/access";

function withEnforcement<T>(on: boolean, fn: () => T): T {
  const prev = process.env.NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS;
  process.env.NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS = on ? "1" : "";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS;
    else process.env.NEXT_PUBLIC_COAGENTIX_ENFORCE_PLANS = prev;
  }
}

// ── Catalog integrity ─────────────────────────────────────────────────────────
test("pricing tiers are priced in ascending THB order", () => {
  const prices = PRICING_TIERS.map((t) => PLANS[t].priceTHB);
  assert.deepEqual(prices, [0, 49, 149, 399]);
});

test("features are cumulative up the tiers", () => {
  // Everything LITE has, PRO and ADVANCED also have.
  for (const f of PLANS.LITE.features) {
    assert.ok(PLANS.PRO.features.includes(f), `PRO missing ${f}`);
    assert.ok(PLANS.ADVANCED.features.includes(f), `ADVANCED missing ${f}`);
  }
});

test("tier-specific features land on the right plan", () => {
  assert.ok(PLANS.PRO.features.includes("coagentix-code"));
  assert.ok(!PLANS.LITE.features.includes("coagentix-code"));
  assert.ok(PLANS.ADVANCED.features.includes("titan"));
  assert.ok(!PLANS.PRO.features.includes("titan"));
});

// ── hasFeature with enforcement flag ──────────────────────────────────────────
test("enforcement ON: FREE/LITE cannot use CoCode, PRO/ADVANCED can", () => {
  withEnforcement(true, () => {
    assert.equal(entitlementsEnforced(), true);
    assert.equal(hasFeature("FREE", "coagentix-code"), false);
    assert.equal(hasFeature("LITE", "coagentix-code"), false);
    assert.equal(hasFeature("PRO", "coagentix-code"), true);
    assert.equal(hasFeature("ADVANCED", "coagentix-code"), true);
    assert.equal(hasFeature("PRO", "titan"), false);
    assert.equal(hasFeature("ADVANCED", "titan"), true);
  });
});

test("enforcement OFF: any signed-in tier is entitled, guests are not", () => {
  withEnforcement(false, () => {
    assert.equal(hasFeature("FREE", "coagentix-code"), true);
    assert.equal(hasFeature("FREE", "titan"), true);
    assert.equal(hasFeature("GUEST", "coagentix-code"), false);
  });
});

// ── evaluateFeature → AccessResult ────────────────────────────────────────────
test("evaluateFeature points guests to login and FREE to an upgrade (enforced)", () => {
  withEnforcement(true, () => {
    const guest = evaluateFeature("titan", { tier: "GUEST" });
    assert.equal(guest.allowed, false);
    assert.equal(guest.requiresLogin, true);

    const free = evaluateFeature("titan", { tier: "FREE" });
    assert.equal(free.allowed, false);
    assert.equal(free.requiresUpgrade, true);
    assert.equal(free.upgradeTo, "ADVANCED");
  });
});

test("evaluateFeature: CoCode requires Pro, not just any signed-in tier (enforced)", () => {
  withEnforcement(true, () => {
    for (const tier of ["FREE", "LITE"] as const) {
      const r = evaluateFeature("coagentix-code", { tier });
      assert.equal(r.allowed, false, `${tier} should not have CoCode`);
      assert.equal(r.requiresUpgrade, true);
      assert.equal(r.upgradeTo, "PRO");
    }
    for (const tier of ["PRO", "ADVANCED"] as const) {
      assert.equal(evaluateFeature("coagentix-code", { tier }).allowed, true, `${tier} should have CoCode`);
    }
  });
});

test("minTierForFeature resolves the cheapest unlocking tier", () => {
  assert.equal(minTierForFeature("projects"), "LITE");
  assert.equal(minTierForFeature("coagentix-code"), "PRO");
  assert.equal(minTierForFeature("titan"), "ADVANCED");
});

// ── BYOK bonus (spec §13) ─────────────────────────────────────────────────────
test("BYOK multipliers match the spec", () => {
  assert.equal(PLANS.FREE.byokMultiplier, 3);
  assert.equal(PLANS.LITE.byokMultiplier, 2);
  assert.equal(PLANS.PRO.byokMultiplier, 1.5);
  assert.equal(PLANS.ADVANCED.byokMultiplier, 1.25);
});

test("effectiveDailyMessages applies the BYOK bonus", () => {
  assert.equal(effectiveDailyMessages("FREE", false), 20);
  assert.equal(effectiveDailyMessages("FREE", true), 60); // 20 × 3
  assert.equal(effectiveDailyMessages("LITE", true), 400); // 200 × 2
  assert.equal(effectiveDailyMessages("ADVANCED", true), Infinity);
});

test("byokBonusLabel renders a percent boost", () => {
  assert.equal(byokBonusLabel("FREE"), "+200%");
  assert.equal(byokBonusLabel("PRO"), "+50%");
});
