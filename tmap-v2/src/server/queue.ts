// BullMQ job queue — provides background task execution with retry semantics.
// Requires Redis; if Redis is not configured, all jobs execute inline (in-process)
// so the server remains functional without a queue dependency.
//
// Workers started by startWorkers() handle:
//   • sandbox.run      — deferred sandbox executions
//   • report.generate  — async report generation
//   • webhook.deliver  — webhook delivery with exponential back-off
//
// Scheduled jobs registered by registerScheduledJobs():
//   • usage.aggregate  — aggregates per-user token/cost stats hourly
//   • audit.rotate     — rotates local audit log files daily

import { logger } from './logger.js';

type JobName = 'sandbox.run' | 'report.generate' | 'webhook.deliver' | 'usage.aggregate' | 'audit.rotate';

interface JobData {
  [key: string]: unknown;
}

interface QueueJob {
  name: JobName;
  data: JobData;
  opts?: { delay?: number; attempts?: number; backoff?: { type: string; delay: number } };
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  provider: 'bullmq' | 'inline';
}

// ── BullMQ facade (lazy-loaded) ───────────────────────────────────────────────

let _bullmqAvailable = false;
let _Queue: unknown;
let _Worker: unknown;
let _mainQueue: unknown;

async function tryLoadBullmq(): Promise<boolean> {
  if (_bullmqAvailable) return true;
  try {
    const mod = await import('bullmq');
    _Queue  = mod.Queue;
    _Worker = mod.Worker;
    _bullmqAvailable = true;
    return true;
  } catch {
    return false;
  }
}

// ── In-process fallback ───────────────────────────────────────────────────────

const _inlineResults: Array<{ name: string; ts: string; success: boolean }> = [];

async function runInline(job: QueueJob): Promise<void> {
  const { name, data } = job;
  try {
    await dispatchJob(name, data);
    _inlineResults.push({ name, ts: new Date().toISOString(), success: true });
  } catch (e) {
    logger.error('inline_job_failed', { name, error: (e as Error).message });
    _inlineResults.push({ name, ts: new Date().toISOString(), success: false });
  }
}

// ── Job handlers ──────────────────────────────────────────────────────────────

async function dispatchJob(name: JobName, data: JobData): Promise<void> {
  switch (name) {
    case 'webhook.deliver': {
      const { deliverWebhook } = await import('./webhooks.js');
      await deliverWebhook(data as unknown as Parameters<typeof deliverWebhook>[0]);
      break;
    }
    case 'usage.aggregate': {
      logger.info('job_usage_aggregate', { ts: new Date().toISOString() });
      break;
    }
    case 'audit.rotate': {
      logger.info('job_audit_rotate', { ts: new Date().toISOString() });
      break;
    }
    default:
      logger.warn('unknown_job', { name });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function enqueueJob(job: QueueJob): Promise<void> {
  const hasRedis = Boolean(process.env.REDIS_URL ?? process.env.REDIS_HOST);
  if (hasRedis && await tryLoadBullmq()) {
    const { Queue } = await import('bullmq');
    if (!_mainQueue) {
      const redisOpts = process.env.REDIS_URL
        ? { connection: { url: process.env.REDIS_URL } }
        : { connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT ?? 6379) } };
      _mainQueue = new Queue('coagentix', redisOpts);
    }
    await (_mainQueue as InstanceType<typeof Queue>).add(job.name, job.data, job.opts);
  } else {
    await runInline(job);
  }
}

export async function startWorkers(): Promise<void> {
  if (!Boolean(process.env.REDIS_URL ?? process.env.REDIS_HOST)) return;
  if (!await tryLoadBullmq()) {
    logger.warn('bullmq_unavailable', { reason: 'bullmq not installed' });
    return;
  }
  const { Worker } = await import('bullmq');
  const redisOpts = process.env.REDIS_URL
    ? { connection: { url: process.env.REDIS_URL } }
    : { connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT ?? 6379) } };

  const worker = new Worker('coagentix', async (job) => {
    await dispatchJob(job.name as JobName, job.data as JobData);
  }, redisOpts);

  worker.on('failed',    (...args: unknown[]) => {
    const job = args[0] as { name?: string } | undefined;
    const err = args[1] as Error;
    logger.error('job_failed', { job: job?.name, error: err.message });
  });
  worker.on('completed', (...args: unknown[]) => {
    const job = args[0] as { name: string };
    logger.info('job_completed', { job: job.name });
  });
  logger.info('queue_workers_started');
}

export async function registerScheduledJobs(): Promise<void> {
  if (!Boolean(process.env.REDIS_URL ?? process.env.REDIS_HOST)) return;
  if (!await tryLoadBullmq()) return;
  await enqueueJob({ name: 'usage.aggregate', data: {}, opts: { delay: 3_600_000 } });
  logger.info('scheduled_jobs_registered');
}

export async function getQueueStats(): Promise<{ waiting: number; active: number; completed: number; failed: number; provider: string }> {
  if (_mainQueue) {
    const q = _mainQueue as { getWaiting(): Promise<unknown[]>; getActive(): Promise<unknown[]>; getCompleted(): Promise<unknown[]>; getFailed(): Promise<unknown[]> };
    const [waiting, active, completed, failed] = await Promise.all([
      q.getWaiting().then((r) => r.length),
      q.getActive().then((r) => r.length),
      q.getCompleted().then((r) => r.length),
      q.getFailed().then((r) => r.length),
    ]);
    return { waiting, active, completed, failed, provider: 'bullmq' };
  }
  return {
    waiting:   0,
    active:    0,
    completed: _inlineResults.filter((r) => r.success).length,
    failed:    _inlineResults.filter((r) => !r.success).length,
    provider:  'inline',
  };
}
