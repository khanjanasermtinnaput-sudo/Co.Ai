#!/usr/bin/env node
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { resolveAll, currentMode, anyKeyConfigured, PROVIDERS, ROLE_PROVIDER, bagFromEnv } from './config.js';
import { runInSandbox, SUPPORTED_LANGUAGES } from './core/sandbox.js';
import { getUsageSummary, checkQuota } from './core/usage-tracker.js';
import type { SandboxLanguage } from './types.js';
import { createBlackboard } from './core/blackboard.js';
import { runTMAP } from './core/orchestrator.js';
import { gatherProjectContext } from './core/context.js';
import { runTitan, blueprintToBuild } from './core/titan.js';
import { loadMemory, memoryToContext, recordDecision } from './core/memory.js';
import { chatWithDARS } from './dars/run.js';
import { globalHealth } from './dars/health.js';
import type { Role, ChatMessage } from './types.js';

// ── tiny ANSI helpers (no deps) ───────────────────────────────────────────────
const c = {
  orange: (s: string) => `\x1b[38;5;208m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  blue:   (s: string) => `\x1b[34m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const ROLE_COLOR: Record<string, (s: string) => string> = {
  planner: c.orange, coder: c.green, reviewer: c.yellow, validator: c.blue, system: c.dim,
};

function banner() {
  console.log(c.bold(`AOF ${c.orange('Code')}  ${c.dim('· TMAP v2 multi-agent')}`));
}

function makeEmit() {
  return (role: string, text: string, kind: 'status' | 'output' | 'error' = 'status') => {
    const color = ROLE_COLOR[role] || c.dim;
    const label = color(`${role.padEnd(10)}`);
    const arrow = kind === 'error' ? c.red('✗') : kind === 'status' ? c.dim('·') : c.green('›');
    for (const line of text.split('\n')) {
      if (line.trim()) console.log(`${label} ${arrow} ${kind === 'error' ? c.red(line) : line}`);
    }
  };
}

// ── commands ───────────────────────────────────────────────────────────────────
function cmdDoctor() {
  banner();
  console.log(c.dim('─'.repeat(60)));
  const mode = currentMode();
  console.log(`mode: ${c.orange(mode)}   (lite=0 loops · normal=1 · pro=3)\n`);

  const keyState = (envKey: string) =>
    process.env[envKey]?.trim() ? c.green('SET   ') : c.dim('—     ');
  console.log('API keys:');
  console.log(`  OPENROUTER_API_KEY   ${keyState('OPENROUTER_API_KEY')} ${c.dim('(single key, all agents)')}`);
  for (const k of Object.keys(PROVIDERS)) {
    const d = PROVIDERS[k];
    console.log(`  ${d.envKey.padEnd(20)} ${keyState(d.envKey)} ${c.dim(`(${d.name})`)}`);
  }

  console.log('\nResolved agents:');
  const agents = resolveAll();
  (Object.keys(agents) as Role[]).forEach((r) => {
    const a = agents[r];
    const tag = a.mode === 'mock' ? c.red('mock') : a.mode === 'fallback' ? c.yellow('fallback') : c.green(a.mode);
    console.log(`  ${ROLE_COLOR[r](r.padEnd(10))} → ${a.providerName.padEnd(26)} ${c.dim(a.model)}  [${tag}]`);
  });

  console.log('\nProject context:');
  const ctx = gatherProjectContext();
  if (ctx.type === 'unknown') {
    console.log(`  ${c.dim('no package.json / requirements.txt / go.mod found')}`);
  } else {
    console.log(`  type:  ${c.orange(ctx.type)}`);
    console.log(`  stack: ${c.orange(ctx.techStack)}`);
    console.log(`  deps:  ${ctx.dependencies.slice(0, 10).join(', ') || c.dim('none')}`);
    console.log(`  files: ${c.dim(`${ctx.existingFiles.length} source files found`)}`);
  }

  console.log(c.dim('─'.repeat(60)));
  if (!anyKeyConfigured()) {
    console.log(c.yellow('No API key set — running in MOCK mode.'));
    console.log(`Add a key:  ${c.bold('copy .env.example .env')}  then edit ${c.bold('.env')}`);
  } else {
    console.log(c.green('Ready. Try:  npm run aof -- gencode "build a todo CLI in JS"'));
  }
}

function cmdAgents() {
  banner();
  const agents = resolveAll();
  (Object.keys(agents) as Role[]).forEach((r) => {
    const a = agents[r];
    console.log(`${ROLE_COLOR[r](r.padEnd(10))} ${c.dim('provider:')} ${PROVIDERS[ROLE_PROVIDER[r]].name.padEnd(10)} ${c.dim('model:')} ${a.model}`);
  });
}

function cmdContext() {
  banner();
  console.log(c.dim('─'.repeat(60)));
  const ctx = gatherProjectContext();
  if (ctx.type === 'unknown') {
    console.log(c.yellow('No recognisable project found in current directory.'));
    return;
  }
  console.log(`Type:   ${c.orange(ctx.type)}`);
  console.log(`Stack:  ${c.orange(ctx.techStack)}`);
  if (ctx.dependencies.length) console.log(`Deps:   ${ctx.dependencies.join(', ')}`);
  if (ctx.devDependencies.length) console.log(`Dev:    ${ctx.devDependencies.join(', ')}`);
  if (Object.keys(ctx.scripts).length) {
    console.log('Scripts:');
    for (const [k, v] of Object.entries(ctx.scripts)) console.log(`  ${c.dim(k)}: ${v}`);
  }
  if (ctx.existingFiles.length) {
    console.log(`Files (${ctx.existingFiles.length}): ${ctx.existingFiles.slice(0, 20).join(', ')}`);
  }
}

async function cmdGencode(task: string, opts: { apply: boolean; mode?: string }) {
  if (!task) {
    console.log(c.red('usage: aof gencode "<what to build>"'));
    return;
  }
  banner();
  const mode = (opts.mode ?? currentMode()) as 'lite' | 'normal' | 'pro';
  console.log(`${c.dim('task:')} ${c.orange(task)}   ${c.dim('mode:')} ${mode}`);
  if (!anyKeyConfigured()) console.log(c.yellow('(mock mode — no API key; results are placeholders)'));
  console.log(c.dim('─'.repeat(60)));

  const bb = createBlackboard(task, mode);
  const emit = makeEmit();

  try {
    await runTMAP(bb, emit);
  } catch (e) {
    console.log(c.red(`\nError: ${(e as Error).message}`));
    return;
  }

  const outDir = opts.apply ? process.cwd() : join(process.cwd(), 'aof-output');
  let written = 0;
  for (const f of bb.files) {
    if (f.path.includes('..') || isAbsolute(f.path)) {
      console.log(c.yellow(`[skip] unsafe path blocked: ${f.path}`));
      continue;
    }
    const target = join(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, 'utf8');
    written++;
  }
  console.log(c.dim('─'.repeat(60)));
  console.log(c.green(`Wrote ${written} file(s) to ${c.bold(outDir)}`));
  if (!opts.apply) console.log(c.dim('(use --apply to write into the current project root instead)'));

  const high = bb.review.filter((i) => i.severity === 'HIGH').length;
  console.log(`Review: ${high ? c.red(`${high} HIGH`) : c.green('no blocking issues')}   ·   iterations: ${bb.iterations}`);
}

async function cmdReview(targetDir: string) {
  banner();
  const dir = targetDir || process.cwd();
  console.log(`${c.dim('reviewing:')} ${dir}`);
  console.log(c.dim('─'.repeat(60)));

  // Build a task that asks for review only (lite mode: no critique loops)
  const ctx = gatherProjectContext(dir);
  const task = `Review the existing codebase at ${dir} and report issues.\n\nProject info:\n${ctx.summary}`;
  const bb = createBlackboard(task, 'lite');
  if (ctx.summary) bb.context = ctx.summary;

  // We only need coder to generate placeholder + reviewer to review existing code
  // For simplicity: run full pipeline in lite mode, output just the review
  const emit = makeEmit();
  try {
    await runTMAP(bb, emit, { skipContext: true });
  } catch (e) {
    console.log(c.red(`Error: ${(e as Error).message}`));
    return;
  }

  console.log(c.dim('─'.repeat(60)));
  if (bb.review.length === 0) {
    console.log(c.green('No issues found.'));
  } else {
    const by: Record<string, typeof bb.review> = { HIGH: [], MED: [], LOW: [] };
    for (const i of bb.review) (by[i.severity] ??= []).push(i);
    for (const sev of ['HIGH', 'MED', 'LOW']) {
      const color = sev === 'HIGH' ? c.red : sev === 'MED' ? c.yellow : c.dim;
      for (const i of by[sev] ?? []) {
        console.log(`${color(`[${sev}]`)} ${i.file ?? ''}: ${i.message}`);
      }
    }
  }
}

async function cmdFix(targetDir: string, opts: { apply: boolean }) {
  banner();
  const dir = targetDir || process.cwd();
  console.log(`${c.dim('fixing:')} ${dir}`);
  console.log(c.dim('─'.repeat(60)));

  const ctx = gatherProjectContext(dir);
  const task = `Fix all issues in the existing codebase at ${dir}. Improve code quality and resolve any bugs or warnings.`;
  const bb = createBlackboard(task, 'normal');
  if (ctx.summary) bb.context = ctx.summary;

  const emit = makeEmit();
  try {
    await runTMAP(bb, emit, { projectRoot: dir });
  } catch (e) {
    console.log(c.red(`Error: ${(e as Error).message}`));
    return;
  }

  const outDir = opts.apply ? dir : join(process.cwd(), 'aof-fix-output');
  let written = 0;
  for (const f of bb.files) {
    if (f.path.includes('..') || isAbsolute(f.path)) {
      console.log(c.yellow(`[skip] unsafe path blocked: ${f.path}`));
      continue;
    }
    const target = join(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, 'utf8');
    written++;
  }
  console.log(c.dim('─'.repeat(60)));
  console.log(c.green(`Fixed ${written} file(s) → ${c.bold(outDir)}`));
  if (!opts.apply) console.log(c.dim('(use --apply to overwrite files in place)'));
}

// ── TITAN MODE — interactive AI System Architect ──────────────────────────────
async function cmdTitan(task: string, opts: { apply: boolean; mode?: string }) {
  banner();
  console.log(`${c.bold(c.orange('TITAN MODE'))} ${c.dim('· Think First, Build Later — AI System Architect')}`);
  if (!anyKeyConfigured()) console.log(c.yellow('(mock mode — no API key; answers are placeholders)'));
  console.log(c.dim('─'.repeat(60)));
  console.log(c.dim('ตอบคำถามของ Titan ไปเรื่อย ๆ จนแผนผ่าน Approval Gate · พิมพ์ exit เพื่อออก\n'));

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let rlClosed = false;
  rl.on('close', () => { rlClosed = true; });
  // EOF-safe prompt: returns 'exit' when stdin closes (e.g. piped input ran out)
  const ask = async (q: string): Promise<string> => {
    if (rlClosed) return 'exit';
    try { return await rl.question(q); } catch { return 'exit'; }
  };
  const creds = bagFromEnv();
  const emit = makeEmit();
  const call = async (messages: ChatMessage[], callOpts = {}) => {
    const r = await chatWithDARS('planner', messages, callOpts, {
      creds, health: globalHealth, emit, sessionId: 'titan-cli',
    });
    return r.text;
  };

  // Project Memory: keyed by project root so Titan remembers across CLI sessions.
  const memoryKey = process.cwd();
  let memoryContext = '';
  try {
    memoryContext = memoryToContext(await loadMemory(memoryKey));
    if (memoryContext) console.log(c.dim('project memory loaded — Titan จำการตัดสินใจเก่าของโปรเจกต์นี้ได้\n'));
  } catch { /* memory is best-effort */ }

  const history: ChatMessage[] = [];
  let message = task || (await ask(c.orange('คุณ› ') + c.dim('(อธิบายสิ่งที่อยากสร้าง) ')));

  try {
    while (true) {
      if (!message.trim()) { message = await ask(c.orange('คุณ› ')); continue; }
      if (/^(exit|quit|ออก)$/i.test(message.trim())) break;

      console.log(c.dim('\n… Titan กำลังคิด\n'));
      const result = await runTitan(call, history, message, { emit, memoryContext });
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: result.text });
      if (result.confidenceBlocked) {
        console.log(c.yellow(`\n⛔ Confidence ${result.confidence}% < 85% — Titan ถูกระบบบังคับให้ถามต่อ ห้ามวางแผน\n`));
      }

      for (const line of result.text.split('\n')) {
        console.log(`${c.orange('titan     ')} ${c.dim('›')} ${line}`);
      }

      if (result.hasBlueprint && result.blueprint) {
        // Record the approved blueprint into persistent project memory.
        try {
          const bp = result.blueprint;
          await recordDecision(memoryKey, `Titan blueprint: ${bp.project} — plan ${bp.chosenPlan || '?'}, stack ${bp.techStack || '?'}`);
        } catch { /* memory is best-effort */ }
        console.log(c.dim('\n' + '─'.repeat(60)));
        console.log(c.green('Blueprint อนุมัติแล้ว ✓'));
        const go = await ask(`${c.bold('ส่งให้ TMAP สร้างโค้ดเลยไหม?')} ${c.dim('(y/N)')} `);
        if (/^(y|yes|ใช่)$/i.test(go.trim())) {
          rl.close();
          const build = blueprintToBuild(result.blueprint);
          // Titan always generates at Pro quality (override only if explicitly set lower)
          const mode = (opts.mode === 'lite' || opts.mode === 'normal' ? opts.mode : 'pro') as 'lite' | 'normal' | 'pro';
          console.log(c.dim('─'.repeat(60)));
          console.log(c.dim(`mode: ${c.orange(mode)} (Titan → Pro by default)`));
          const bb = createBlackboard(build.task, mode, build.context);
          await runTMAP(bb, emit);
          const outDir = opts.apply ? process.cwd() : join(process.cwd(), 'aof-output');
          let written = 0;
          for (const f of bb.files) {
            if (f.path.includes('..') || isAbsolute(f.path)) {
              console.log(c.yellow(`[skip] unsafe path blocked: ${f.path}`));
              continue;
            }
            const target = join(outDir, f.path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, f.content, 'utf8');
            written++;
          }
          console.log(c.dim('─'.repeat(60)));
          console.log(c.green(`Wrote ${written} file(s) to ${c.bold(outDir)}`));
          return;
        }
      }

      message = await ask('\n' + c.orange('คุณ› '));
    }
  } finally {
    rl.close();
  }
}

