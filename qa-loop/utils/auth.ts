/**
 * Authenticated-session helper — mints a real Supabase session via the
 * password grant so API-level tests can exercise routes behind auth.
 *
 * Needs QA_SUPABASE_URL + QA_SUPABASE_ANON_KEY + QA_TEST_EMAIL/PASSWORD.
 * The /login UI is Google-OAuth-only, so this is the ONLY automatable path
 * to a session. The token is cached per harness run; never log it.
 */
import { config } from "../config.ts";

export type Session = { token: string; userId: string };

let cached: Session | null = null;

export function authConfigured(): boolean {
  return Boolean(
    config.supabaseUrl && config.supabaseAnonKey && config.testEmail && config.testPassword,
  );
}

export async function mintSession(): Promise<Session | { error: string }> {
  if (cached) return cached;
  if (!authConfigured()) return { error: "QA auth env not configured" };
  return passwordGrant(config.testEmail, config.testPassword).then((r) => {
    if ("token" in r) cached = r;
    return r;
  });
}

/** Raw password grant — exported so tests can also assert the FAILURE path. */
export async function passwordGrant(
  email: string,
  password: string,
): Promise<Session | { error: string; status?: number }> {
  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      user?: { id?: string };
      error_description?: string;
      msg?: string;
    };
    if (!res.ok || !json.access_token) {
      return {
        error: json.error_description ?? json.msg ?? `HTTP ${res.status}`,
        status: res.status,
      };
    }
    return { token: json.access_token, userId: json.user?.id ?? "" };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
