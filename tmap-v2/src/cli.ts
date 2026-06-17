#!/usr/bin/env node
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname, resolve, normalize, relative } from 'node:path';
import { resolveAll, currentMode, anyKeyConfigured, PROVIDERS, ROLE_PROVIDER, bagFromEnv } from './config.js';
import type { CodeFile } from './types.js';
import { createBlackboard, loadSession } from './core/blackboard.js';
import { runTMAP } from './core/orchestrator.js';
import { gatherProjectContext } from './core/context.js';
import { runTitan, blueprintToBuild } from './core/titan.js';
import { loadMemory, memoryToContext, recordDecision, clearMemory } from './core/memory.js';
import { runAnalyzer } from './core/analyze.js';
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

// ── interactive diff review ────────────────────────────────────────────────────
// Shows generated files and asks confirmation before writing to disk.
async function selectFilesToApply(files: CodeFile[]): Promise<CodeFile[]> {
  if (!files.length) return [];

  console.log(c.dim('\n' + '─'.repeat(60)));
  console.log(c.bold(`Files to write`) + c.dim(` (${files.length}):`));
  for (const f of files) {
    const lines = f.content.split('\n').length;
    console.log(`  ${c.green('+')} ${c.bold(f.path)}  ${c.dim(`${lines} line${lines !== 1 ? 's' : ''}`)}`);
  }
  console.log();

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(
      `Apply?  ${c.bold('[y]')}es all · ${c.bold('[e]')}ach file · ${c.bold('[N]')}o  `,
    )).trim().toLowerCase();

    if (answer === 'y' || answer === 'yes') return files;

    if (answer === 'e' || answer === 'each') {
      const selected: CodeFile[] = [];
      for (const f of files) {
        const lines = f.content.split('\n');
        const preview = lines.slice(0, 18).join('\n');
        console.log(c.dim('\n' + '─'.repeat(60)));
        console.log(`${c.green('+')} ${c.bold(f.path)}  ${c.dim(`(${lines.length} lines)`)}`);
        for (const line of preview.split('\n')) console.log(`  ${c.dim(line)}`);
        if (lines.length > 18) console.log(`  ${c.dim(`... +${lines.length - 18} more lines`)}`);
        const a2 = (await rl.question(`  Write this file?  ${c.bold('[y/N]')} `)).trim();
        if (/^(y|yes)$/i.test(a2)) selected.push(f);
      }
      console.log();
      return selected;
    }

    return []; // 'n' or anything else → skip
  } finally {
    rl.close();
  }
}

