// Engineering Classifier — extends classifyTask() (classifier.ts) with the
// signals a Ypertatos ('pro' mode) build needs: is this engineering at all,
// which domain(s) does it touch, and does it look big enough to escalate
// beyond a single-agent Low-tier run. Does not replace classifyTask(); wraps it.

import type { ArchitectDecision } from '../types.js';
import type { ClassificationResult } from './classifier.js';

export type EngineeringDomain =
  | 'backend'
  | 'frontend'
  | 'database'
  | 'testing'
  | 'documentation'
  | 'infrastructure';

export interface EngineeringClassification {
  engineeringRequired: boolean;
  domains: EngineeringDomain[];
  suggestedTier: 'low' | 'normal' | 'high';
  escalationReasons: string[];
}

interface DomainRule {
  domain: EngineeringDomain;
  patterns: RegExp[];
}

const DOMAIN_RULES: DomainRule[] = [
  {
    domain: 'database',
    patterns: [
      /\bdatabase\b/i, /\bschema\b/i, /\bmigration\b/i, /\bsql\b/i, /\btable\b/i,
      /\bquery\b/i, /\bmongo(db)?\b/i, /\bpostgres(ql)?\b/i, /\bsupabase\b/i,
      /ฐานข้อมูล/i, /ตาราง/i,
    ],
  },
  {
    domain: 'frontend',
    patterns: [
      /\bui\b/i, /\bfrontend\b/i, /\bcomponent\b/i, /\bpage\b/i, /\bscreen\b/i,
      /\breact\b/i, /\bnext\.?js\b/i, /\bvue\b/i, /\bsvelte\b/i, /\bcss\b/i,
      /\blayout\b/i, /\bbutton\b/i, /\bform\b/i,
      /หน้าจอ/i, /หน้าเว็บ/i,
    ],
  },
  {
    domain: 'backend',
    patterns: [
      /\bapi\b/i, /\bendpoint\b/i, /\broute\b/i, /\bserver\b/i, /\bbackend\b/i,
      /\bcontroller\b/i, /\bservice\b/i, /\bmiddleware\b/i, /\bauth(entication)?\b/i,
      /\bhandler\b/i,
      /เซิร์ฟเวอร์/i,
    ],
  },
  {
    domain: 'testing',
    patterns: [
      /\btest(s|ing)?\b/i, /\bunit test\b/i, /\bintegration test\b/i, /\be2e\b/i,
      /\bjest\b/i, /\bvitest\b/i, /\bplaywright\b/i, /\bcypress\b/i,
      /ทดสอบ/i,
    ],
  },
  {
    domain: 'documentation',
    patterns: [
      /\breadme\b/i, /\bdocumentation\b/i, /\bdocs?\b/i, /\bcomment(s|ing)?\b/i,
      /เอกสาร/i,
    ],
  },
  {
    domain: 'infrastructure',
    patterns: [
      /\bdocker\b/i, /\bdeploy(ment)?\b/i, /\bci\/?cd\b/i, /\binfra(structure)?\b/i,
      /\bkubernetes\b/i, /\bvercel\b/i, /\benv(ironment)?\b.{0,10}variable/i,
      /\bpipeline\b/i,
    ],
  },
];

const ARCHITECTURE_PATTERNS = [
  /\barchitecture\b/i, /\bscaffold\b/i, /\bnew project\b/i, /\bgenerate a project\b/i,
  /\bfrom scratch\b/i, /\bmicroservice\b/i,
];

const HIGH_TIER_PATTERNS = [
  /\bmigration\b/i, /\bdeploy(ment)?\b/i, /\blarge.?scale refactor/i, /\bmulti.?repo\b/i,
];

// How many files a scanned project must have before size alone counts as an
// escalation signal (Low → Normal). Env-configurable since "large repo" has
// no universal number — tune from real traffic.
const LARGE_REPO_FILE_THRESHOLD = Number(process.env.ENGINEERING_LARGE_REPO_FILES ?? 150);

function domainsFromText(text: string): Set<EngineeringDomain> {
  const lower = text.toLowerCase();
  const found = new Set<EngineeringDomain>();
  for (const rule of DOMAIN_RULES) {
    if (rule.patterns.some((p) => p.test(lower))) found.add(rule.domain);
  }
  return found;
}

/** Guess a domain from a file path the Architect stage already decided to
 *  touch — a much stronger signal than task-text keywords when available. */
export function domainFromPath(path: string): EngineeringDomain | undefined {
  const p = path.toLowerCase();
  if (/\.sql$/.test(p) || /\bmigrations?\//.test(p)) return 'database';
  if (/\.(test|spec)\.[jt]sx?$/.test(p) || /__tests__\//.test(p)) return 'testing';
  if (/readme/i.test(p) || /\.md$/.test(p) || /\bdocs?\//.test(p)) return 'documentation';
  if (/dockerfile/i.test(p) || /\.ya?ml$/.test(p) || /\binfra\//.test(p)) return 'infrastructure';
  if (/\.(tsx|jsx|css|scss)$/.test(p) || /\bcomponents?\//.test(p) || /\bpages?\//.test(p)) return 'frontend';
  if (/\broutes?\//.test(p) || /\bcontrollers?\//.test(p) || /\bapi\//.test(p) || /\.(ts|js)$/.test(p)) return 'backend';
  return undefined;
}

export interface ClassifyEngineeringOpts {
  /** Present only when the Architect stage already ran (smart mode) — a
   *  stronger domain/multi-file signal than regex over the raw task text. */
  architect?: ArchitectDecision;
  /** Scanned project file count, when available (context-engine.ts). */
  fileCount?: number;
}

export function classifyEngineering(
  task: string,
  classification: ClassificationResult,
  opts: ClassifyEngineeringOpts = {},
): EngineeringClassification {
  const engineeringRequired =
    classification.categories.includes('coding') ||
    classification.categories.includes('ui_design') ||
    classification.categories.includes('data_analysis');

  const domains = domainsFromText(task);
  const { architect } = opts;
  if (architect) {
    for (const f of [...architect.newFiles, ...architect.modifyFiles]) {
      const d = domainFromPath(f);
      if (d) domains.add(d);
    }
  }

  const escalationReasons: string[] = [];

  if (domains.size > 1) {
    escalationReasons.push(`multiple engineering domains detected: ${[...domains].join(', ')}`);
  }
  if (classification.isMultiStep) {
    escalationReasons.push('task classified as multi-step');
  }
  if (opts.fileCount != null && opts.fileCount > LARGE_REPO_FILE_THRESHOLD) {
    escalationReasons.push(`repository exceeds ${LARGE_REPO_FILE_THRESHOLD} files`);
  }
  if (ARCHITECTURE_PATTERNS.some((p) => p.test(task))) {
    escalationReasons.push('task requests architecture/scaffolding/new project');
  }
  if (architect && architect.newFiles.length + architect.modifyFiles.length > 1) {
    escalationReasons.push('architect plan touches multiple files');
  }

  let suggestedTier: 'low' | 'normal' | 'high' = escalationReasons.length > 0 ? 'normal' : 'low';

  // High-tier escalation isn't wired to a different execution engine yet
  // (see the Ypertatos implementation plan, Phase 3) — reserved here so the
  // reasoning/signal is visible in logs before that engine exists.
  if (suggestedTier === 'normal' && HIGH_TIER_PATTERNS.some((p) => p.test(task))) {
    escalationReasons.push('task suggests migration/deployment/large-scale refactor');
    suggestedTier = 'high';
  }

  return {
    engineeringRequired,
    domains: [...domains],
    suggestedTier,
    escalationReasons,
  };
}
