#!/usr/bin/env node
// Hermetic test launcher. Sets NODE_ENV=test (cross-platform — Windows cmd can't
// do `NODE_ENV=test` inline) so config.forceOfflineForTest() short-circuits every
// provider call to mock. No live, billed upstream is ever contacted by `npm test`.
//
// Usage:
//   node scripts/test.mjs                 # full offline suite (default)
//   node scripts/test.mjs --live          # real providers (sets COAGENTIX_ALLOW_LIVE=1)
//   node scripts/test.mjs <glob> [glob…]  # custom file globs
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const live = args.includes('--live');
const globs = args.filter((a) => a !== '--live');
const files = globs.length ? globs : live ? ['src/tests/e2e.live.test.ts'] : ['src/tests/*.test.ts'];

const env = { ...process.env };
if (live) {
  env.COAGENTIX_ALLOW_LIVE = '1';
  delete env.NODE_ENV; // let live suite use the real environment
} else {
  env.NODE_ENV = 'test';
  delete env.COAGENTIX_ALLOW_LIVE;
}

const r = spawnSync('npx', ['tsx', '--test', ...files], { stdio: 'inherit', shell: true, env });
process.exit(r.status ?? 1);
