// ── Shared request validation (zod) ───────────────────────────────────────────
// One place to parse + validate untrusted input (JSON bodies, query params, route
// params) so every API route fails the same way: a 400 with structured issues
// instead of throwing or silently coercing malformed input.

import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export type Parsed<T> =
  | { data: T; error?: undefined }
  | { data?: undefined; error: NextResponse };

function fail(issues: { path: string; message: string }[]): NextResponse {
  return NextResponse.json({ error: "validation-failed", issues }, { status: 400 });
}

function toIssues(err: { issues: { path: (string | number)[]; message: string }[] }) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Parse + validate a JSON request body. Returns typed data or a 400 response. */
export async function parseJsonBody<T>(req: Request, schema: ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "invalid-json" }, { status: 400 }) };
  }
  const r = schema.safeParse(raw);
  if (!r.success) return { error: fail(toIssues(r.error)) };
  return { data: r.data };
}

/** Validate URL search params (query string) against a schema. */
export function parseQuery<T>(req: Request, schema: ZodType<T>): Parsed<T> {
  const obj = Object.fromEntries(new URL(req.url).searchParams.entries());
  const r = schema.safeParse(obj);
  if (!r.success) return { error: fail(toIssues(r.error)) };
  return { data: r.data };
}

/** Validate a route-params object (e.g. Next.js `{ params }`) against a schema. */
export function parseParams<T>(params: unknown, schema: ZodType<T>): Parsed<T> {
  const r = schema.safeParse(params);
  if (!r.success) return { error: fail(toIssues(r.error)) };
  return { data: r.data };
}
