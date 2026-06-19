// POST /api/csp-report — receives Content-Security-Policy violation reports from browsers.
// The browser sends a JSON body with a "csp-report" key (CSP Level 2/3 format).
// Auth not required — browsers send this without credentials.

import { NextResponse } from 'next/server';
import { getAdminSupabase, isAdminConfigured } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CspReport {
  'document-uri'?:        string;
  'violated-directive'?:  string;
  'effective-directive'?: string;
  'blocked-uri'?:         string;
  'source-file'?:         string;
  'line-number'?:         number;
  'column-number'?:       number;
}

export async function POST(req: Request) {
  // Ignore if backend not configured (avoid 500 noise)
  if (!isAdminConfigured()) return new Response(null, { status: 204 });

  let report: CspReport = {};
  try {
    const body = await req.json() as Record<string, unknown>;
    report = (body['csp-report'] as CspReport) ?? (body as CspReport);
  } catch {
    return new Response(null, { status: 400 });
  }

  // Silently swallow; CSP reports must never block page load
  try {
    await getAdminSupabase().from('csp_violations').insert({
      document_uri:        report['document-uri']?.slice(0, 500),
      violated_directive:  report['violated-directive'],
      effective_directive: report['effective-directive'],
      blocked_uri:         report['blocked-uri']?.slice(0, 500),
      source_file:         report['source-file']?.slice(0, 500),
      line_number:         report['line-number'] ?? null,
      column_number:       report['column-number'] ?? null,
      user_agent:          req.headers.get('user-agent')?.slice(0, 500),
    });
  } catch { /* swallow */ }

  return new Response(null, { status: 204 });
}
