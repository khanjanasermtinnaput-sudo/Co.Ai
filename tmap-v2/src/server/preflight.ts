// Deploy preflight assessment (pure / side-effect-free).
//
// Separated from server/index.ts so it can be unit-tested without booting the
// HTTP server. index.ts wraps this with the fail-fast behaviour: in production
// any problem aborts boot; elsewhere it only warns.

export interface PreflightResult {
  problems: string[];
}

function truthy(v: string | undefined): boolean {
  return ["1", "true"].includes((v ?? "").trim().toLowerCase());
}

/**
 * Evaluate critical deployment prerequisites against an environment bag.
 * Returns the list of human-readable problems (empty === healthy).
 *
 * Production-required (unless explicitly overridden):
 *   • JWT_SECRET, COAGENTIX_MASTER_KEY — 16+ chars
 *   • Durable storage (Supabase)       — override COAGENTIX_ALLOW_EPHEMERAL_DB=1
 *   • Redis (REDIS_URL / REDIS_HOST)   — override COAGENTIX_ALLOW_NO_REDIS=1
 */
export function assessPreflight(env: NodeJS.ProcessEnv = process.env): PreflightResult {
  const problems: string[] = [];

  const missing: string[] = [];
  if ((env.JWT_SECRET?.length ?? 0) < 16) missing.push("JWT_SECRET");
  if (((env.COAGENTIX_MASTER_KEY ?? env.AOF_MASTER_KEY)?.length ?? 0) < 16) missing.push("COAGENTIX_MASTER_KEY");
  if (missing.length) {
    problems.push(`Missing/weak required env: ${missing.join(", ")} (need 16+ chars)`);
  }

  const hasSupabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  if (!hasSupabase && !truthy(env.COAGENTIX_ALLOW_EPHEMERAL_DB)) {
    problems.push(
      "No durable storage: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or user " +
        "accounts and encrypted API keys are lost on redeploy. " +
        "Set COAGENTIX_ALLOW_EPHEMERAL_DB=1 to override intentionally.",
    );
  }

  const hasRedis = Boolean(env.REDIS_URL || env.REDIS_HOST);
  if (!hasRedis && !truthy(env.COAGENTIX_ALLOW_NO_REDIS)) {
    problems.push(
      "No Redis: set REDIS_URL (or REDIS_HOST), or the login lockout and rate " +
        "limiter degrade to per-instance memory and the lockout fails OPEN. " +
        "Set COAGENTIX_ALLOW_NO_REDIS=1 to override intentionally (single-instance only).",
    );
  }

  return { problems };
}
