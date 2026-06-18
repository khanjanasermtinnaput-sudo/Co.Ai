// ── Admin permission system ────────────────────────────────────────────────────
// Defines what each role can do and provides guards used by API routes and
// middleware. All route checks go through canAccess(); individual capability
// checks go through hasPermission().
//
// Role hierarchy (highest → lowest):
//   OWNER > ADMIN > STAFF > BETA_TESTER > USER

import type { AdminRole, AdminPermission } from "./types";

// ── Role rank ─────────────────────────────────────────────────────────────────

/** Numeric rank for role comparisons. Higher = more authority. */
export const ROLE_RANK: Record<AdminRole, number> = {
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

/** Returns true if roleA outranks (or equals) roleB. */
export function roleAtLeast(roleA: AdminRole, roleB: AdminRole): boolean {
  return ROLE_RANK[roleA] >= ROLE_RANK[roleB];
}

// ── Role permissions ──────────────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  OWNER: [
    // Exclusive ownership capabilities
    "transfer-ownership",
    "grant-admin",
    "remove-admin",
    "emergency-controls",
    // Everything ADMIN can do
    "manage-users",
    "manage-subscriptions",
    "manage-codes",
    "view-analytics",
    "manage-features",
    "view-logs",
    // Everything STAFF can do
    "view-users",
    "provide-support",
    // Beta
    "access-beta",
    // Baseline
    "standard-access",
  ],

  ADMIN: [
    "manage-users",
    "manage-subscriptions",
    "manage-codes",
    "view-analytics",
    "manage-features",
    "view-logs",
    // Everything STAFF can do
    "view-users",
    "provide-support",
    // Beta
    "access-beta",
    // Baseline
    "standard-access",
  ],

  STAFF: [
    "view-users",
    "provide-support",
    // Baseline
    "standard-access",
  ],

  BETA_TESTER: [
    "access-beta",
    "standard-access",
  ],

  USER: [
    "standard-access",
  ],
};

// ── Permission guards ─────────────────────────────────────────────────────────

/**
 * Returns true when `role` holds `permission`.
 * This is the primary capability check — prefer this over comparing roles
 * directly so adding a new permission to a role propagates automatically.
 */
export function hasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// ── Route access map ──────────────────────────────────────────────────────────
// Maps admin route path prefixes to the permission required to access them.
// canAccess() does a prefix match so /admin/users/[id] is covered by /admin/users.

const ROUTE_PERMISSION_MAP: Array<{ prefix: string; permission: AdminPermission }> = [
  // Ownership-only
  { prefix: "/admin/settings/ownership",  permission: "transfer-ownership" },
  { prefix: "/admin/settings/emergency",  permission: "emergency-controls" },
  { prefix: "/admin/team/grant-admin",    permission: "grant-admin" },
  { prefix: "/admin/team/remove-admin",   permission: "remove-admin" },

  // Admin-level
  { prefix: "/admin/users",              permission: "manage-users" },
  { prefix: "/admin/subscriptions",      permission: "manage-subscriptions" },
  { prefix: "/admin/codes",              permission: "manage-codes" },
  { prefix: "/admin/analytics",          permission: "view-analytics" },
  { prefix: "/admin/flags",              permission: "manage-features" },
  { prefix: "/admin/logs",               permission: "view-logs" },
  { prefix: "/admin/announcements",      permission: "manage-features" },

  // Staff-level
  { prefix: "/admin/support",            permission: "provide-support" },

  // Admin root — requires at minimum staff-level viewing
  { prefix: "/admin",                    permission: "view-users" },
];

/**
 * Returns true when `role` is permitted to access `route`.
 * `route` should be the pathname, e.g. "/admin/users/abc-123".
 *
 * Matching uses the longest prefix first (most specific route wins).
 */
export function canAccess(role: AdminRole, route: string): boolean {
  // Sort by descending prefix length so most-specific entry wins.
  const sorted = [...ROUTE_PERMISSION_MAP].sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );

  for (const { prefix, permission } of sorted) {
    if (route === prefix || route.startsWith(prefix + "/") || route.startsWith(prefix + "?")) {
      return hasPermission(role, permission);
    }
  }

  // Routes not in the map are public / gated elsewhere.
  return true;
}

// ── API route guards (used inside Next.js API routes) ─────────────────────────

/**
 * Returns true when `role` satisfies a minimum role requirement.
 * Use this for simple "at least ADMIN" style guards in API routes.
 * For fine-grained capability checks, prefer hasPermission().
 */
export function meetsMinRole(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}
