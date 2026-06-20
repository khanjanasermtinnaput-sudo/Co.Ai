// BullMQ queue definitions + worker registration for tmap-v2
// This module starts all workers when the Express server boots.
import 'dotenv/config';
import { Queue, Worker, QueueEvents, type ConnectionOptions, type Job } from 'bullmq';

// ── Connection ────────────────────────────────────────────────────────────────

function redisConn(): ConnectionOptions {
  const url = process.env.REDIS_TLS_URL ?? process.env.REDIS_URL;
  if (url) {
    return Object.assign(
      { url },
      url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}
    ) as ConnectionOptions;
  }
  return {
    host:     process.env.REDIS_HOST     ?? '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
    db:       parseInt(process.env.REDIS_DB   ?? '0', 10),
  };
}

// ── Queue names (must match aof-web/src/lib/server/queue/index.ts) ────────────

export const QUEUE_NAMES = {
  embeddings:    'cgntx:embeddings',
  memConsol:     'cgntx:memory-consolidate',
  memPrune:      'cgntx:memory-prune',
  tmap:          'cgntx:tmap',
  notifications: 'cgntx:notifications',
  dlq:           'cgntx:dlq',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ── Default options ───────────────────────────────────────────────────────────

const DEFAULT_JOB_OPTS = {
  attempts:    3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail:     { count: 1000 },
};

// ── Worker concurrency settings ───────────────────────────────────────────────

const CONCURRENCY = {
  embeddings:    parseInt(process.env.QUEUE_EMBED_CONCURRENCY    ?? '4',  10),
  memConsol:     parseInt(process.env.QUEUE_CONSOL_CONCURRENCY   ?? '2',  10),
  memPrune:      parseInt(process.env.QUEUE_PRUNE_CONCURRENCY    ?? '1',  10),
  tmap:          parseInt(process.env.QUEUE_TMAP_CONCURRENCY     ?? '3',  10),
  notifications: parseInt(process.env.QUEUE_NOTIFY_CONCURRENCY   ?? '5',  10),
};

// ── Workers ───────────────────────────────────────────────────────────────────

let workers: Worker[] = [];
let events:  QueueEvents[] = [];

export function startWorkers(): void {
  if (workers.length) return; // already started

  const embWorker = new Worker(
    QUEUE_NAMES.embeddings,
    async (job: Job) => {
      const { processEmbeddingJob } = await import('./jobs/embedding-worker.js');
      return processEmbeddingJob(job);
    },
    {
      connection:  redisConn(),
      concurrency: CONCURRENCY.embeddings,
    }
  );

  const consolWorker = new Worker(
    QUEUE_NAMES.memConsol,
    async (job: Job) => {
      const { processConsolidationJob } = await import('./jobs/memory-worker.js');
      return processConsolidationJob(job);
    },
    {
      connection:  redisConn(),
      concurrency: CONCURRENCY.memConsol,
    }
  );

  const pruneWorker = new Worker(
    QUEUE_NAMES.memPrune,
    async (job: Job) => {
      const { processPruneJob } = await import('./jobs/memory-worker.js');
      return processPruneJob(job);
    },
    {
      connection:  redisConn(),
      concurrency: CONCURRENCY.memPrune,
    }
  );

  const tmapWorker = new Worker(
    QUEUE_NAMES.tmap,
    async (job: Job) => {
      const { processTmapJob } = await import('./jobs/tmap-worker.js');
      return processTmapJob(job);
    },
    {
      connection:  redisConn(),
      concurrency: CONCURRENCY.tmap,
    }
  );

  const notifyWorker = new Worker(
    QUEUE_NAMES.notifications,
    async (job: Job) => {
      const { processNotificationJob } = await import('./jobs/notification-worker.js');
      return processNotificationJob(job);
    },
    {
      connection:  redisConn(),
      concurrency: CONCURRENCY.notifications,
    }
  );

  for (const w of [embWorker, consolWorker, pruneWorker, tmapWorker, notifyWorker]) {
    w.on('completed', (job: Job) => {
      console.log(`[CGNTX][Queue] ✓ ${job.queueName} job ${job.id} completed`);
    });
    w.on('failed', (job: Job | undefined, err: Error) => {
      console.error(`[CGNTX][Queue] ✗ ${job?.queueName ?? '?'} job ${job?.id ?? '?'} failed:`, err.message);
      // Move to DLQ after exhausting all attempts
      if (job && (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1)) {
        moveToDlq(job, err.message).catch(() => {});
      }
    });
    w.on('error', (err: Error) => {
      console.error(`[CGNTX][Queue] Worker error:`, err.message);
    });
  }

  workers = [embWorker, consolWorker, pruneWorker, tmapWorker, notifyWorker];
  console.log('[CGNTX][Queue] All workers started');
}

async function moveToDlq(job: Job, reason: string): Promise<void> {
  const dlqQ = new Queue(QUEUE_NAMES.dlq, {
    connection:      redisConn(),
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
  try {
    await dlqQ.add('dead', {
      originalQueue: job.queueName,
      originalJobId: job.id,
      data:          job.data,
      reason,
      failedAt:      new Date().toISOString(),
    }, { attempts: 1, removeOnFail: { count: 5000 } });
  } finally {
    await dlqQ.close();
  }
}

// ── Scheduled jobs (cron) ─────────────────────────────────────────────────────

interface CronJob {
  name:    string;
  queue:   QueueName;
  pattern: string;
  data:    Record<string, unknown>;
}

const CRON_JOBS: CronJob[] = [
  {
    name:    'daily-memory-prune',
    queue:   QUEUE_NAMES.memPrune,
    pattern: '0 3 * * *',   // 03:00 UTC every day
    data:    { scheduled: true, retentionDays: 90, minImportance: 0.3 },
  },
  {
    name:    'weekly-dlq-review',
    queue:   QUEUE_NAMES.dlq,
    pattern: '0 4 * * 0',   // 04:00 UTC every Sunday
    data:    { scheduled: true, action: 'review' },
  },
  {
    name:    'hourly-embedding-flush',
    queue:   QUEUE_NAMES.embeddings,
    pattern: '0 * * * *',   // every hour
    data:    { scheduled: true, action: 'flush-pending' },
  },
];

export async function registerScheduledJobs(): Promise<void> {
  for (const cron of CRON_JOBS) {
    const q = new Queue(cron.queue, {
      connection:      redisConn(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
    await q.upsertJobScheduler(cron.name, { pattern: cron.pattern }, {
      name: cron.name,
      data: cron.data,
      opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
    });
    await q.close();
  }
  console.log(`[CGNTX][Queue] Registered ${CRON_JOBS.length} scheduled jobs`);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export async function shutdownWorkers(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(events.map((e) => e.close()));
  workers = [];
  events  = [];
  console.log('[CGNTX][Queue] Workers shut down');
}

// ── Enqueue helpers (used internally by tmap-v2 Express routes) ──────────────

export function makeQueue(name: QueueName): Queue {
  return new Queue(name, {
    connection:        redisConn(),
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
}
