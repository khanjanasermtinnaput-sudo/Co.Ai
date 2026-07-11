// ── Workspace discriminator (CoChat vs CoCode) ────────────────────────────────
// Single source of truth for the `workspace` values conversations/messages are
// scoped by. Matches the CHECK constraint added in migration 0010.

export const WORKSPACES = ["cochat", "cocode"] as const;
export type Workspace = (typeof WORKSPACES)[number];

/** Validates an unknown value against the workspace enum. Returns null if invalid/absent. */
export function parseWorkspace(value: unknown): Workspace | null {
  return typeof value === "string" && (WORKSPACES as readonly string[]).includes(value)
    ? (value as Workspace)
    : null;
}
