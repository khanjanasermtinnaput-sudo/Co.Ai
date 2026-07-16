// ── Dev-server lifecycle for HTTP-level route tests ───────────────────────────
// Route handlers use next/headers `cookies()`, which throws outside a real
// Next.js request context — so HTTP route tests need an actual running server
// rather than direct module-import invocation. This spawns `next dev` as a
// child process on a dedicated port, polls /api/health for readiness, and
// tears the process (and its children, on Windows) down afterward.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

async function tryListen(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", () => resolve(null));
    srv.listen(port, "127.0.0.1", () => {
      const addr = srv.address();
      const bound = typeof addr === "object" && addr ? addr.port : null;
      srv.close(() => resolve(bound));
    });
  });
}

/** Try a stable, memorable port first (distinct from Next's own default 3000,
 *  reducing collision with a dev server the user may already have running),
 *  then fall back to an OS-assigned ephemeral port. */
async function findFreePort(preferred = 4173): Promise<number> {
  const viaPreferred = await tryListen(preferred);
  if (viaPreferred != null) return viaPreferred;
  const viaEphemeral = await tryListen(0);
  if (viaEphemeral != null) return viaEphemeral;
  throw new Error("no free port found for test dev server");
}

export interface DevServer {
  baseUrl: string;
  port: number;
  logTail(): string;
  stop(): Promise<void>;
}

async function waitForReady(port: number, logs: string[], timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200) return;
    } catch {
      // not up yet, or still compiling the first request — keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `dev server on :${port} did not become ready within ${timeoutMs}ms\n--- server log tail ---\n${logs.slice(-40).join("")}`,
  );
}

async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const tk = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      tk.on("exit", () => resolve());
      tk.on("error", () => resolve());
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

export async function startDevServer(): Promise<DevServer> {
  const port = await findFreePort();
  const logs: string[] = [];

  // On Windows, spawning the "npx.cmd" shim directly (without shell: true)
  // throws "spawn EINVAL" — cmd/bat files must go through a shell.
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
  });
  child.stdout?.on("data", (b: Buffer) => logs.push(b.toString()));
  child.stderr?.on("data", (b: Buffer) => logs.push(b.toString()));

  await waitForReady(port, logs);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    logTail: () => logs.slice(-40).join(""),
    stop: () => killTree(child),
  };
}
