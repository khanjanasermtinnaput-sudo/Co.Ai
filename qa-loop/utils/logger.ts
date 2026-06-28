// ANSI escape codes — no chalk dependency needed
const R = "\x1b[0m";
const bold = (s: string) => `\x1b[1m${s}${R}`;
const green = (s: string) => `\x1b[32m${s}${R}`;
const red = (s: string) => `\x1b[31m${s}${R}`;
const yellow = (s: string) => `\x1b[33m${s}${R}`;
const cyan = (s: string) => `\x1b[36m${s}${R}`;
const gray = (s: string) => `\x1b[90m${s}${R}`;
const magenta = (s: string) => `\x1b[35m${s}${R}`;

function ts(): string {
  return gray(`[${new Date().toISOString()}]`);
}

export const log = {
  info: (msg: string) => console.log(`${ts()} ${cyan("ℹ")} ${msg}`),
  ok: (msg: string) => console.log(`${ts()} ${green("✓")} ${msg}`),
  fail: (msg: string) => console.log(`${ts()} ${red("✗")} ${msg}`),
  warn: (msg: string) => console.log(`${ts()} ${yellow("⚠")} ${msg}`),
  phase: (n: number, name: string) =>
    console.log(`\n${bold(cyan(`━━━ Phase ${n}: ${name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`))}`)
  ,
  loop: (iteration: number) =>
    console.log(`\n${bold(magenta(`\n${"═".repeat(70)}\n  LOOP ITERATION #${iteration}\n${"═".repeat(70)}`))}`),
  summary: (pass: number, fail: number, ms: number) => {
    const status = fail === 0 ? green("ALL PASS") : red(`${fail} FAILED`);
    console.log(`\n${bold("SUMMARY")} — ${status} | ${green(String(pass))} passed | took ${gray(ms + "ms")}`);
  },
};
