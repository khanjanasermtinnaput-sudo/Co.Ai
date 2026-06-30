// ── Accessibility Audit (Phase 47) ───────────────────────────────────────────
// WCAG 2.1 compliance scanner for JSX/HTML source files.
// Detects missing alt text, ARIA labels, keyboard access, color contrast hints.

export type A11ySeverity = "error" | "warning" | "info";
export type WCAGLevel = "A" | "AA" | "AAA";

export interface A11yFinding {
  id: string;
  ruleId: string;
  file: string;
  line: number;
  col: number;
  severity: A11ySeverity;
  wcagLevel: WCAGLevel;
  wcagCriteria: string;
  description: string;
  snippet: string;
  fix: string;
}

interface A11yRule {
  id: string;
  wcagLevel: WCAGLevel;
  wcagCriteria: string;
  severity: A11ySeverity;
  description: string;
  fix: string;
  pattern: RegExp;
  filter?: (match: string, line: string) => boolean;
}

const RULES: A11yRule[] = [
  {
    id: "img-alt",
    wcagLevel: "A",
    wcagCriteria: "1.1.1 Non-text Content",
    severity: "error",
    description: "Image is missing an alt attribute.",
    fix: 'Add alt="" for decorative images or alt="description" for meaningful images.',
    pattern: /<img\b(?![^>]*\balt=)[^>]*>/gi,
  },
  {
    id: "img-empty-alt",
    wcagLevel: "A",
    wcagCriteria: "1.1.1 Non-text Content",
    severity: "warning",
    description: 'Image has alt="" — verify it is truly decorative.',
    fix: "If the image conveys meaning, add a descriptive alt text.",
    pattern: /<img\b[^>]*alt=""\s*[^>]*>/gi,
  },
  {
    id: "button-no-text",
    wcagLevel: "A",
    wcagCriteria: "4.1.2 Name, Role, Value",
    severity: "error",
    description: "Button has no accessible name (no text or aria-label).",
    fix: "Add aria-label or visible text content to the button.",
    pattern: /<button\b(?![^>]*(?:aria-label|title)=)[^>]*>\s*<(?:svg|img|Icon)/gi,
  },
  {
    id: "input-no-label",
    wcagLevel: "A",
    wcagCriteria: "1.3.1 Info and Relationships",
    severity: "error",
    description: "Input element has no associated label.",
    fix: "Use <label htmlFor> or aria-label to associate a label with the input.",
    pattern: /<input\b(?![^>]*(?:aria-label|aria-labelledby|id=)[^>]*>)/gi,
  },
  {
    id: "anchor-no-text",
    wcagLevel: "A",
    wcagCriteria: "2.4.4 Link Purpose",
    severity: "error",
    description: "Anchor element has no discernible text.",
    fix: "Add visible text or aria-label to describe the link destination.",
    pattern: /<a\b(?![^>]*aria-label=)[^>]*>\s*<(?:svg|img)/gi,
  },
  {
    id: "onclick-div",
    wcagLevel: "A",
    wcagCriteria: "2.1.1 Keyboard",
    severity: "warning",
    description: "Interactive div/span with onClick is not keyboard accessible.",
    fix: "Use a <button> or add role='button' + tabIndex={0} + onKeyDown handler.",
    pattern: /<(?:div|span)\b[^>]*onClick=[^>]*>/gi,
    filter: (match) => !match.includes("role=") && !match.includes("tabIndex"),
  },
  {
    id: "tabindex-positive",
    wcagLevel: "AA",
    wcagCriteria: "2.4.3 Focus Order",
    severity: "warning",
    description: "Positive tabIndex values disrupt natural focus order.",
    fix: "Use tabIndex={0} or tabIndex={-1} instead of positive values.",
    pattern: /tabIndex=\{[1-9]\d*\}/gi,
  },
  {
    id: "missing-lang",
    wcagLevel: "A",
    wcagCriteria: "3.1.1 Language of Page",
    severity: "error",
    description: '<html> element is missing the lang attribute.',
    fix: 'Add lang="en" (or appropriate language code) to the <html> element.',
    pattern: /<html\b(?![^>]*\blang=)[^>]*>/gi,
  },
  {
    id: "color-contrast-inline",
    wcagLevel: "AA",
    wcagCriteria: "1.4.3 Contrast (Minimum)",
    severity: "warning",
    description: "Low-contrast color combination detected in inline styles.",
    fix: "Ensure text has at least 4.5:1 contrast ratio against its background.",
    pattern: /style=\{[^}]*color:\s*['"]?(?:gray|silver|#[89a-f]{3,6}|rgba?\([^)]+,\s*0\.[1-3]\))/gi,
  },
  {
    id: "autofocus",
    wcagLevel: "AA",
    wcagCriteria: "2.4.3 Focus Order",
    severity: "info",
    description: "autoFocus can disorient screen reader users if used unexpectedly.",
    fix: "Only use autoFocus when it genuinely improves UX (e.g., modal dialogs).",
    pattern: /\bautoFocus\b/gi,
  },
  {
    id: "aria-hidden-focus",
    wcagLevel: "A",
    wcagCriteria: "4.1.2 Name, Role, Value",
    severity: "error",
    description: 'Element with aria-hidden="true" contains focusable children.',
    fix: 'Add tabIndex={-1} to all focusable children inside aria-hidden elements.',
    pattern: /aria-hidden="true"[^>]*>[\s\S]*?(?:<button|<a\s|<input)/gi,
  },
];

export function auditFile(filePath: string, content: string): A11yFinding[] {
  const isRelevant = /\.(tsx?|jsx?|html?)$/.test(filePath);
  if (!isRelevant) return [];

  const findings: A11yFinding[] = [];
  const lines = content.split("\n");

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(content)) !== null) {
      const snippet = m[0];
      if (rule.filter && !rule.filter(snippet, "")) continue;

      const charIdx = m.index;
      const linesBefore = content.slice(0, charIdx).split("\n");
      const line = linesBefore.length;
      const col = (linesBefore.at(-1)?.length ?? 0) + 1;
      const lineText = lines[line - 1] ?? "";

      findings.push({
        id: `${filePath}:${line}:${rule.id}`,
        ruleId: rule.id,
        file: filePath,
        line,
        col,
        severity: rule.severity,
        wcagLevel: rule.wcagLevel,
        wcagCriteria: rule.wcagCriteria,
        description: rule.description,
        snippet: lineText.trim().slice(0, 120),
        fix: rule.fix,
      });

      if (!rule.pattern.global) break;
    }
  }

  return findings;
}

export function auditFiles(files: Array<{ path: string; content: string }>): A11yFinding[] {
  return files.flatMap((f) => auditFile(f.path, f.content));
}

export function a11yScore(findings: A11yFinding[]): number {
  if (findings.length === 0) return 100;
  const penalty = findings.reduce((acc, f) => {
    if (f.severity === "error") return acc + 10;
    if (f.severity === "warning") return acc + 3;
    return acc + 1;
  }, 0);
  return Math.max(0, 100 - penalty);
}
