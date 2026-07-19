// ── Admin role helpers ─────────────────────────────────────────────────────────
// Role-rank comparisons used by the admin API guards in ./server.ts
// (requireAdmin and friends). Authorization on every admin route goes through
// those guards; there is deliberately no second permission system here.
//
// Role hierarchy (highest → lowest):
//   OWNER > ADMIN > STAFF > BETA_TESTER > USER

import type { AdminRole } from "./types";

/** Numeric rank for role comparisons. Higher = more authority. */
const ROLE_RANK: Record<AdminRole, number> = {
  OWNER:       100,
  ADMIN:        80,
  STAFF:        60,
  BETA_TESTER:  20,
  USER:          0,
};

/** Returns true if the role has any administrative elevation above USER. */
export function isElevatedRole(role: AdminRole): boolean {
  return ROLE_RANK[role] > ROLE_RANK["USER"];
}

/**
 * Returns true when `role` satisfies a minimum role requirement.
 * Use this for "at least ADMIN" style guards in API routes.
 */
export function meetsMinRole(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}
