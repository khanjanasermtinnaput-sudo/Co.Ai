// ── i18n Manager (Phase 48) ───────────────────────────────────────────────────
// Extracts string literals from source files and manages translation keys.
// Detects existing i18n setups (next-intl, react-i18next, i18next).

export type I18nFramework = "next-intl" | "react-i18next" | "i18next" | "none";

export interface ExtractedString {
  key: string;
  value: string;
  file: string;
  line: number;
  context: string;
}

export interface TranslationFile {
  locale: string;
  path: string;
  keys: Record<string, string>;
}

export interface I18nReport {
  framework: I18nFramework;
  extractedStrings: ExtractedString[];
  translationFiles: TranslationFile[];
  missingKeys: Array<{ locale: string; key: string }>;
  unusedKeys: Array<{ locale: string; key: string }>;
  coverage: Record<string, number>;
}

// ── Framework detection ───────────────────────────────────────────────────────

export function detectI18nFramework(files: Array<{ path: string; content: string }>): I18nFramework {
  for (const { content } of files) {
    if (content.includes("next-intl")) return "next-intl";
    if (content.includes("react-i18next")) return "react-i18next";
    if (content.includes("i18next")) return "i18next";
  }
  return "none";
}

// ── String extractor ──────────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  /^https?:\/\//,
  /^[./\\]/,
  /^\s*$/,
  /^[A-Z_]+$/,       // constants
  /^#[0-9a-f]{3,8}$/i, // colors
  /^\d+(\.\d+)?$/,   // numbers
  /^[a-z-]+\/[a-z-]+$/, // mime types
];

function shouldSkip(val: string): boolean {
  if (val.length < 3) return true;
  return SKIP_PATTERNS.some((p) => p.test(val));
}

function toI18nKey(value: string): string {
  return value
    .toLowerCase()
    .slice(0, 40)
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

export function extractStrings(
  files: Array<{ path: string; content: string }>,
): ExtractedString[] {
  const results: ExtractedString[] = [];
  const seen = new Set<string>();

  const jsxTextRe = />\s*([A-Z][^<>{}\n]{3,80})\s*</g;
  const stringLitRe = /(?:placeholder|label|title|aria-label|alt)=["']([^"']{3,80})["']/g;

  for (const { path, content } of files) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    const lines = content.split("\n");

    for (const re of [jsxTextRe, stringLitRe]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const value = m[1].trim();
        if (shouldSkip(value) || seen.has(value)) continue;
        seen.add(value);

        const charIdx = m.index;
        const line = content.slice(0, charIdx).split("\n").length;
        const key = toI18nKey(value);

        results.push({
          key,
          value,
          file: path,
          line,
          context: lines[line - 1]?.trim().slice(0, 80) ?? "",
        });
      }
    }
  }

  return results;
}

// ── Translation file parser ───────────────────────────────────────────────────

export function parseTranslationFile(path: string, content: string): TranslationFile | null {
  try {
    const localeMatch = path.match(/(?:messages|locales?|translations?)\/([a-z]{2}(?:-[A-Z]{2})?)/);
    const locale = localeMatch?.[1] ?? path.split("/").find((p) => /^[a-z]{2}/.test(p)) ?? "unknown";
    const keys = JSON.parse(content) as Record<string, string>;
    return { locale, path, keys };
  } catch {
    return null;
  }
}

export function analyzeI18n(
  files: Array<{ path: string; content: string }>,
): I18nReport {
  const framework = detectI18nFramework(files);
  const extractedStrings = extractStrings(files);

  // Find translation files
  const translationFiles: TranslationFile[] = [];
  for (const { path, content } of files) {
    if (path.match(/\.(json)$/) && path.match(/(?:messages|locales?|translations?)/)) {
      const tf = parseTranslationFile(path, content);
      if (tf) translationFiles.push(tf);
    }
  }

  // Find missing/unused keys across locales
  const allExtractedKeys = new Set(extractedStrings.map((s) => s.key));
  const missingKeys: Array<{ locale: string; key: string }> = [];
  const unusedKeys: Array<{ locale: string; key: string }> = [];
  const coverage: Record<string, number> = {};

  for (const tf of translationFiles) {
    const tfKeys = new Set(Object.keys(tf.keys));

    let covered = 0;
    for (const key of allExtractedKeys) {
      if (tfKeys.has(key)) covered++;
      else missingKeys.push({ locale: tf.locale, key });
    }

    for (const key of tfKeys) {
      if (!allExtractedKeys.has(key)) unusedKeys.push({ locale: tf.locale, key });
    }

    coverage[tf.locale] = allExtractedKeys.size > 0
      ? Math.round((covered / allExtractedKeys.size) * 100)
      : 100;
  }

  return { framework, extractedStrings, translationFiles, missingKeys, unusedKeys, coverage };
}

export function generateTranslationJSON(strings: ExtractedString[]): string {
  const obj: Record<string, string> = {};
  for (const s of strings) {
    obj[s.key] = s.value;
  }
  return JSON.stringify(obj, null, 2);
}
