import type {
  Blackboard, CodeFile, PlanStep, ReviewIssue, LLMCall,
} from '../types.js';

// ── PLANNER ──────────────────────────────────────────────────────────────────
// Canonical line format: "N. <path> — <create|modify> — <intent>"
// The delimiter is em-dash (—) or double-dash (--), never a single dash (-).
// This avoids mis-splitting file paths that contain hyphens (e.g. src/api-utils.ts).
const PLANNER_SYS = `You are the Planner agent in Coagentix (TMAP v2).
Break the user's task into a concrete build plan.
Output ONLY a numbered list, max 7 lines, each line EXACTLY:
"N. <path/filename> — <action: create|modify> — <short intent>"
Use the em-dash character (—) as the delimiter, NOT a single hyphen (-).
File paths may contain hyphens (e.g. src/api-utils.ts) — do not split on them.
No prose before or after. Plain text.
Write the <short intent> text in the SAME LANGUAGE the user wrote the task in
(Thai task → Thai intent). Keep file paths and the create/modify keywords as-is.`;

// Split pattern: em-dash (—) or double-dash (--) only.
// Single hyphens are deliberately excluded so paths like src/api-utils.ts are preserved.
const PLAN_DELIM = /\s*(?:—|--)\s*/;

export async function runPlanner(call: LLMCall, bb: Blackboard): Promise<{ steps: PlanStep[]; raw: string }> {
  const raw = await call([
    { role: 'system', content: PLANNER_SYS },
    { role: 'user', content: `Task: ${bb.task}\nMode: ${bb.mode}\nContext:\n${bb.context || '(fresh project)'}` },
  ], { temperature: 0.3 });

  const steps: PlanStep[] = [];
  for (const line of raw.split('\n')) {
    // Only process numbered list lines that contain the canonical delimiter.
    if (!line.match(/—|--/)) continue;
    const body = line.replace(/^\s*\d+[.)]\s*/, '').trim();
    if (!body) continue;
    const parts = body.split(PLAN_DELIM).map((s) => s.trim());
    // parts[0] = path, parts[1] = action hint, parts[2+] = intent
    const filePath = parts[0];
    if (!filePath) continue;
    steps.push({
      file: filePath,
      action: /modify/i.test(line) ? 'modify' : 'create',
      intent: parts.slice(2).join(' — ') || parts[1] || filePath,
    });
  }
  return { steps, raw };
}

// ── CODER ────────────────────────────────────────────────────────────────────
const CODER_SYS = `You are the Coder agent in Coagentix (TMAP v2). You write production-grade code.
Implement the plan as complete, working files.

QUALITY BAR (non-negotiable):
- Production-ready: no TODOs, no placeholders, no "// implement later". Ship complete files.
- Error handling: validate inputs, handle failure paths, never swallow errors silently.
- Type safety: in typed languages use explicit types; avoid "any". Prefer pure, testable functions.
- Clean architecture: clear separation of concerns, small focused modules, reusable components.
- Clear structure & naming: sensible folders, descriptive names, brief comments only where intent isn't obvious.
- Consistency: match the conventions and tech stack given in the plan/context.

For EACH file output a fenced block whose info string is the file path, e.g.:
\`\`\`path=src/main.js
<full file content>
\`\`\`
Output only code blocks. No explanation before or after.`;

export async function runCoder(
  call: LLMCall, bb: Blackboard, critique?: string, temperature = 0.2,
): Promise<CodeFile[]> {
  const userParts = [
    `Task: ${bb.task}`,
    `Plan:\n${bb.planText}`,
  ];
  if (critique) {
    userParts.push(
      `Previous attempt had problems. FIX them and output corrected full files:\n${critique}`,
    );
    if (bb.files.length) {
      userParts.push(
        'Current files:\n' +
          bb.files.map((f) => `\`\`\`path=${f.path}\n${f.content}\n\`\`\``).join('\n\n'),
      );
    }
  }
  const raw = await call([
    { role: 'system', content: CODER_SYS },
    { role: 'user', content: userParts.join('\n\n') },
  ], { temperature, maxTokens: 4096 });

  return parseCodeBlocks(raw);
}