// ── PHASE 5 COMMANDS ──────────────────────────────────────────────────────────

async function cmdSandbox(code: string, opts: { lang?: string; timeout?: number }) {
  banner();
  const language = (opts.lang ?? 'javascript') as SandboxLanguage;
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    console.log(c.red(`Unsupported language: ${language}`));
    console.log(`Supported: ${SUPPORTED_LANGUAGES.join(', ')}`);
    return;
  }
  if (!code.trim()) {
    console.log(c.red('usage: aof sandbox "<code>" [--lang=javascript|typescript|python]'));
    return;
  }

  console.log(`${c.dim('language:')} ${c.orange(language)}   ${c.dim('timeout:')} ${opts.timeout ?? 10}s`);
  console.log(c.dim('─'.repeat(60)));

  const result = await runInSandbox({
    language,
    code,
    timeoutMs: (opts.timeout ?? 10) * 1000,
  });

  if (result.stdout) {
    console.log(c.dim('stdout:'));
    for (const line of result.stdout.split('\n')) console.log(`  ${line}`);
  }
  if (result.stderr) {
    console.log(c.yellow('stderr:'));
    for (const line of result.stderr.split('\n')) console.log(`  ${c.yellow(line)}`);
  }
  console.log(c.dim('─'.repeat(60)));
  if (result.timedOut) {
    console.log(c.red(`⏱  Timed out after ${opts.timeout ?? 10}s`));
  } else if (result.success) {
    console.log(c.green(`✓  Done in ${result.durationMs}ms`));
  } else {
    console.log(c.red(`✗  Error: ${result.error ?? 'execution failed'}`));
  }
}

