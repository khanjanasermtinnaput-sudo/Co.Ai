// Bot protection middleware for tmap-v2 (Express).
// Score-based heuristics; blocks requests scoring >= BOT_BLOCK_THRESHOLD.

const BOT_BLOCK_THRESHOLD = parseInt(process.env.BOT_BLOCK_THRESHOLD ?? '80', 10);

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

const BROWSER_UA_PATTERN = /mozilla\/5\.0/i;

export interface BotRisk {
  score:   number;
  reasons: string[];
  blocked: boolean;
}

export function assessBotRisk(req: import('express').Request): BotRisk {
  const ua        = (req.headers['user-agent'] ?? '') as string;
  const accept    = (req.headers['accept'] ?? '') as string;
  const acceptLang = (req.headers['accept-language'] ?? '') as string;
  const acceptEnc = (req.headers['accept-encoding'] ?? '') as string;
  const reasons: string[] = [];
  let score = 0;

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

  if (!accept && ua) {
    reasons.push('missing_accept_header');
    score += 15;
  }
  if (!acceptLang) {
    reasons.push('missing_accept_language');
    score += 10;
  }
  if (!acceptEnc) {
    reasons.push('missing_accept_encoding');
    score += 10;
  }

  score = Math.min(100, score);
  return { score, reasons, blocked: score >= BOT_BLOCK_THRESHOLD };
}

export function botProtectionMiddleware(
  options: { skipPaths?: RegExp } = {},
): (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void {
  return (req, res, next) => {
    if (options.skipPaths?.test(req.path)) return next();

    const risk = assessBotRisk(req);
    res.setHeader('X-Bot-Score', risk.score.toString());

    if (risk.blocked) {
      res.status(403).json({
        error: 'Request blocked',
        code:  'BOT_DETECTED',
      });
      return;
    }
    next();
  };
}
