// Sandbox execution policy — Round 1 #5.
//
// The Node `vm` engine (sandbox.ts) does NOT provide process-level isolation: a
// crafted payload can escape via prototype pollution or native bindings. That is
// acceptable for trusted, locally-run developer code, but NOT for executing
// untrusted code on a shared hosted backend.
//
// This module centralises the decision of WHICH engine may run, and — crucially —
// refuses the insecure vm fallback in production. In a hosted/production runtime,
// code execution requires Docker (or an external isolate); if Docker is not
// available the feature is disabled (fails closed) rather than silently dropping
// to the unsafe in-process engine. Security takes priority over the feature.
//
// Configuration (all optional):
//   SANDBOX_ENABLED=0          → disable code execution entirely.
//   SANDBOX_REQUIRE_DOCKER=1   → force Docker-only even outside production.
//   SANDBOX_ALLOW_VM=1         → explicitly permit the vm engine (break-glass;
//                                use only when you fully trust the input).
//
// All functions are pure given an env object, so the policy is unit-testable
// without a Docker daemon.

export type SandboxEngine = 'docker' | 'vm' | 'none';

export interface SandboxDecision {
  engine: SandboxEngine;
  /** Human-readable reason when engine === 'none'. */
  reason?: string;
}

type Env = Record<string, string | undefined>;

function truthy(v: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());
}
function falsy(v: string | undefined): boolean {
  return ['0', 'false', 'no', 'off'].includes((v ?? '').trim().toLowerCase());
}

/** Hosted serverless/PaaS runtimes where the operator does not control the host. */
export function isHostedRuntime(env: Env = process.env): boolean {
  return Boolean(
    env.VERCEL || env.RENDER || env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID ||
    env.FLY_APP_NAME || env.AWS_LAMBDA_FUNCTION_NAME,
  );
}

/** Production posture: explicit NODE_ENV=production or any hosted runtime marker. */
export function isProductionRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' || isHostedRuntime(env);
}

/** Whether the insecure Node-vm engine may be used at all in this runtime. */
export function vmFallbackAllowed(env: Env = process.env): boolean {
  if (truthy(env.SANDBOX_ALLOW_VM)) return true;       // explicit break-glass
  if (truthy(env.SANDBOX_REQUIRE_DOCKER)) return false; // explicit hard requirement
  return !isProductionRuntime(env);                     // default: dev only
}

/** Feature kill-switch: code execution is on unless explicitly disabled. */
export function sandboxFeatureEnabled(env: Env = process.env): boolean {
  return !falsy(env.SANDBOX_ENABLED);
}

const NO_DOCKER_REASON =
  'Code execution requires Docker isolation, which is unavailable on this host. ' +
  'The insecure in-process (Node vm) fallback is disabled in production for security. ' +
  'Provision Docker or an external sandbox service to enable this feature.';

const DISABLED_REASON = 'Code execution is disabled on this server (SANDBOX_ENABLED=0).';

/**
 * Decide which engine to use for a sandbox request.
 * @param dockerRequested  caller explicitly asked for Docker
 * @param dockerAvailable  result of isDockerAvailable()
 */
export function resolveSandboxEngine(
  args: { dockerRequested: boolean; dockerAvailable: boolean },
  env: Env = process.env,
): SandboxDecision {
  if (!sandboxFeatureEnabled(env)) return { engine: 'none', reason: DISABLED_REASON };

  const allowVm = vmFallbackAllowed(env);

  // Prefer Docker whenever it's available and either requested or vm isn't allowed.
  if (args.dockerAvailable && (args.dockerRequested || !allowVm)) {
    return { engine: 'docker' };
  }
  // vm only when permitted (non-production / break-glass).
  if (allowVm) return { engine: 'vm' };

  // Production without Docker → fail closed.
  return { engine: 'none', reason: NO_DOCKER_REASON };
}
