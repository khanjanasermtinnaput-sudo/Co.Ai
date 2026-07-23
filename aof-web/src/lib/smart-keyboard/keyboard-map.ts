/**
 * Thai Kedmanee keyboard layout ↔ English QWERTY mapping.
 * Standard: TIS 820-2531 (Thai Industrial Standard)
 *
 * Verification: "l;ylfu8iy[" → "สวัสดีครับ" (l→ส, ;→ว, y→ั, l→ส, f→ด, u→ี, 8→ค, i→ร, y→ั, [→บ)
 */

export const EN_TO_TH_MAP: Readonly<Record<string, string>> = {
  // ── Number row (unshifted) ──────────────────────────────────────────────
  '`': 'ๆ',
  '1': 'ๅ',
  '2': '/',
  '3': '-',
  '4': 'ภ',
  '5': 'ถ',
  '6': 'ุ',
  '7': 'ึ',
  '8': 'ค',
  '9': 'ต',
  '0': 'จ',
  '-': 'ข',
  '=': 'ช',
  // ── Number row (shifted) ───────────────────────────────────────────────
  '~': '%',
  '!': '+',
  '@': '๑',
  '#': '๒',
  '$': '๓',
  '%': '๔',
  '^': 'ู',
  '&': '฿',
  '*': 'ฉ',
  '(': 'ฌ',
  ')': 'ข', // same Thai char as -
  '_': 'ข', // same Thai char as -
  '+': 'ฅ',
  // ── QWERTY row (unshifted) ─────────────────────────────────────────────
  'q': 'ๆ', // same as `
  'w': 'ไ',
  'e': 'ำ',
  'r': 'พ',
  't': 'ะ',
  'y': 'ั',
  'u': 'ี',
  'i': 'ร',
  'o': 'น',
  'p': 'ย',
  '[': 'บ',
  ']': 'ล',
  '\\': 'ฃ',
  // ── QWERTY row (shifted) ───────────────────────────────────────────────
  'Q': 'ๆ',
  'W': 'ไ',
  'E': 'ำ',
  'R': 'พ',
  'T': 'ะ',
  'Y': 'ั',
  'U': 'ี',
  'I': 'ร',
  'O': 'น',
  'P': 'ย',
  '{': 'ฎ',
  '}': 'ฑ',
  '|': 'ธ',
  // ── Home row (unshifted) ───────────────────────────────────────────────
  'a': 'ฟ',
  's': 'ห',
  'd': 'ก',
  'f': 'ด',
  'g': 'เ',
  'h': '้',
  'j': '่',
  'k': 'า',
  'l': 'ส',
  ';': 'ว',
  "'": 'ง',
  // ── Home row (shifted) ────────────────────────────────────────────────
  'A': 'ฤ',
  'S': 'ฆ',
  'D': 'ฏ',
  'F': 'โ',
  'G': 'ฌ',
  'H': '็',
  'J': '๋',
  'K': 'ษ',
  'L': 'ศ',
  ':': 'ซ',
  '"': '.',
  // ── Bottom row (unshifted) ─────────────────────────────────────────────
  'z': 'ผ',
  'x': 'ป',
  'c': 'แ',
  'v': 'อ',
  'b': 'ิ',
  'n': 'ื',
  'm': 'ท',
  ',': 'ม',
  '.': 'ใ',
  '/': 'ฝ',
  // ── Bottom row (shifted) ───────────────────────────────────────────────
  'Z': 'ฦ',
  'X': 'ฐ',
  'C': 'ฉ',
  'V': 'ฮ',
  'B': '์',
  'N': 'ฬ',
  'M': 'ฒ',
  '<': 'ฑ',
  '>': 'ธ',
  '?': 'ฃ',
} as const;

/**
 * Thai → English reverse map.
 * When multiple English keys share the same Thai output (e.g. `-`, `)`, `_` all → `ข`),
 * this map prefers the most common unshifted key (first inserted wins).
 */
export const TH_TO_EN_MAP: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const [en, th] of Object.entries(EN_TO_TH_MAP)) {
    if (!(th in map)) map[th] = en;
  }
  return map;
})();

/** Thai consonants — U+0E01 to U+0E2E */
export const THAI_CONSONANTS = new Set(
  'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ'.split('')
);

/** Thai dependent marks: above/below vowels and tone marks. Must follow a consonant. */
export const THAI_DEPENDENT_MARKS = new Set(
  'ิีึืุูั็่้๊๋์ํ'.split('')
);

/** Thai lead vowels — appear before the consonant in display order */
export const THAI_LEAD_VOWELS = new Set('เแโใไ'.split(''));

/** Thai trailing vowels and special forms */
export const THAI_TRAILING_VOWELS = new Set('าๆๅำะ'.split(''));

/** Thai Unicode block range check */
export const THAI_RANGE_RE = /[฀-๿]/;
export const THAI_RANGE_GLOBAL_RE = /[฀-๿]/g;