function writeFiles(files: CodeFile[], outDir: string): void {
  const resolvedOut = resolve(outDir);
  for (const f of files) {
    // Reject absolute paths and path traversal (../foo) produced by LLM
    const normalised = normalize(f.path).replace(/\\/g, '/');
    if (normalised.startsWith('/') || normalised.startsWith('..')) {
      console.log(c.red(`  Skipped unsafe path: ${f.path}`));
      continue;
    }
    const target = join(resolvedOut, normalised);
    // Double-check the resolved target is actually inside outDir
    if (!resolve(target).startsWith(resolvedOut + '/') && resolve(target) !== resolvedOut) {
      console.log(c.red(`  Skipped path outside output dir: ${f.path}`));
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, 'utf8');
  }
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
  const healthSnap = globalHealth.snapshot();
  const healthMap = new Map(healthSnap.map((h) => [h.key, h]));

  console.log(c.bold('\nRole → Model Mapping  (● closed  ◑ half-open  ○ open)\n'));
  (Object.keys(agents) as Role[]).forEach((r) => {
    const a = agents[r];
    const provKey = ROLE_PROVIDER[r];
    const h = healthMap.get(provKey);
    const circuit = !h ? c.dim('○')
      : h.circuit === 'closed'    ? c.green('●')
      : h.circuit === 'half_open' ? c.yellow('◑')
      : c.red('○');
    const latency = h ? c.dim(`${Math.round(h.ewmaLatencyMs)}ms`) : c.dim('—');
    const tag = a.mode === 'mock' ? c.red('[mock]')
      : a.mode === 'fallback' ? c.yellow('[fallback]')
      : c.green('[ready]');
    console.log(
      `  ${circuit}  ${ROLE_COLOR[r](r.padEnd(10))} ${c.dim('→')} ${PROVIDERS[provKey].name.padEnd(12)} ${c.dim(a.model.padEnd(28))} ${latency.padEnd(8)}  ${tag}`,
    );
  });

  if (healthSnap.length) {
    console.log(c.dim('\nProvider health (DARS):'));
    for (const h of healthSnap) {
      const st = h.circuit === 'closed' ? c.green('closed   ')
        : h.circuit === 'half_open' ? c.yellow('half-open')
        : c.red('open     ');
      const fails = h.consecutiveFails ? c.red(` fails:${h.consecutiveFails}`) : '';
      console.log(`  ${st}  ${h.key.padEnd(22)} ${c.dim(`${Math.round(h.ewmaLatencyMs)}ms`)}${fails}`);
    }
  }
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

  const high = bb.review.filter((i) => i.severity === 'HIGH').length;
  console.log(`Review: ${high ? c.red(`${high} HIGH`) : c.green('no blocking issues')}   ·   iterations: ${bb.iterations}`);

  if (opts.apply) {
    const toWrite = await selectFilesToApply(bb.files);
    if (toWrite.length) {
      writeFiles(toWrite, process.cwd());
      console.log(c.green(`Wrote ${toWrite.length} file(s) to ${c.bold(process.cwd())}`));
    } else {
      console.log(c.dim('No files written.'));
    }
  } else {
    const outDir = join(process.cwd(), 'aof-output');
    writeFiles(bb.files, outDir);
    console.log(c.dim('─'.repeat(60)));
    console.log(c.green(`Wrote ${bb.files.length} file(s) to ${c.bold(outDir)}`));
    console.log(c.dim('(use --apply to review each file and write into the project root)'));
  }
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

  if (opts.apply) {
    const toWrite = await selectFilesToApply(bb.files);
    if (toWrite.length) {
      writeFiles(toWrite, dir);
      console.log(c.green(`Fixed ${toWrite.length} file(s) in ${c.bold(dir)}`));
    } else {
      console.log(c.dim('No files written.'));
    }
  } else {
    const outDir = join(process.cwd(), 'aof-fix-output');
    writeFiles(bb.files, outDir);
    console.log(c.dim('─'.repeat(60)));
    console.log(c.green(`Fixed ${bb.files.length} file(s) → ${c.bold(outDir)}`));
    console.log(c.dim('(use --apply to review and overwrite files in place)'));
  }
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
          if (opts.apply) {
            const toWrite = await selectFilesToApply(bb.files);
            if (toWrite.length) {
              writeFiles(toWrite, process.cwd());
              console.log(c.green(`Wrote ${toWrite.length} file(s) to ${c.bold(process.cwd())}`));
            } else {
              console.log(c.dim('No files written.'));
            }
          } else {
            const outDir = join(process.cwd(), 'aof-output');
            writeFiles(bb.files, outDir);
            console.log(c.dim('─'.repeat(60)));
            console.log(c.green(`Wrote ${bb.files.length} file(s) to ${c.bold(outDir)}`));
          }
          return;
        }
      }

      message = await ask('\n' + c.orange('คุณ› '));
    }
  } finally {
    rl.close();
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
      const high = (bb.review ?? []).filter((i: any) => i.severity === 'HIGH').length;
      console.log(`  ${c.dim(f.replace('.json', ''))}  ${c.orange(bb.task?.slice(0, 60) ?? '')}  ${c.dim(`· ${bb.iterations ?? 0} iter · ${date}`)}  ${high ? c.red(`${high} HIGH`) : ''}`);
    } catch { /* corrupt session */ }
  }
}

