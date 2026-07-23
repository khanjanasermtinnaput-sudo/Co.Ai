import {
  EN_TO_TH_MAP,
  TH_TO_EN_MAP,
  THAI_CONSONANTS,
  THAI_DEPENDENT_MARKS,
  THAI_LEAD_VOWELS,
  THAI_TRAILING_VOWELS,
  THAI_RANGE_RE,
} from './keyboard-map';
import { convertEnToTh, convertThToEn, isSafeToConvert } from './converter';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LayoutDirection = 'en->th' | 'th->en' | 'none';

export interface DetectionResult {
  /** 0–100. Below 50 = do nothing. 50–79 = suggest only. 80–100 = auto-convert. */
  confidence: number;
  /** Detected conversion direction, or 'none' if uncertain. */
  type: LayoutDirection;
  /** The converted text if confidence >= 50, otherwise null. */
  converted: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** ASCII punctuation that rarely appears in English prose but maps to Thai keys */
const EN_THAI_SIGNAL_CHARS = new Set([';', '[', ']', '\\', "'", '{', '}', '|']);

/** ASCII digits that map to common Thai consonants (8→ค, 9→ต, 0→จ) */
const EN_THAI_NUMBER_SIGNALS = new Set(['8', '9', '0', '4', '5', '6', '7']);

/** English vowels — high ratio suggests real English, not Thai-in-wrong-layout */
const EN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U']);

// ─── Thai sequence scoring ────────────────────────────────────────────────────

/**
 * Scores a Thai string for linguistic validity (0–100).
 * High score = looks like valid Thai text.
 * Low score = garbled / wrong layout.
 *
 * Rules checked:
 * - Dependent marks (tone marks, above/below vowels) MUST follow a consonant
 * - Starting a word/string with a dependent mark is strongly penalised
 * - Consonants and lead vowels in correct positions score positively
 */
function scoreThaiSequence(thai: string): number {
  const chars = [...thai].filter((c) => c !== ' ' && c !== '\n' && c !== '\r');
  if (chars.length === 0) return 0;

  let score = 0;
  let prevWasConsonant = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (THAI_DEPENDENT_MARKS.has(ch)) {
      if (i === 0 || (!prevWasConsonant && i < 3)) {
        // Tone mark / dependent vowel at the very start = impossible in Thai
        score -= 30;
      } else if (prevWasConsonant) {
        score += 5; // valid placement
      } else {
        score += 1; // acceptable (stacked marks)
      }
      prevWasConsonant = false;
    } else if (THAI_CONSONANTS.has(ch)) {
      score += 5;
      prevWasConsonant = true;
    } else if (THAI_LEAD_VOWELS.has(ch)) {
      score += 3;
      prevWasConsonant = false;
    } else if (THAI_TRAILING_VOWELS.has(ch)) {
      score += 2;
      prevWasConsonant = false;
    } else if (THAI_RANGE_RE.test(ch)) {
      score += 1;
      prevWasConsonant = false;
    } else {
      prevWasConsonant = false;
    }
  }

  // Max possible score: every char is a consonant → chars.length * 5
  const maxScore = chars.length * 5;
  return Math.max(0, Math.min(100, (score / maxScore) * 100));
}

// ─── English sequence scoring ─────────────────────────────────────────────────

/**
 * Scores an ASCII string for "looks like natural English" (0–100).
 * Used when checking if Thai input was actually meant to be English.
 */
