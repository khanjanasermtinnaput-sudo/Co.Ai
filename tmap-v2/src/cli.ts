#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { resolveAll, currentMode, anyKeyConfigured, PROVIDERS, ROLE_PROVIDER } from './config.js';
import { createBlackboard } from './core/blackboard.js';
import { runTMAP } from './core/orchestrator.js';
import type { Role } from './types.js';

// ── tiny ANSI helpers (no deps) ───────────────────────────────────────────────
const c = {
  orange: (s: string) => `\x1b[38;5;208m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const ROLE_COLOR: Record<string, (s: string) => string> = {
  planner: c.orange, coder: c.green, reviewer: c.yellow, validator: c.blue, system: c.dim,
};

function banner() {
  console.log(c.bold(`AOF ${c.orange('Code')}  ${c.dim('· TMAP v2 multi-agent')}`));
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

  console.log(c.dim('─'.repeat(60)));
  if (!anyKeyConfigured()) {
    console.log(c.yellow('No API key set — running in MOCK mode.'));
    console.log(`Add a key:  ${c.bold('copy .env.example .env')}  then edit ${c.bold('.env')}`);
    console.log(`Easiest: put one ${c.bold('OPENROUTER_API_KEY')} → covers all 4 agents.`);
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

async function cmdGencode(task: string, opts: { apply: boolean }) {
  if (!task) {
    console.log(c.red('usage: aof gencode "<what to build>"'));
    return;
  }
  banner();
  console.log(`${c.dim('task:')} ${c.orange(task)}   ${c.dim('mode:')} ${currentMode()}`);
  if (!anyKeyConfigured()) console.log(c.yellow('(mock mode — no API key; results are placeholders)'));
  console.log(c.dim('─'.repeat(60)));

  const bb = createBlackboard(task, currentMode());

  const emit = (role: string, text: string, kind: 'status' | 'output' | 'error' = 'status') => {
    const color = ROLE_COLOR[role] || c.dim;
    const label = color(`${role.padEnd(10)}`);
    const arrow = kind === 'error' ? c.red('✗') : kind === 'status' ? c.dim('·') : c.green('›');
    for (const line of text.split('\n')) {
      if (line.trim()) console.log(`${label} ${arrow} ${kind === 'error' ? c.red(line) : line}`);
    }
  };

  try {
    await runTMAP(bb, emit);
  } catch (e) {
    console.log(c.red(`\nError: ${(e as Error).message}`));
    return;
  }

  // write generated files
  const outDir = opts.apply ? process.cwd() : join(process.cwd(), 'aof-output');
  for (const f of bb.files) {
    const target = join(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, 'utf8');
  }
  console.log(c.dim('─'.repeat(60)));
  console.log(c.green(`Wrote ${bb.files.length} file(s) to ${c.bold(outDir)}`));
  if (!opts.apply) console.log(c.dim('(use --apply to write into the current project root instead)'));

  const high = bb.review.filter((i) => i.severity === 'HIGH').length;
  console.log(`Review: ${high ? c.red(`${high} HIGH`) : c.green('no blocking issues')}   ·   iterations: ${bb.iterations}`);
}

function help() {
  banner();
  console.log(`
${c.bold('Usage')}
  npm run aof -- <command> [args]

${c.bold('Commands')}
  ${c.orange('doctor')}                 check API keys & resolved agents
  ${c.orange('agents')}                 show role → model mapping
  ${c.orange('gencode')} "<task>"        run the TMAP pipeline and generate files
        --apply              write files into the project root (default: ./aof-output)

${c.bold('Examples')}
  npm run aof -- doctor
  npm run aof -- gencode "build a REST API for a todo app in Node.js"
`);
}

// ── entry ──────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const apply = argv.includes('--apply');
  const rest = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ');

  switch (cmd) {
    case 'doctor': cmdDoctor(); break;
    case 'agents': cmdAgents(); break;
    case 'gencode':
    case 'run': await cmdGencode(rest, { apply }); break;
    case undefined:
    case '--help':
    case '-h':
    case 'help': help(); break;
    default:
      // bare prompt:  aof "build X"
      await cmdGencode(argv.filter((a) => !a.startsWith('--')).join(' '), { apply });
  }
}

main();
