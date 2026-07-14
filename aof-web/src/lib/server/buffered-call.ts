// ── Buffered provider call — Co.AI Master Prompt Part 5.3 ─────────────────────
// A deliberately NARROW reintroduction of the "drain a generator to text"
// capability deleted with workflow-runner.ts in commit dd546a8 (the change
// that established Kanon's one-provider-call invariant). This resurrects only
// what Ypertatos's Requirement Analysis stage actually needs — draining one
// generator to completion plus a deadline race and the SAME failover policy
// route.ts's streamed loop already uses — and NONE of the generalized
// multi-call machinery the old file had (no stages[], no priorOutputs, no
// per-stage buildSystem(), no loop over an arbitrary stage list).
//
// Deliberately NOT re-exported from ai-providers.ts: that module's public
// surface stays byte-identical, so Kanon and Mikros import nothing new and
// cannot regress. This file is imported from exactly one place — the
// Ypertatos engineering branch in route.ts, guarded by `raaIdx >= 0`
// (see model-workflow.ts's `execution: "buffered"`).

import {
  adapterFor,
  isAbort,
  toAofError,
  type AdapterInput,
  type KeyOverrides,
  type ProviderId,
  type ProviderMeta,
} from "./ai-providers";
import {
  newRequestId,
  classifyProviderError,
  ERROR_CATALOG,
  type AofProviderError,
  type UsageNotice,
} from "@/lib/errors";

export interface BufferedCallOk {
  ok: true;
  text: string;
  usage?: UsageNotice; // real — the adapter's own return value, never invented
  provider: ProviderMeta; // whichever provider actually answered
  model: string;
  executionId: string;
  attempts: number; // providers actually tried — real, counted
  durationMs: number;
}
export interface BufferedCallFail {
  ok: false;
  error: AofProviderError;
  aborted: boolean; // user pressed Stop
  attempts: number;
  durationMs: number;
}

const DEFAULT_DEADLINE_MS = 20_000;

async function drainToText(
  gen: AsyncGenerator<string, UsageNotice | undefined>,
): Promise<{ text: string; usage?: UsageNotice }> {
  let text = "";
  for (;;) {
    const next = await gen.next();
    if (next.done) return { text, usage: next.value };
    text += next.value;
  }
}

function raceWithDeadline<T>(promise: Promise<T>, deadlineMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      reject(new ProviderTimeoutError(`Buffered call exceeded its ${deadlineMs}ms deadline`));
    }, deadlineMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((v) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(e);
      });
  });
}

class ProviderTimeoutError extends Error {
  status = 504;
  constructor(message: string) {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

/** Run ONE non-streamed provider call to completion and return its text. Own
 *  failover loop over `providers`, continuing only when the classified error
 *  is `failoverWorthy` — identical policy to route.ts's streamed loop. NEVER
 *  throws — returns a failure object so the caller can degrade instead of
 *  terminating the workflow (Master Prompt 5.3: "never terminate the
 *  workflow unexpectedly"). Never touches primeAndStream and never yields —
 *  it is a plain Promise, not a generator, so it adds zero new yield sites
 *  for phaseStream's "never yield before the first real chunk" invariant. */
export async function runBufferedCall(opts: {
  providers: ProviderMeta[];
  system: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
  overrides?: KeyOverrides;
  taskModelFor?: (p: ProviderMeta) => string | undefined;
  deadlineMs?: number;
  /** test seam — defaults to the real adapterFor() */
  adapterLookup?: (id: ProviderId) => (input: AdapterInput) => AsyncGenerator<string, UsageNotice | undefined>;
}): Promise<BufferedCallOk | BufferedCallFail> {
  const start = performance.now();
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const lookup = opts.adapterLookup ?? adapterFor;
  let attempts = 0;
  let lastError: AofProviderError | undefined;

  for (const provider of opts.providers) {
    attempts += 1;
    const model = opts.taskModelFor?.(provider) ?? provider.defaultModel;
    const requestId = newRequestId();
    const input: AdapterInput = {
      system: opts.system,
      history: opts.history,
      message: opts.message,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      signal: opts.signal,
      overrides: opts.overrides,
      taskModel: model,
    };

    try {
      const gen = lookup(provider.id)(input);
      const { text, usage } = await raceWithDeadline(drainToText(gen), deadlineMs, opts.signal);
      return {
        ok: true,
        text,
        usage,
        provider,
        model,
        executionId: requestId,
        attempts,
        durationMs: Math.round((performance.now() - start) * 1000) / 1000,
      };
    } catch (thrown) {
      const durationMs = Math.round((performance.now() - start) * 1000) / 1000;
      if (isAbort(thrown)) {
        return {
          ok: false,
          error: classifyProviderError({ provider: provider.label, model, requestId, hint: undefined, message: "Aborted" }),
          aborted: true,
          attempts,
          durationMs,
        };
      }
      const error = toAofError({ provider, model, requestId }, thrown);
      lastError = error;
      if (ERROR_CATALOG[error.code].failoverWorthy) continue;
      break;
    }
  }

  return {
    ok: false,
    error:
      lastError ??
      classifyProviderError({
        provider: "Co.AI",
        message: "No provider was configured for the buffered Requirement Analysis call.",
        hint: "config",
      }),
    aborted: false,
    attempts,
    durationMs: Math.round((performance.now() - start) * 1000) / 1000,
  };
}