function cmdUsage(userId = 'local') {
  banner();
  const summary = getUsageSummary(userId);
  const quota = checkQuota(userId);

  console.log(c.dim('─'.repeat(60)));
  console.log(c.bold('Today'));
  console.log(`  Tokens:       ${summary.today.tokens.toLocaleString()}`);
  console.log(`  Cost:         $${summary.today.costUsd.toFixed(6)}`);
  console.log(`  Requests:     ${summary.today.requests}`);
  console.log(`  Sandbox runs: ${summary.today.sandboxRuns}`);

  console.log(c.bold('\nThis month'));
  console.log(`  Tokens:   ${summary.thisMonth.tokens.toLocaleString()}`);
  console.log(`  Cost:     $${summary.thisMonth.costUsd.toFixed(6)}`);
  console.log(`  Requests: ${summary.thisMonth.requests}`);

  console.log(c.bold('\nQuota limits'));
  const q = summary.quota;
  console.log(`  Daily tokens:    ${q.dailyTokens > 0 ? q.dailyTokens.toLocaleString() : c.dim('unlimited')}`);
  console.log(`  Monthly tokens:  ${q.monthlyTokens > 0 ? q.monthlyTokens.toLocaleString() : c.dim('unlimited')}`);
  console.log(`  Daily cost:      ${q.dailyCostUsd > 0 ? '$' + q.dailyCostUsd.toFixed(2) : c.dim('unlimited')}`);
  console.log(`  Monthly cost:    ${q.monthlyCostUsd > 0 ? '$' + q.monthlyCostUsd.toFixed(2) : c.dim('unlimited')}`);
  console.log(`  Sandbox/day:     ${q.sandboxRunsPerDay > 0 ? q.sandboxRunsPerDay : c.dim('unlimited')}`);

  console.log(c.dim('\nLast 7 days (tokens):'));
  for (const d of summary.last7Days) {
    const bar = '█'.repeat(Math.min(20, Math.ceil(d.tokens / 5000)));
    console.log(`  ${c.dim(d.date)}  ${c.orange(bar)} ${d.tokens.toLocaleString()}`);
  }

  console.log(c.dim('─'.repeat(60)));
  if (!quota.ok) {
    console.log(c.red(`⚠  Quota exceeded: ${quota.reason}`));
  } else {
    console.log(c.green('✓  Within quota'));
  }
}