async function cmdAnalyze(brief: string) {
  if (!brief.trim()) {
    console.log(c.red('usage: aof analyze "<project brief or idea>"'));
    return;
  }
  banner();
  console.log(`${c.dim('analyzing:')} ${c.orange(brief)}`);
  console.log(c.dim('─'.repeat(60)));

  const creds = bagFromEnv();
  const emit = makeEmit();
  const call = async (messages: import('./types.js').ChatMessage[], opts = {}) => {
    const r = await chatWithDARS('planner', messages, opts, {
      creds, health: globalHealth, emit, sessionId: 'analyze-cli',
    });
    return r.text;
  };

  try {
    const result = await runAnalyzer(call, brief);
    console.log(c.dim('─'.repeat(60)));
    console.log(c.bold(`Feasibility: ${result.feasibility === 'high' ? c.green('HIGH') : result.feasibility === 'medium' ? c.yellow('MEDIUM') : c.red('LOW')}`));
    if (result.risks?.length) {
      console.log(c.bold('\nRisks:'));
      for (const r of result.risks) console.log(`  ${c.red('·')} ${r}`);
    }
    if (result.recommendations?.length) {
      console.log(c.bold('\nRecommendations:'));
      for (const r of result.recommendations) console.log(`  ${c.green('·')} ${r}`);
    }
  } catch (e) {
    console.log(c.red(`Error: ${(e as Error).message}`));
  }
}

async function cmdMemory(subCmd: string) {
  banner();
  const memoryKey = process.cwd();

  if (subCmd === 'clear') {
    try {
      await clearMemory(memoryKey);
      console.log(c.green('Project memory cleared.'));
    } catch (e) {
      console.log(c.red(`Error: ${(e as Error).message}`));
    }
    return;
  }

  try {
    const mem = await loadMemory(memoryKey);
    const ctx = memoryToContext(mem);
    if (!ctx) {
      console.log(c.dim('No project memory found for this directory.'));
      console.log(c.dim(`Run ${c.bold('aof gencode')} or ${c.bold('aof titan')} to build up memory.`));
      return;
    }
    console.log(c.dim('─'.repeat(60)));
    console.log(c.bold(`Project: ${c.orange(memoryKey)}`));
    if (mem.techStack) console.log(`Tech stack:  ${c.orange(mem.techStack)}`);
    if (mem.conventions?.length) console.log(`Conventions: ${mem.conventions.slice(0, 5).join(', ')}`);
    if (mem.decisions?.length) {
      console.log(c.bold('\nArchitecture decisions:'));
      for (const d of mem.decisions.slice(0, 10)) console.log(`  ${c.dim('·')} ${d}`);
    }
    if (mem.sessions?.length) {
      console.log(c.bold(`\nSessions (${mem.sessions.length}):`));
      for (const s of mem.sessions.slice(0, 5)) {
        const icon = s.status === 'done' ? c.green('✓') : c.red('✗');
        console.log(`  ${icon} ${c.orange(s.task.slice(0, 60))}  ${c.dim(s.at ?? '')}`);
      }
    }
  } catch (e) {
    console.log(c.red(`Error: ${(e as Error).message}`));
  }
}

async function cmdExplain(filePath: string) {
  if (!filePath.trim()) {
    console.log(c.red('usage: aof explain <file-path>'));
    return;
  }
  const { readFileSync, existsSync } = await import('node:fs');
  if (!existsSync(filePath)) {
    console.log(c.red(`File not found: ${filePath}`));
    return;
  }
  banner();
  const content = readFileSync(filePath, 'utf8');
  const snippet = content.slice(0, 8000);
  console.log(`${c.dim('explaining:')} ${c.orange(filePath)}`);
  console.log(c.dim('─'.repeat(60)));

  const creds = bagFromEnv();
  const emit = makeEmit();
  const messages: import('./types.js').ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a senior engineer. Explain the following code clearly and concisely: what it does, how it works, and any notable patterns or concerns. Write in a clear professional style.',
    },
    {
      role: 'user',
      content: `File: ${filePath}\n\n\`\`\`\n${snippet}\n\`\`\`${content.length > 8000 ? '\n\n(file truncated)' : ''}`,
    },
  ];

  try {
    const r = await chatWithDARS('reviewer', messages, {}, {
      creds, health: globalHealth, emit, sessionId: 'explain-cli',
    });
    console.log(c.dim('─'.repeat(60)));
    for (const line of r.text.split('\n')) {
      console.log(`${c.blue('explain   ')} ${c.dim('›')} ${line}`);
    }
  } catch (e) {
    console.log(c.red(`Error: ${(e as Error).message}`));
  }
}

