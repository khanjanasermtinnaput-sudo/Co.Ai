// Bot protection — score-based heuristics + optional Cloudflare Turnstile.
// Returns a risk score 0–100. Requests scoring >= BOT_BLOCK_THRESHOLD are blocked.

export interface BotRisk {
  score:   number;    // 0 = clean, 100 = bot
  reasons: string[];
  blocked: boolean;
}

const BOT_BLOCK_THRESHOLD = parseInt(process.env.BOT_BLOCK_THRESHOLD ?? '80', 10);

// Known bad UA patterns
const BOT_UA_PATTERNS: RegExp[] = [
  /python-requests/i,
  /curl\//i,
  /wget\//i,
  /go-http-client/i,
  /java\/\d/i,
  /libwww-perl/i,
  /scrapy/i,
  /phantomjs/i,
  /headlesschrome/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
  /httpclient/i,
  /okhttp/i,
  /aiohttp/i,
];

// UAs that are clearly browsers — low risk signals
const BROWSER_UA_PATTERN = /mozilla\/5\.0/i;

export function assessBotRisk(req: Request): BotRisk {
  const ua = req.headers.get('user-agent') ?? '';
  const accept = req.headers.get('accept') ?? '';
  const acceptLang = req.headers.get('accept-language') ?? '';
  const acceptEnc = req.headers.get('accept-encoding') ?? '';
  const secFetch = req.headers.get('sec-fetch-site') ?? '';
  const reasons: string[] = [];
  let score = 0;

  // No UA = 60
  if (!ua) {
    reasons.push('missing_user_agent');
    score += 60;
  } else if (BOT_UA_PATTERNS.some((r) => r.test(ua))) {
    reasons.push('bot_user_agent');
    score += 70;
  } else if (!BROWSER_UA_PATTERN.test(ua)) {
    reasons.push('non_browser_user_agent');
    score += 30;
  }

  // Missing Accept header in a browser context
  if (!accept && ua) {
    reasons.push('missing_accept_header');
    score += 15;
  }

  // Missing Accept-Language suggests scripted client
  if (!acceptLang) {
    reasons.push('missing_accept_language');
    score += 10;
  }

  // Missing Accept-Encoding
  if (!acceptEnc) {
    reasons.push('missing_accept_encoding');
    score += 10;
  }

  // Sec-Fetch-Site present and none = direct navigation or scripted (neutral)
  // Its absence for POST requests is suspicious
  if (req.method === 'POST' && !secFetch) {
    reasons.push('missing_sec_fetch_site_on_post');
    score += 5;
  }

  score = Math.min(100, score);
  return { score, reasons, blocked: score >= BOT_BLOCK_THRESHOLD };
}

export function botBlockResponse(risk: BotRisk): Response {
  return new Response(JSON.stringify({ error: 'Request blocked', code: 'BOT_DETECTED' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'X-Bot-Score': risk.score.toString() },
  });
}

// Cloudflare Turnstile verification (optional, requires CF_TURNSTILE_SECRET_KEY env var)
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.CF_TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Turnstile not configured — allow

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const json = await res.json() as { success: boolean };
    return json.success === true;
  } catch {
    return true; // Network failure — allow (fail open)
  }
}