function scoreEnglishSequence(text: string): number {
  const chars = [...text].filter((c) => /\S/.test(c));
  if (chars.length === 0) return 0;

  let score = 0;
  let letterCount = 0;
  let vowelCount = 0;

  for (const ch of chars) {
    if (/[a-zA-Z]/.test(ch)) {
      letterCount++;
      score += 3;
      if (EN_VOWELS.has(ch)) {
        vowelCount++;
        score += 1;
      }
    } else if (/[0-9]/.test(ch)) {
      score += 1;
    } else if (/[.,!?'"-]/.test(ch)) {
      score += 1; // common English punctuation
    } else {
      score -= 5; // unusual chars (;, [, \, etc.)
    }
  }

  // Penalise very low vowel ratio (suggests consonant cluster = not English)
  if (letterCount > 3 && vowelCount / letterCount < 0.1) {
    score -= 20;
  }

  const maxScore = chars.length * 4;
  return Math.max(0, Math.min(100, (score / maxScore) * 100));
}

// ─── Main detection ───────────────────────────────────────────────────────────

/**
 * Detects whether the given text was typed in the wrong keyboard layout,
 * and returns a confidence score plus the suggested conversion direction.
 *
 * Confidence thresholds:
 *  - 0–49:  no action
 *  - 50–79: show suggestion only
 *  - 80–100: auto-convert
 *
 * Short texts (< 2 non-space chars) are always returned as 'none' to avoid
 * false positives on partial input.
 */
export function detectWrongLayout(text: string): DetectionResult {
  const NONE: DetectionResult = { confidence: 0, type: 'none', converted: null };

  if (!text || text.trim().length < 2) return NONE;

  // Code, URLs, emails, and file paths must never be auto-converted — even
  // callers that skip the isSafeToConvert() gate should get a benign result.
  if (!isSafeToConvert(text)) return NONE;

  const thaiCharCount = (text.match(/[฀-๿]/g) ?? []).length;
  const totalChars = [...text].filter((c) => !/\s/.test(c)).length;
  const latinWordCount = (text.match(/[a-zA-Z]{2,}/g) ?? []).length;

  // Mixed Thai + Latin text: the user is intentionally combining languages.
  // Don't interfere — this is too risky.
  if (thaiCharCount > 0 && latinWordCount > 0) {
    return NONE;
  }

  // ── Path A: text has Thai characters → check if user meant English ──────────
  if (thaiCharCount > 0) {
    const thaiRatio = thaiCharCount / totalChars;

    // Only check th→en when text is predominantly Thai
    if (thaiRatio < 0.6) return NONE;

    const asEnglish = convertThToEn(text);

    // If many Thai chars have no reverse mapping, conversion is unreliable
    const unmappedCount = [...text].filter(
      (c) => THAI_RANGE_RE.test(c) && !(c in TH_TO_EN_MAP)
    ).length;
    if (unmappedCount / thaiCharCount > 0.3) return NONE;

    const englishScore = scoreEnglishSequence(asEnglish);

    // Adjust: if original Thai sequence is itself valid, lower the confidence
    const thaiValidityScore = scoreThaiSequence(text);
    const adjustedScore = englishScore - thaiValidityScore * 0.5;

    const confidence = Math.max(0, Math.min(100, adjustedScore));

    if (confidence < 40) return NONE;
    return {
      confidence,
      type: 'th->en',
      converted: confidence >= 50 ? asEnglish : null,
    };
  }

  // ── Path B: text is ASCII only → check if user meant Thai ───────────────────
  if (thaiCharCount === 0) {
    // Check how many chars are actually in the EN_TO_TH map
    const mappableChars = [...text].filter((c) => c in EN_TO_TH_MAP);
    const mappableRatio = mappableChars.length / Math.max(1, totalChars);

    // If very few chars map to Thai keys, not a layout error
    if (mappableRatio < 0.5) return NONE;

    const asThai = convertEnToTh(text);
    const thaiScore = scoreThaiSequence(asThai);

    // Bonus for chars that are unusually specific to Thai input
    let signalBonus = 0;
    for (const ch of text) {
      if (EN_THAI_SIGNAL_CHARS.has(ch)) signalBonus += 8;
      else if (EN_THAI_NUMBER_SIGNALS.has(ch)) signalBonus += 4;
    }
    signalBonus = Math.min(30, signalBonus); // cap bonus

    // Penalty if text has a high ratio of common English vowels
    const vowelCount = [...text].filter((c) => EN_VOWELS.has(c)).length;
    const vowelRatio = vowelCount / Math.max(1, totalChars);
    const vowelPenalty = vowelRatio > 0.35 ? 20 : 0;

    const rawScore = thaiScore + signalBonus - vowelPenalty;
    const confidence = Math.max(0, Math.min(100, rawScore));

    if (confidence < 40) return NONE;
    return {
      confidence,
      type: 'en->th',
      converted: confidence >= 50 ? asThai : null,
    };
  }

  return NONE;
}