// ── CREDENTIAL STORE (server login token) ─────────────────────────────────────
const CRED_FILE = join(
  process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(),
  '.aof', 'credentials.json',
);
interface SavedCreds { serverUrl: string; token: string; username: string }
function loadCreds(): SavedCreds | null {
  try {
    if (!existsSync(CRED_FILE)) return null;
    return JSON.parse(readFileSync(CRED_FILE, 'utf8')) as SavedCreds;
  } catch { return null; }
}
function saveCreds(data: SavedCreds): void {
  mkdirSync(dirname(CRED_FILE), { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── aof login ─────────────────────────────────────────────────────────────────
async function cmdLogin() {
  banner();
  console.log(c.bold('Login to AOF Code server\n'));
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const existing = loadCreds();
    const defaultUrl = existing?.serverUrl ?? 'http://localhost:8787';
    const serverUrl = ((await rl.question(`Server URL [${defaultUrl}]: `)).trim() || defaultUrl)
      .replace(/\/$/, '');
    const username = (await rl.question('Username: ')).trim();
    const pin = (await rl.question('PIN: ')).trim();

    if (!username || !pin) { console.log(c.red('username and PIN required')); return; }

    process.stdout.write(c.dim('Logging in…'));
    const res = await fetch(`${serverUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin }),
    });
    const data = await res.json() as { token?: string; username?: string; error?: string };
    if (!res.ok || !data.token) {
      console.log(c.red(` ✗\n${data.error ?? `HTTP ${res.status}`}`));
      return;
    }
    saveCreds({ serverUrl, token: data.token, username: data.username ?? username });
    console.log(c.green(` ✓\nLogged in as ${c.bold(username)} → ${serverUrl}`));
  } catch (e) {
    console.log(c.red(`\nError: ${(e as Error).message}`));
  } finally {
    rl.close();
  }
}

// ── aof chat (standalone REPL via DARS) ───────────────────────────────────────
async function cmdChat(initial: string) {
  banner();
  console.log(`${c.bold('Chat')} ${c.dim('· type exit to quit\n')}`);
  if (!anyKeyConfigured()) console.log(c.yellow('(mock mode — no API key)'));

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => { closed = true; });
  const ask = async (q: string) => {
    if (closed) return 'exit';
    try { return await rl.question(q); } catch { return 'exit'; }
  };

  const creds = bagFromEnv();
  const emit = makeEmit();
  const history: ChatMessage[] = [];

  let message = initial || (await ask(c.orange('คุณ› ')));
  try {
    while (true) {
      if (!message.trim()) { message = await ask(c.orange('คุณ› ')); continue; }
      if (/^(exit|quit|ออก)$/i.test(message.trim())) break;

      try {
        const r = await chatWithDARS('planner', [
          { role: 'system', content: 'You are AOF AI, a helpful and highly capable AI assistant. Respond in the same language the user uses. Be concise but thorough.' },
          ...history.slice(-10),
          { role: 'user', content: message },
        ], {}, { creds, health: globalHealth, emit, sessionId: 'chat-cli' });
        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: r.text });
        console.log();
        for (const line of r.text.split('\n')) {
          console.log(`${c.blue('aof       ')} ${c.dim('›')} ${line}`);
        }
        console.log();
      } catch (e) {
        console.log(c.red(`Error: ${(e as Error).message}`));
      }
      message = await ask(c.orange('คุณ› '));
    }
  } finally {
    rl.close();
  }
}

// ── aof project ───────────────────────────────────────────────────────────────
async function cmdProject(sub: string) {
  banner();
  const creds = loadCreds();
  if (!creds) {
    console.log(c.red('Not logged in. Run: npm run aof -- login'));
    return;
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${creds.token}`,
  };

  if (sub === 'list' || !sub) {
    const res = await fetch(`${creds.serverUrl}/v1/projects`, { headers }).catch(() => null);
    if (!res?.ok) { console.log(c.red('Could not reach server')); return; }
    const { projects } = await res.json() as { projects: Array<{ id: string; name: string; repoUrl?: string; createdAt: string }> };
    if (!projects.length) { console.log(c.dim('No projects yet. Run: aof project create "<name>"')); return; }
    console.log(c.bold(`\nProjects (${projects.length}):\n`));
    for (const p of projects) {
      console.log(`  ${c.green('•')} ${c.bold(p.name)}  ${c.dim(p.id.slice(0, 8))}  ${p.repoUrl ? c.dim(p.repoUrl) : ''}`);
    }
    return;
  }

  const words = sub.trim().split(/\s+/);
  const action = words[0];
  const nameArg = words.slice(1).join(' ');

  if (action === 'create' || action === 'init') {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let name = nameArg;
    if (!name) name = (await rl.question('Project name: ')).trim();
    const repoUrl = (await rl.question('Repo URL (optional): ')).trim() || undefined;
    rl.close();
    if (!name) { console.log(c.red('name required')); return; }
    const res = await fetch(`${creds.serverUrl}/v1/projects`, {
      method: 'POST', headers, body: JSON.stringify({ name, repoUrl }),
    }).catch(() => null);
    if (!res?.ok) { console.log(c.red('Failed to create project')); return; }
    const { project } = await res.json() as { project: { id: string; name: string } };
    console.log(c.green(`Created: ${c.bold(project.name)}  ${c.dim(project.id)}`));
    return;
  }

  console.log(c.yellow(`Unknown project sub-command: ${action}`));
  console.log(c.dim('Usage: aof project [list | create "<name>"]'));
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
  ${c.orange('login')}                  login to AOF Code server (saves token)
  ${c.orange('chat')} ["<message>"]      interactive REPL chat with the AI
  ${c.orange('project')} [list|create]   manage server projects (requires login)
  ${c.orange('gencode')} "<task>"        run full TMAP pipeline and generate files
        --apply              interactive diff review → write into project root
        --mode=lite|normal|pro
  ${c.orange('titan')} ["<idea>"]         Titan Mode — interactive AI System Architect:
                         discovery → multi-plan → risks → approval gate → build
        --apply / --mode     same as gencode (used after approval)
  ${c.orange('review')} [dir]            review existing codebase (read-only, lite mode)
  ${c.orange('fix')} [dir]               generate fixes for existing codebase
        --apply              interactive diff review → overwrite files in place
  ${c.orange('analyze')} "<brief>"       assess feasibility, risks, recommendations (no code)
  ${c.orange('explain')} <file>          explain what a source file does
  ${c.orange('memory')} [clear]          show (or clear) persistent project memory
  ${c.orange('sessions')}               list recent local sessions

${c.bold('Examples')}
  npm run aof -- doctor
  npm run aof -- login
  npm run aof -- chat "explain async/await in JS"
  npm run aof -- gencode "build a REST API for a todo app in Node.js"
  npm run aof -- review ./src
  npm run aof -- fix ./src --apply
  npm run aof -- sessions
`);
}

// ── entry ──────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const apply = argv.includes('--apply');
  const modeArg = argv.find((a) => a.startsWith('--mode='))?.split('=')[1];
  const rest = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim();

  switch (cmd) {
    case 'doctor':   cmdDoctor(); break;
    case 'agents':   cmdAgents(); break;
    case 'context':  cmdContext(); break;
    case 'sessions': cmdSessions(); break;
    case 'login':    await cmdLogin(); break;
    case 'chat':     await cmdChat(rest); break;
    case 'project':  await cmdProject(rest); break;
    case 'titan':    await cmdTitan(rest, { apply, mode: modeArg }); break;
    case 'review':   await cmdReview(rest); break;
    case 'fix':      await cmdFix(rest, { apply }); break;
    case 'analyze':  await cmdAnalyze(rest); break;
    case 'explain':  await cmdExplain(rest); break;
    case 'memory':   await cmdMemory(rest); break;
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
