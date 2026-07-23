import { EN_TO_TH_MAP, TH_TO_EN_MAP, THAI_RANGE_RE } from './keyboard-map';

// ─── Safety patterns ──────────────────────────────────────────────────────────
// These patterns indicate the text should NOT be auto-converted.

const UNSAFE_PATTERNS: RegExp[] = [
  /https?:\/\/\S+/,                              // HTTP/HTTPS URLs
  /www\.\w+\.\w+/,                               // www.* URLs
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // email addresses
  /`[^`]*`|```[\s\S]*?```/,                      // inline code or fenced blocks
  /`/,                                            // lone backtick = code context
  /\b(?:const|let|var|function|class|import|export|return|if|else|for|while|do|switch|case|interface|type|enum|async|await|typeof|instanceof|void|null|undefined|true|false)\b/, // JS/TS keywords
  /[A-Z]:[\\\/]/,                               // Windows paths: C:\ D:/
  /\/(?:usr|home|etc|var|tmp|bin|opt|srv|proc)\//,  // Unix paths
  /(?:=>|===|!==|>=|<=|\|\||&&|\.\.\.|::)/,    // JS/TS operators
  /^#!.*\n/m,                                    // shebang
];

/**
 * Returns true when the text is safe to attempt auto-conversion.
 * Texts containing URLs, emails, code, programming syntax, or file paths
 * are never auto-converted to prevent breaking user intent.
 */
export function isSafeToConvert(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return !UNSAFE_PATTERNS.some((re) => re.test(text));
}

// ─── Conversion functions ─────────────────────────────────────────────────────

/**
 * Converts English QWERTY input to Thai Kedmanee output.
 * Characters not in the mapping are passed through unchanged (spaces, numbers
 * that don't map, etc.).
 *
 * @example convertEnToTh("l;ylfu8iy[") === "สวัสดีครับ"
 */
export function convertEnToTh(text: string): string {
  let result = '';
  for (const ch of text) {
    result += EN_TO_TH_MAP[ch] ?? ch;
  }
  return result;
}

/**
 * Converts Thai Kedmanee characters back to English QWERTY.
 * Characters not in the mapping (Latin letters, digits, symbols) pass through.
 *
 * @example convertThToEn("สวัสดีครับ") === "l;ylfu8iy["
 */
export function convertThToEn(text: string): string {
  let result = '';
  for (const ch of text) {
    if (THAI_RANGE_RE.test(ch)) {
      result += TH_TO_EN_MAP[ch] ?? ch;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Converts text based on detected direction.
 * Returns the original text if direction is 'none'.
 */
export function convertByDirection(
  text: string,
  direction: 'en->th' | 'th->en' | 'none'
): string {
  if (direction === 'en->th') return convertEnToTh(text);
  if (direction === 'th->en') return convertThToEn(text);
  return text;
}