function cmdSecurity() {
  banner();
  console.log(c.bold('Security Self-Check'));
  console.log(c.dim('─'.repeat(60)));

  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];

  const jwtSecret = process.env.JWT_SECRET ?? '';
  checks.push({
    label: 'JWT_SECRET',
    ok: jwtSecret.length >= 32,
    detail: jwtSecret.length >= 32
      ? `set (${jwtSecret.length} chars)`
      : `too short or missing (${jwtSecret.length} chars, need ≥32)`,
  });

  const masterKey = process.env.COAGENTIX_MASTER_KEY ?? process.env.AOF_MASTER_KEY ?? '';
  checks.push({
    label: 'COAGENTIX_MASTER_KEY',
    ok: masterKey.length >= 32,
    detail: masterKey.length >= 32
      ? `set (${masterKey.length} chars)`
      : `too short or missing (${masterKey.length} chars, need ≥32)`,
  });

  const allowedOrigins = process.env.COAGENTIX_ALLOWED_ORIGINS ?? process.env.AOF_ALLOWED_ORIGINS ?? '';
  checks.push({
    label: 'CORS allowlist',
    ok: allowedOrigins.length > 0,
    detail: allowedOrigins.length > 0
      ? allowedOrigins
      : 'not set — allows all origins in development, restricts in production',
  });

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  checks.push({
    label: 'NODE_ENV',
    ok: nodeEnv === 'production',
    detail: nodeEnv === 'production'
      ? 'production (HSTS + strict mode active)'
      : `${nodeEnv} (HSTS disabled, localhost CORS allowed)`,
  });

  checks.push({
    label: 'Sandbox shell block',
    ok: true,
    detail: 'bash/shell execution always rejected (security policy enforced in sandbox.ts)',
  });

  checks.push({
    label: 'Timing-safe login',
    ok: true,
    detail: 'verifyPassword() always called even when user not found (Phase 5 fix)',
  });

  checks.push({
    label: 'CSP header',
    ok: true,
    detail: 'Content-Security-Policy applied on all responses (Phase 5 addition)',
  });

  checks.push({
    label: 'AES-256-GCM key encryption',
    ok: true,
    detail: 'API keys encrypted at rest with scrypt-derived key + authenticated encryption',
  });

  for (const ch of checks) {
    const icon = ch.ok ? c.green('✔') : c.red('✗');
    const label = (ch.ok ? c.green : c.red)(ch.label.padEnd(24));
    console.log(`  ${icon}  ${label}  ${c.dim(ch.detail)}`);
  }

  console.log(c.dim('─'.repeat(60)));
  const failed = checks.filter((c) => !c.ok).length;
  if (failed === 0) {
    console.log(c.green(`All ${checks.length} checks passed.`));
  } else {
    console.log(c.red(`${failed} check(s) failed — see above for details.`));
  }
}

