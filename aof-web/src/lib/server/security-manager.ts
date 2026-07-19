// ── Security & Permission Manager — Co.AI Master Prompt v1.0 Part 6.10 ───────
// The ONE facade for every security-relevant decision on the /api/chat
// runtime. Delegates to EXISTING real implementations — this is a facade,
// not a rewrite of the systems it wraps:
//   authenticate()   -> supabase-admin.ts's getUserFromRequest (unchanged)
//   resolveSecrets() -> keys-store.ts's loadUserKeyOverrides (unchanged)
//   redactForLog()   -> errors.ts's redact (unchanged)
//   checkEgress()    -> re-exported from ai-providers.ts, where it's
//                       co-located with the real provider URL config it
//                       reads (importing it back FROM here would create a
//                       cycle: ai-providers.ts calls it before every
//                       operator-configured fetch, and needs no dependency
//                       on this facade to do so).
// Plus genuinely new capability this runtime didn't have before:
//   assessKeyAccessRisk() -> honest, signal-based scoring for the one
//                       privileged action this path takes: reading a
//                       user's stored provider key. Real signals only
//                       (per-user key present, vs. env fallback) — never a
//                       fabricated numeric score.
//   auditSecurityEvent()  -> aof-web has no audit log today (only
//                       tmap-v2's server/audit.ts does). Mirrors its event
//                       shape — separate packages, no shared workspace,
//                       same precedent as crypto.ts and the Tool Execution
//                       Engine's two independent copies.
//
// Deliberately has NO checkToolPermission()-style method: /api/chat has no
// write surface and no tool execution at all — every agent produces exactly
// ONE text artifact (agent-registry.ts's AGENT_CONTRACT says so explicitly).
// The REAL Tool Permission Engine (Part 6.3's permissionSatisfied ladder)
// already exists in tmap-v2/src/v2/tools/registry.ts, where tools actually
// run (the CLI gates its own fs/git/terminal ops directly in
// coagentix-cli/src/files.ts, git.ts and terminal.ts). Faking an
// aof-web analog with nothing to gate would be exactly the scaffold this
// repo's discipline forbids (orchestrator.ts's own header documents the
// same principle for Part 5.5's omitted Event Bus/Recovery Engine).
//
// Fail-closed: every check here defaults to the safest outcome on internal
// error — deny, redact, or log — never silently passes an unchecked
// decision through.

import { getUserFromRequest } from "./supabase-admin";
import { loadUserKeyOverrides } from "./keys-store";
import { redact } from "@/lib/errors";
import { checkEgress, type EgressDecision, type KeyOverrides } from "./ai-providers";
import { logAofInfo } from "./ai-log";

export { checkEgress, type EgressDecision };

export interface AuthDecision {
  authenticated: boolean;
  userId?: string;
}

/** Wraps getUserFromRequest — never throws (mirrors route.ts's own
 *  `.catch(() => null)` at the call site this replaces). */
export async function authenticate(req: Request): Promise<AuthDecision> {
  try {
    const user = await getUserFromRequest(req);
    return { authenticated: !!user, userId: user?.id };
  } catch {
    return { authenticated: false };
  }
}

/** Wraps loadUserKeyOverrides — already never-throws by its own contract
 *  (falls back to env on any failure); named as a security decision here
 *  so it goes through the same facade as every other one. */
export async function resolveSecrets(userId: string | undefined): Promise<KeyOverrides> {
  return loadUserKeyOverrides(userId);
}

export function redactForLog(text: string | undefined): string | undefined {
  return redact(text);
}

// ── Risk Assessment ───────────────────────────────────────────────────────
export type RiskLevel = "low" | "medium";

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
}

/** /api/chat's only privileged data access is reading a user's stored
 *  provider key. Real signal only: whether a per-user key exists (a
 *  materially different trust boundary than the server's own env key) —
 *  never a fabricated numeric "risk score" invented from nothing. */
export function assessKeyAccessRisk(overrides: KeyOverrides): RiskAssessment {
  const usesPerUserKey = Object.keys(overrides).length > 0;
  return usesPerUserKey
    ? { level: "medium", reason: "request will use a per-user stored provider key" }
    : { level: "low", reason: "request uses the server's own configured provider key(s)" };
}

// ── Audit ─────────────────────────────────────────────────────────────────
export type SecurityAuditAction = "auth" | "key-access" | "egress-denied" | "rate-limit-block";

export interface SecurityAuditEvent {
  action: SecurityAuditAction;
  requestId: string;
  userId?: string;
  detail?: string;
}

/** Logged, not (yet) persisted to a table — aof-web has no audit_events
 *  schema today (tmap-v2's server/audit.ts persists to Supabase + a local
 *  JSONL fallback; adding that table is a real, separate migration this
 *  phase doesn't take on). Uses the SAME [AOF] console sink as every other
 *  security-relevant log line so it's greppable alongside them, and runs
 *  every value through redactForLog so an audited `detail` string can
 *  never leak a secret into the log. */
export function auditSecurityEvent(event: SecurityAuditEvent): void {
  const detail = redactForLog(event.detail);
  logAofInfo(
    `[SECURITY AUDIT] action=${event.action} requestId=${event.requestId}` +
      (event.userId ? ` userId=${event.userId}` : "") +
      (detail ? ` detail=${detail}` : ""),
  );
}
