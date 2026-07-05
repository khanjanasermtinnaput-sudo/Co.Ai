---
name: run-aof-web
description: Build, run, and drive aof-web (Co.AI's Next.js 14 frontend) in demo mode. Use when asked to start aof-web, launch Co.AI, take a screenshot of its UI (chat, CoCode, projects, settings), or verify a change renders in the browser.
---

Next.js 14 app. It degrades gracefully with zero secrets: no Supabase/provider
env → offline demo UI (seeded projects, stand-in user) automatically, and
`NEXT_PUBLIC_COAGENTIX_DEMO=1` additionally turns on a mock-AI engine so chat
and CoCode return real (simulated) replies instead of provider errors. There is
no `chromium-cli` on this machine, so the driver here is a small Node/Playwright
script (`driver.mjs`) — `playwright` is a devDependency of this package.

All paths below are relative to `aof-web/`.

## Setup

Deps are normally already installed (`node_modules/` present). If not:

```bash
npm install
```

`playwright` is already a devDependency (added for this driver) and its
Chromium build is expected to already be cached at
`~/AppData/Local/ms-playwright/` (or `~/.cache/ms-playwright/` on
Linux/Mac). If `driver.mjs` fails with a "browser not found" error:

```bash
npx playwright install chromium
```

Demo-mode env — create once, no real keys needed:

```bash
cat > .env.local <<'EOF'
NEXT_PUBLIC_COAGENTIX_DEMO=1
NEXT_PUBLIC_SITE_URL=http://localhost:3000
EOF
```

(`.env.local` is gitignored — safe to recreate any time. Leave
`NEXT_PUBLIC_SUPABASE_*` unset so the offline degrade path stays active too.)

## Run (agent path)

1. Make sure port 3000 is free (kill any previous dev server first — a stale
   one causes silent EADDRINUSE port-hopping):

   ```bash
   # Windows/git-bash:
   netstat -ano | grep ":3000" | grep LISTENING   # note the PID in the last column
   taskkill //PID <pid> //F
   # Linux/Mac: pkill -f 'next dev'
   ```

2. Start the dev server in the background and poll until ready (first
   compile can take 30-60s; don't fixed-`sleep`):

   ```bash
   npm run dev &
   for i in $(seq 1 30); do
     curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ | grep -q 200 && break
     sleep 2
   done
   ```

3. Drive it with `driver.mjs`:

   ```bash
   node .claude/skills/run-aof-web/driver.mjs smoke .driver-shots
   ```

   Screenshots land in `.driver-shots/` (gitignored) — `home.png`, `chat.png`,
   `code.png`, `projects.png`, `settings.png`, `login.png`. Console errors
   (if any) print per-route to stdout: `<route> -> ERRORS: [...]`.

| command | what it does |
|---|---|
| `driver.mjs smoke [outDir]` | Screenshots `/`, `/chat`, `/code`, `/projects`, `/settings`, `/login`; reports console errors per route. Default `outDir` is `.driver-shots`. |
| `driver.mjs shot <route> <outfile>` | Screenshot one route, e.g. `driver.mjs shot /projects out.png`. |
| `driver.mjs chat <message> <outfile>` | Opens `/chat`, sends `<message>`, waits ~3s for the mock-AI reply to stream in, screenshots the result. Proves the demo engine responds end-to-end, not just that the page renders. |

All commands assume the dev server is already running on
`http://localhost:3000` (override with `AOF_WEB_BASE_URL`).

**Always look at the screenshot** (read the PNG) — a 200 status only proves
the route resolved, not that the page rendered real content instead of a
blank frame or error boundary.

## Run (human path)

```bash
npm run dev   # → http://localhost:3000, Ctrl-C to stop
```

## Test

```bash
npm run typecheck   # tsc --noEmit
npm test             # tsx --test src/tests/*.test.ts (610+ tests)
```

## Gotchas

- **`NEXT_PUBLIC_*` vars are inlined at server start.** Setting
  `NEXT_PUBLIC_COAGENTIX_DEMO=1` after `next dev` is already running does
  nothing — the env file must exist *before* launch, and a running server
  must be restarted to pick up a new `.env.local`.
- **The chat reply streams in.** `driver.mjs chat` waits a fixed 3s before
  screenshotting; on a slow run you may catch it mid-stream (cursor still
  blinking, "stop" button still showing instead of the send arrow) rather
  than the finished reply. That's still valid proof the engine responded —
  but if you need the *final* text, increase the wait or poll for the
  send-button to reappear.
- **A stale `next dev` from a previous session silently squats on :3000.**
  `next dev` doesn't always error loudly if the port's taken by an old
  instance of itself — check `netstat`/kill first rather than assuming a
  fresh `npm run dev` is the one you're talking to.

## Troubleshooting

- **`[preflight] Missing required env: NEXT_PUBLIC_SUPABASE_URL, ...` in
  server logs**: expected and harmless in demo mode — it's the app
  confirming it's continuing in degraded/development mode, not a failure.
- **`EPERM: operation not permitted, mkdir 'C:\Program Files\Git\...'`** when
  passing a `/tmp/...`-style path to `driver.mjs smoke` under git-bash on
  Windows: git-bash rewrites leading `/tmp` to the Git install dir. Use a
  relative path (e.g. `.driver-shots`) or a full Windows-style path instead.
