// ── Deploy preflight (Next.js instrumentation) ────────────────────────────────
// register() runs once when the Next.js server process starts. It asserts that
// the secrets the app needs in production are present before any request is
// served. In production a missing secret aborts boot (fail-fast); in development
// it only warns so local runs work without a full backend.

export async function register(): Promise<void> {
  // Only the Node.js server runtime has process.env secrets — skip the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const required: Array<{ name: string; ok: boolean }> = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) },
    { name: "SUPABASE_SERVICE_ROLE_KEY", ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) },
    {
      name: "COAGENTIX_MASTER_KEY",
      ok: ((process.env.COAGENTIX_MASTER_KEY ?? process.env.AOF_MASTER_KEY)?.length ?? 0) >= 16,
    },
  ];

  const missing = required.filter((r) => !r.ok).map((r) => r.name);
  if (missing.length === 0) return;

  const msg = `[preflight] Missing required env: ${missing.join(", ")}`;
  if (process.env.NODE_ENV === "production") {
    console.error(`${msg} — refusing to start in production.`);
    process.exit(1);
  }
  console.warn(`${msg} — continuing in development mode.`);
}
