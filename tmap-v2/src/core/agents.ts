import type {
  Blackboard, CodeFile, PlanStep, ReviewIssue, LLMCall,
} from '../types.js';

// ── PLANNER ──────────────────────────────────────────────────────────────────
const PLANNER_SYS = `You are the Planner agent in AOF Code (TMAP v2).
Break the user's task into a concrete build plan.
Output ONLY a numbered list, max 7 lines, each line:
"N. <path/filename> — <action: create|modify> — <short intent>"
No prose before or after. Plain text.`;

export async function runPlanner(call: LLMCall, bb: Blackboard): Promise<{ steps: PlanStep[]; raw: string }> {
  const raw = await call([
    { role: 'system', content: PLANNER_SYS },
    { role: 'user', content: `Task: ${bb.task}\nMode: ${bb.mode}\nContext:\n${bb.context || '(fresh project)'}` },
  ], { temperature: 0.3 });

  const steps: PlanStep[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/—|--|-/) ? line.replace(/^\s*\d+[.)]\s*/, '') : '';
    if (!m) continue;
    const parts = line.replace(/^\s*\d+[.)]\s*/, '').split(/—|--/).map((s) => s.trim());
    if (parts[0]) {
      steps.push({
        file: parts[0].split(' ')[0],
        action: /modify/i.test(line) ? 'modify' : 'create',
        intent: parts.slice(1).join(' — ') || parts[0],
      });
    }
  }
  return { steps, raw };
}

// ── CODER ────────────────────────────────────────────────────────────────────
const CODER_SYS = `You are the Coder agent in AOF Code (TMAP v2).
Implement the plan as complete, working files.
For EACH file output a fenced block whose info string is the file path, e.g.:
\`\`\`path=src/main.js
<full file content>
\`\`\`
Output only code blocks. No explanation.`;

export async function runCoder(
  call: LLMCall, bb: Blackboard, critique?: string,
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
  ], { temperature: 0.2, maxTokens: 8192 });

  return parseCodeBlocks(raw);
}

export function parseCodeBlocks(text: string): CodeFile[] {
  const files: CodeFile[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    const info = m[1].trim();
    const content = m[2].replace(/\s+$/, '') + '\n';
    let path = '';
    const pm = info.match(/path=([^\s]+)/);
    if (pm) path = pm[1];
    else {
      const lang = info.split(/\s/)[0] || 'txt';
      const ext = LANG_EXT[lang] || lang || 'txt';
      path = `file${i === 0 ? '' : i}.${ext}`;
    }
    files.push({ path, language: extLang(path), content });
    i++;
  }
  if (!files.length && text.trim()) {
    files.push({ path: 'output.txt', language: 'text', content: text.trim() + '\n' });
  }
  return files;
}

// ── REVIEWER ─────────────────────────────────────────────────────────────────
const REVIEWER_SYS = `You are the Reviewer agent in AOF Code (TMAP v2).
Review the generated files for correctness, security and quality.
Output ONLY issues, one per line, format:
"<HIGH|MED|LOW> | <file> | <concrete problem and fix>"
If there are no blocking problems, output exactly: "OK | - | no blocking issues".`;

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
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length >= 3) {
      const sev = parts[0].toUpperCase();
      if (['HIGH', 'MED', 'LOW'].includes(sev)) {
        issues.push({ severity: sev as ReviewIssue['severity'], file: parts[1], message: parts.slice(2).join(' | ') });
      }
    }
  }
  return { issues, raw };
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
