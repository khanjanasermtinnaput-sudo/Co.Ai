// Ambient type stubs for optional runtime dependencies.
// These packages are listed in optionalDependencies and loaded lazily with
// try/catch — so they may not be installed. These stubs satisfy the TypeScript
// compiler without requiring the actual packages.

declare module 'prom-client' {
  export function collectDefaultMetrics(opts?: { prefix?: string }): void;
  export const register: { metrics(): Promise<string>; contentType: string };
  export class Histogram {
    constructor(opts: { name: string; help: string; labelNames?: string[]; buckets?: number[] });
    observe(labels: Record<string, string>, value: number): void;
    startTimer(labels?: Record<string, string>): (labels?: Record<string, string>) => void;
  }
  export class Gauge {
    constructor(opts: { name: string; help: string; labelNames?: string[] });
    set(value: number): void;
    inc(): void;
    dec(): void;
  }
  export class Counter {
    constructor(opts: { name: string; help: string; labelNames?: string[] });
    inc(labels?: Record<string, string>): void;
  }
}

declare module '@sentry/node' {
  export function init(opts: { dsn: string; tracesSampleRate?: number }): void;
  export function captureException(err: unknown): void;
  export function addBreadcrumb(crumb: { message: string; data?: Record<string, unknown>; level?: string }): void;
  export function expressErrorHandler(): (...args: unknown[]) => void;
}

declare module 'bullmq' {
  export class Queue {
    constructor(name: string, opts?: Record<string, unknown>);
    add(name: string, data: unknown, opts?: unknown): Promise<unknown>;
    getWaiting(): Promise<unknown[]>;
    getActive(): Promise<unknown[]>;
    getCompleted(): Promise<unknown[]>;
    getFailed(): Promise<unknown[]>;
  }
  export class Worker {
    constructor(
      name: string,
      processor: (job: { name: string; data: unknown }) => Promise<void>,
      opts?: Record<string, unknown>,
    );
    on(event: string, handler: (...args: unknown[]) => void): this;
  }
}
