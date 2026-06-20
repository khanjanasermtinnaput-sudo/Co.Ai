// Bot protection middleware — UA-heuristic score-based blocking.
// Assigns a suspicion score based on User-Agent signals; blocks requests above
// the threshold with a 403.  Known legitimate crawlers (Googlebot, etc.) are
// scored low even though they are bots, because blocking them hurts SEO.

import type { RequestHandler } from 'express';

interface BotProtectionOptions {
  /** Paths matching this regex are exempt from bot checks (e.g. /v1/health). */
  skipPaths?: RegExp;
  /** Score 0-100 above which a request is blocked (default 80). */
  blockThreshold?: number;
}

// Patterns that strongly indicate a malicious scraper/scanner
const BAD_UA_PATTERNS: Array<[RegExp, number]> = [
  [/python-requests\//i,       40],
  [/curl\//i,                  20],
  [/scrapy\//i,                70],
  [/Go-http-client\//i,        30],
  [/Java\//i,                  30],
  [/libwww-perl\//i,           60],
  [/masscan\//i,               90],
  [/nmap\//i,                  90],
  [/nikto\//i,                 90],
  [/dirbuster/i,               90],
  [/sqlmap\//i,                90],
  [/nuclei\//i,                80],
  [/zgrab\//i,                 80],
  [/headless/i,                50],
  [/phantom/i,                 50],
  [/selenium/i,                60],
  [/puppeteer/i,               60],
];

// Known good bots — reduce their score
const GOOD_BOT_UA: RegExp[] = [
  /Googlebot/i,
  /bingbot/i,
  /Slurp/i,
  /DuckDuckBot/i,
  /Baiduspider/i,
  /YandexBot/i,
  /Sogou/i,
  /facebot/i,
  /Twitterbot/i,
  /LinkedInBot/i,
];

function scoreUA(ua: string | undefined): number {
  if (!ua) return 60;  // missing UA is mildly suspicious

  // Legitimate browsers score 0
  if (/Mozilla\/5\.0.*(?:Chrome|Firefox|Safari|Edge)/i.test(ua)) return 0;

  // Known-good crawlers
  if (GOOD_BOT_UA.some((re) => re.test(ua))) return 5;

  let score = 0;
  for (const [re, points] of BAD_UA_PATTERNS) {
    if (re.test(ua)) score += points;
  }
  return Math.min(score, 100);
}

export function botProtectionMiddleware(opts: BotProtectionOptions = {}): RequestHandler {
  const threshold = opts.blockThreshold ?? 80;
  return (req, res, next) => {
    if (opts.skipPaths?.test(req.path)) return next();

    const ua    = req.headers['user-agent'];
    const score = scoreUA(ua);

    if (score >= threshold) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Attach score to request for logging purposes
    (req as unknown as Record<string, unknown>)['botScore'] = score;
    next();
  };
}
