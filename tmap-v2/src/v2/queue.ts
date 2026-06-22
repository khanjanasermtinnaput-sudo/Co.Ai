// v2 — run-level concurrency queue (system resource control).
//
// The orchestrator already allocates resources WITHIN a run (parallel slots per
// execution mode). This bounds resources ACROSS runs: a fair FIFO queue caps how
// many v2 orchestrations execute concurrently on one instance, so a burst of
// requests queues instead of stampeding every provider at once (which is the #1
// cause of rate-limit failures). Provider-level load balancing is handled
// separately by DARS (health-scored failover in dars/select.ts).

/** Max concurrent v2 runs per instance. Tunable via env; sane default. */
export function defaultMaxConcurrent(): number {
  const n = Number(process.env.COAGENTIX_V2_MAX_CONCURRENT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
}

/** A fair (FIFO) counting semaphore. `acquire()` resolves with a release fn; a
 *  slot is handed directly to the next waiter on release (no thundering herd). */
export class RunQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number = defaultMaxConcurrent()) {
    if (maxConcurrent < 1) throw new Error('RunQueue maxConcurrent must be >= 1');
  }

  /** Slots currently held (running). */
  get inFlight(): number {
    return this.active;
  }

  /** Callers waiting for a slot. */
  get queued(): number {
    return this.waiters.length;
  }

  get capacity(): number {
    return this.maxConcurrent;
  }

  acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(this.makeRelease()));
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent — double-release must not over-free
      released = true;
      const next = this.waiters.shift();
      if (next) next();      // hand the slot to the next waiter (active unchanged)
      else this.active--;    // free the slot
    };
  }

  /** Run `fn` once a slot is free; always releases, even on throw. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Process-wide queue shared by all v2 runs on this instance. */
export const globalRunQueue = new RunQueue();
