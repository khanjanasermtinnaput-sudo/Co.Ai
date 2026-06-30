// ── Security Scanner (Phase 36) ────────────────────────────────────────────────
// OWASP Top 10 pattern detection, secrets leakage, vulnerable deps, injection risks.

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";
export type SecurityCategory =
  | "injection"
  | "xss"
  | "auth"
  | "secrets"
  | "dependency"
  | "csrf"
  | "idor"
  | "misconfiguration"
  | "crypto"
  | "logging";

export interface SecurityFinding {
  id: string;
  severity: SecuritySeverity;
  category: SecurityCategory;
  owasp: string;
  title: string;
  description: string;
  file: string | null;
  line: number | null;
  code: string | null;
  recommendation: string;
  cwe?: string;
  autoFixable: boolean;
}

// ── Detection rules ────────────────────────────────────────────────────────────

interface SecurityRule {
  id: string;
  severity: SecuritySeverity;
  category: SecurityCategory;
  owasp: string;
  cwe?: string;
  title: string;
  regex: RegExp;
  description: string;
  recommendation: string;
  autoFixable: boolean;
}

const RULES: SecurityRule[] = [
  {
    id: "hardcoded-secret",
    severity: "critical",
    category: "secrets",
    owasp: "A02:2021 Cryptographic Failures",
    cwe: "CWE-798",
    title: "Hardcoded Secret / API Key",
    regex: /(?:api[_-]?key|secret|password|token|auth)\s*[:=]\s*['"`]([a-zA-Z0-9_\-]{16,})['"` ]/gi,
    description: "Hardcoded credentials found in source code. These will be exposed if the repo is public or if the code is decompiled.",
    recommendation: "Move all secrets to environment variables. Use process.env.MY_SECRET and add the variable to .env.local (never committed).",
    autoFixable: true,
  },
  {
    id: "eval-injection",
    severity: "critical",
    category: "injection",
    owasp: "A03:2021 Injection",
    cwe: "CWE-95",
    title: "Dangerous eval() Usage",
    regex: /\beval\s*\(/g,
    description: "eval() executes arbitrary code — any user input passed to it enables remote code execution.",
    recommendation: "Never use eval(). Use JSON.parse() for data, Function() constructor only with trusted input.",
    autoFixable: false,
  },
  {
    id: "innerhtml-xss",
    severity: "high",
    category: "xss",
    owasp: "A03:2021 Injection (XSS)",
    cwe: "CWE-79",
    title: "Potential XSS via innerHTML",
    regex: /\.innerHTML\s*=|dangerouslySetInnerHTML/g,
    description: "Directly assigning HTML strings risks XSS if any portion is user-controlled.",
    recommendation: "Use textContent for text, or sanitize with DOMPurify before innerHTML assignment.",
    autoFixable: false,
  },
  {
    id: "sql-injection",
    severity: "critical",
    category: "injection",
    owasp: "A03:2021 Injection",
    cwe: "CWE-89",
    title: "Potential SQL Injection",
    regex: /`.*\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/gi,
    description: "String-interpolated SQL query detected. User input in SQL strings enables SQL injection.",
    recommendation: "Always use parameterized queries or a query builder (e.g. Prisma, Drizzle, pg parameterized).",
    autoFixable: false,
  },
  {
    id: "no-https",
    severity: "medium",
    category: "misconfiguration",
    owasp: "A02:2021 Cryptographic Failures",
    cwe: "CWE-319",
    title: "HTTP URL (not HTTPS)",
    regex: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/g,
    description: "Unencrypted HTTP endpoint used. Traffic is visible to network intermediaries.",
    recommendation: "Use HTTPS for all external endpoints.",
    autoFixable: true,
  },
  {
    id: "weak-crypto",
    severity: "high",
    category: "crypto",
    owasp: "A02:2021 Cryptographic Failures",
    cwe: "CWE-327",
    title: "Weak Cryptographic Algorithm",
    regex: /\b(?:md5|sha1|createHash\(['"`]md5|createHash\(['"`]sha1)/gi,
    description: "MD5 and SHA-1 are cryptographically broken and unsuitable for security purposes.",
    recommendation: "Use SHA-256 or SHA-3 for hashing; use bcrypt/argon2 for passwords.",
    autoFixable: false,
  },
  {
    id: "console-sensitive",
    severity: "medium",
    category: "logging",
    owasp: "A09:2021 Security Logging and Monitoring Failures",
    cwe: "CWE-532",
    title: "Sensitive Data in Console Log",
    regex: /console\.(?:log|info|debug)\s*\([^)]*(?:password|token|secret|key|auth)/gi,
    description: "Logging sensitive values exposes credentials in browser devtools and server logs.",
    recommendation: "Never log sensitive values. Redact or omit them.",
    autoFixable: true,
  },
  {
    id: "cors-wildcard",
    severity: "medium",
    category: "misconfiguration",
    owasp: "A05:2021 Security Misconfiguration",
    cwe: "CWE-942",
    title: "CORS Wildcard Origin",
    regex: /Access-Control-Allow-Origin['":\s]+\*/g,
    description: "Wildcard CORS allows any origin to make cross-site requests with credentials.",
    recommendation: "Restrict Access-Control-Allow-Origin to specific trusted origins.",
    autoFixable: false,
  },
  {
    id: "prototype-pollution",
    severity: "high",
    category: "injection",
    owasp: "A03:2021 Injection",
    cwe: "CWE-1321",
    title: "Prototype Pollution Risk",
    regex: /\[['"`]__proto__['"`]\]|\[['"`]constructor['"`]\]|\[['"`]prototype['"`]\]/g,
    description: "Direct __proto__ or constructor.prototype access can lead to prototype pollution.",
    recommendation: "Use Object.create(null) for dictionaries. Validate object keys before merge.",
    autoFixable: false,
  },
  {
    id: "path-traversal",
    severity: "high",
    category: "injection",
    owasp: "A01:2021 Broken Access Control",
    cwe: "CWE-22",
    title: "Potential Path Traversal",
    regex: /fs\.\w+\s*\(\s*(?:req\.|params\.|query\.|body\.)/g,
    description: "File system operations using request data may allow path traversal attacks.",
    recommendation: "Validate and sanitize all file paths. Use path.resolve() and check that the result is within the allowed directory.",
    autoFixable: false,
  },
];

// ── Known vulnerable package patterns ─────────────────────────────────────────
// (Simplified — in production this would hit an advisory database)
const VULNERABLE_PKGS: Record<string, string> = {
  "lodash": "< 4.17.21 — prototype pollution (CVE-2021-23337)",
  "axios": "< 0.21.2 — SSRF (CVE-2020-28168)",
  "node-fetch": "< 2.6.7 — SSRF (CVE-2022-0235)",
  "minimist": "< 1.2.6 — prototype pollution (CVE-2021-44906)",
  "jsonwebtoken": "< 9.0.0 — algorithm confusion (CVE-2022-23529)",
};

// ── Main scanner ───────────────────────────────────────────────────────────────

let _id = 0;
function nextId() { return `sec_${Date.now()}_${++_id}`; }

export function scanSecurity(
  files: Array<{ path: string; content: string }>,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const { path, content } of files) {
    if (path.includes("node_modules") || path.includes(".next") || path.endsWith(".lock")) continue;

    const lines = content.split("\n");
    for (const rule of RULES) {
      rule.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.regex.exec(content)) !== null) {
        const charsBefore = content.slice(0, m.index);
        const line = charsBefore.split("\n").length;
        const lineText = lines[line - 1]?.trim().slice(0, 120) ?? "";

        findings.push({
          id: nextId(),
          severity: rule.severity,
          category: rule.category,
          owasp: rule.owasp,
          cwe: rule.cwe,
          title: rule.title,
          description: rule.description,
          file: path,
          line,
          code: lineText,
          recommendation: rule.recommendation,
          autoFixable: rule.autoFixable,
        });
      }
    }

    // Check package.json for vulnerable deps
    if (path === "package.json") {
      let pkg: Record<string, unknown>;
      try { pkg = JSON.parse(content); } catch { continue; }
      const allDeps = {
        ...(pkg.dependencies as Record<string, string> ?? {}),
        ...(pkg.devDependencies as Record<string, string> ?? {}),
      };
      for (const [name, advisory] of Object.entries(VULNERABLE_PKGS)) {
        if (name in allDeps) {
          findings.push({
            id: nextId(),
            severity: "high",
            category: "dependency",
            owasp: "A06:2021 Vulnerable and Outdated Components",
            cwe: "CWE-1035",
            title: `Potentially Vulnerable Dependency: ${name}`,
            description: `${name} has known security advisories: ${advisory}`,
            file: path,
            line: null,
            code: `"${name}": "${allDeps[name]}"`,
            recommendation: `Update ${name} to the latest version: npm update ${name}`,
            autoFixable: false,
          });
        }
      }
    }
  }

  // Sort: critical → high → medium → low → info
  const order: Record<SecuritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