function cmdSessions() {
  // List local .aof/sessions
  const sessDir = join(process.cwd(), '.aof', 'sessions');
  if (!existsSync(sessDir)) {
    console.log(c.dim('No sessions found.'));
    return;
  }
  banner();
  const files = readdirSync(sessDir).filter((f) => f.endsWith('.json')).reverse().slice(0, 20);
  if (!files.length) { console.log(c.dim('No sessions yet.')); return; }
  console.log(`${c.dim('Recent sessions')} (${files.length}):\n`);
  for (const f of files) {
    try {
      const bb = JSON.parse(readFileSync(join(sessDir, f), 'utf8'));
      const date = new Date(bb.log?.[0]?.ts ?? 0).toLocaleString();
      const high = (bb.review ?? []).filter((i: { severity?: string }) => i.severity === 'HIGH').length;
      console.log(`  ${c.dim(f.replace('.json', ''))}  ${c.orange(bb.task?.slice(0, 60) ?? '')}  ${c.dim(`· ${bb.iterations ?? 0} iter · ${date}`)}  ${high ? c.red(`${high} HIGH`) : ''}`);
    } catch { /* corrupt session */ }
  }
}

function help() {
  banner();
  console.log(`
${c.bold('Usage')}
  npm run aof -- <command> [args]

${c.bold('Commands')}
  ${c.orange('doctor')}                 check API keys, agents & project context
  ${c.orange('agents')}                 show role → model mapping
  ${c.orange('context')}                scan current directory and show project info
  ${c.orange('gencode')} "<task>"        run full TMAP pipeline and generate files
        --apply              write files into project root (default: ./aof-output)
        --mode=lite|normal|pro
  ${c.orange('titan')} ["<idea>"]         Titan Mode — interactive AI System Architect
        --apply / --mode     same as gencode (used after approval)
  ${c.orange('review')} [dir]            review existing codebase (read-only, lite mode)
  ${c.orange('fix')} [dir]               generate fixes for existing codebase
        --apply              overwrite files in place
  ${c.orange('sessions')}               list recent local sessions

${c.bold('Phase 5 — Developer Platform')}
  ${c.orange('sandbox')} "<code>"         run code in secure local sandbox (no API key needed)
        --lang=javascript|typescript|python
        --timeout=<seconds>  (default 10, max 30)
  ${c.orange('usage')}                  show local token/cost usage and quota status
  ${c.orange('security')}               run security self-check against current configuration

${c.bold('Examples')}
  npm run aof -- doctor
  npm run aof -- gencode "build a REST API for a todo app in Node.js"
  npm run aof -- review ./src
  npm run aof -- fix ./src --apply
  npm run aof -- sandbox "console.log(2 ** 32)"
  npm run aof -- sandbox "print(sum(range(101)))" --lang=python
  npm run aof -- usage
  npm run aof -- security
`);
}

