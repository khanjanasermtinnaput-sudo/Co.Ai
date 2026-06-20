// CDN support — cache-control profiles, ETag generation, surrogate keys,
// stale-while-revalidate, Vary headers, and asset fingerprinting.

import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// ── Cache profiles ─────────────────────────────────────────────────────────────

export type CacheProfile =
  | 'immutable'    // hashed static assets — cache forever
  | 'static'       // long-lived, 1 day + SWR 1 h
  | 'api-public'   // public API — 5 min + SWR 60 s
  | 'api-private'  // auth-gated — private cache only
  | 'no-store';    // never cache (mutations, auth)

const CACHE_HEADERS: Record<CacheProfile, string> = {
  'immutable':   'public, max-age=31536000, immutable',
  'static':      'public, max-age=86400, stale-while-revalidate=3600',
  'api-public':  'public, max-age=300, stale-while-revalidate=60, stale-if-error=86400',
  'api-private': 'private, max-age=0, must-revalidate',
  'no-store':    'no-store, no-cache, must-revalidate',
};

export function setCacheProfile(res: Response, profile: CacheProfile): void {
  res.setHeader('Cache-Control', CACHE_HEADERS[profile]);
  if (profile === 'no-store' || profile === 'api-private') {
    res.setHeader('Pragma',  'no-cache');
    res.setHeader('Expires', '0');
  }
}

// ── ETag ──────────────────────────────────────────────────────────────────────

export function generateETag(content: string | Buffer): string {
  const hash = createHash('sha1').update(content).digest('base64url').slice(0, 16);
  return `"${hash}"`;
}

export function withETag(req: Request, res: Response, body: unknown, profile: CacheProfile = 'api-public'): boolean {
  setCacheProfile(res, profile);
  const str  = typeof body === 'string' ? body : JSON.stringify(body);
  const etag = generateETag(str);
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return true; // caller should not send body
  }
  return false;
}

// ── Surrogate / cache-tag keys (Fastly, Varnish, Cloudflare) ─────────────────

export function setSurrogateKeys(res: Response, ...keys: string[]): void {
  res.setHeader('Surrogate-Key', keys.join(' '));  // Fastly/Varnish
  res.setHeader('Cache-Tag',     keys.join(','));  // Cloudflare
}

// ── Vary headers ──────────────────────────────────────────────────────────────

export function addVary(res: Response, ...fields: string[]): void {
  const existing = res.getHeader('Vary');
  const current  = typeof existing === 'string' ? existing.split(', ').filter(Boolean) : [];
  res.setHeader('Vary', [...new Set([...current, ...fields])].join(', '));
}

// ── Asset fingerprinting ──────────────────────────────────────────────────────

export function fingerprintUrl(url: string, content: string | Buffer): string {
  const hash = createHash('md5').update(content).digest('hex').slice(0, 8);
  const sep  = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${hash}`;
}

// ── CDN response metadata middleware ─────────────────────────────────────────

export function cdnHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-CDN-Cache', 'MISS'); // CDN overwrites to HIT
    next();
  };
}

// ── Public API ETag middleware ────────────────────────────────────────────────

export function etagMiddleware(profile: CacheProfile = 'api-public') {
  return (req: Request, res: Response, next: NextFunction) => {
    const origJson = res.json.bind(res);
    res.json = function (body: unknown) {
      if (withETag(req, res, body, profile)) return res;
      return origJson(body);
    };
    next();
  };
}