// Line-based fenced-block parser. Supports variable-length fences (``` ```,
// ```` ````, ~~~) so a Markdown/README file that itself contains a ``` code
// fence can be emitted inside a longer outer fence without being truncated.
export function parseCodeBlocks(text: string): CodeFile[] {
  const files: CodeFile[] = [];
  const lines = text.split('\n');
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!open) continue;
    const fence = open[1];
    const closeRe = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !closeRe.test(lines[j]); j++) body.push(lines[j]);
    const content = body.join('\n').replace(/\s+$/, '') + '\n';
    const path = resolveBlockPath(open[2].trim(), idx);
    files.push({ path, language: extLang(path), content });
    idx++;
    i = j; // resume after the closing fence
  }
  if (!files.length && text.trim()) {
    files.push({ path: 'output.txt', language: 'text', content: text.trim() + '\n' });
  }
  return files;
}

function resolveBlockPath(info: string, idx: number): string {
  const pm = info.match(/path=([^\s]+)/);
  if (pm) return pm[1];
  const lang = info.split(/\s/)[0] || 'txt';
  const ext = LANG_EXT[lang] || lang || 'txt';
  return `file${idx === 0 ? '' : idx}.${ext}`;
}

// ── REVIEWER ─────────────────────────────────────────────────────────────────
const REVIEWER_SYS = `You are the Reviewer agent in Coagentix (TMAP v2).
Review the generated files for correctness, security and quality.
Output ONLY issues, one per line, format:
"<HIGH|MED|LOW> | <file> | <concrete problem and fix>"
If there are no blocking problems, output exactly: "OK | - | no blocking issues".
Write the <concrete problem and fix> text in the SAME LANGUAGE the user wrote the
task in (Thai task → Thai description). Keep the severity tags, separators, file
paths and the literal "OK | - | no blocking issues" line exactly as specified.`;

export async function runReviewer(
  call: LLMCall, bb: Blackboard,
): Promise<{ issues: ReviewIssue[]; raw: string }> {
  const filesText = bb.files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');
  const valText = bb.validations
    .map((v) => `${v.kind}: ${v.passed ? 'PASS' : 'FAIL'} ${v.logs}`)
    .join('\n');

  const raw = await call([
    { role: 'system', content: REVIEWER_SYS },
    {
      role: 'user',
      content: `Task: ${bb.task}\n\nValidation results:\n${valText || '(none)'}\n\nFiles:\n${filesText}`,
    },
  ], { temperature: 0.2 });

  const issues: ReviewIssue[] = [];
  for (const line of raw.split('\n')) {
    const issue = parseReviewLine(line);
    if (issue) issues.push(issue);
  }
  return { issues, raw };
}

// Robust parse of one reviewer line. Accepts the canonical
// "SEV | file | message" form plus common variants (colon/dash/bracket
// separators, the MEDIUM spelling) so a blocking HIGH issue is never silently
// dropped just because the model formatted it a little differently.
const SEV_MAP: Record<string, ReviewIssue['severity']> = {
  HIGH: 'HIGH', MED: 'MED', MEDIUM: 'MED', LOW: 'LOW',
};

export function parseReviewLine(line: string): ReviewIssue | null {
  const t = line.trim().replace(/^[-*•]\s+/, '');
  if (!t) return null;

  // Canonical pipe form: SEV | file | message
  const piped = t.split('|').map((s) => s.trim());
  if (piped.length >= 3) {
    const sev = SEV_MAP[piped[0].toUpperCase().replace(/[^A-Z]/g, '')];
    if (sev) return { severity: sev, file: piped[1] || undefined, message: piped.slice(2).join(' | ') || '(no detail)' };
  }

  // Fallback: a leading severity token in any common style.
  const m = t.match(/^[\[(]?\s*(HIGH|MEDIUM|MED|LOW)\b\s*[\])]?\s*[:|\-–—]?\s*(.*)$/i);
  if (!m) return null;
  const sev = SEV_MAP[m[1].toUpperCase()];
  if (!sev) return null;
  const rest = m[2].trim();
  if (!rest) return { severity: sev, message: '(no detail)' };

  // Peel a file path off the front when one is clearly present.
  const fm = rest.match(/^([^\s:|–—]+)\s*[:|\-–—]\s+(.+)$/);
  if (fm && /[./]/.test(fm[1])) {
    return { severity: sev, file: fm[1], message: fm[2].trim() };
  }
  return { severity: sev, message: rest };
}

// ── helpers ───────────────────────────────────────────────────────────────────
const LANG_EXT: Record<string, string> = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py',
  go: 'go', rust: 'rs', json: 'json', html: 'html', css: 'css', bash: 'sh', sh: 'sh',
};
function extLang(path: string): string {
  const ext = path.split('.').pop() || 'txt';
  const map: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python' };
  return map[ext] || ext;
}