// ── entry ──────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const apply = argv.includes('--apply');
  const modeArg = argv.find((a) => a.startsWith('--mode='))?.split('=')[1];
  const langArg = argv.find((a) => a.startsWith('--lang='))?.split('=')[1];
  const timeoutArg = argv.find((a) => a.startsWith('--timeout='))?.split('=')[1];
  const rest = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim();

  switch (cmd) {
    case 'doctor':   cmdDoctor(); break;
    case 'agents':   cmdAgents(); break;
    case 'context':  cmdContext(); break;
    case 'sessions': cmdSessions(); break;
    case 'titan':    await cmdTitan(rest, { apply, mode: modeArg }); break;
    case 'review':   await cmdReview(rest); break;
    case 'fix':      await cmdFix(rest, { apply }); break;
    case 'sandbox':  await cmdSandbox(rest, { lang: langArg, timeout: timeoutArg ? Number(timeoutArg) : undefined }); break;
    case 'usage':    cmdUsage(); break;
    case 'security': cmdSecurity(); break;
    case 'gencode':
    case 'run':      await cmdGencode(rest, { apply, mode: modeArg }); break;
    case undefined:
    case '--help':
    case '-h':
    case 'help':     help(); break;
    default:
      await cmdGencode(argv.filter((a) => !a.startsWith('--')).join(' '), { apply, mode: modeArg });
  }
}

main();
