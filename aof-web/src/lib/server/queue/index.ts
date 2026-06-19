// BullMQ queue definitions (producers only — workers run in tmap-v2)
// Next.js (Vercel) API routes enqueue jobs here; tmap-v2 processes them.
import { Queue, type ConnectionOptions } from 'bullmq';

// ── Connection ────────────────────────────────────────────────────────────────

function redisConnection(): ConnectionOptions {
  const url = process.env.REDIS_TLS_URL ?? process.env.REDIS_URL;
  if (url) {
    // BullMQ accepts `url` as a key inside ConnectionOptions
    return Object.assign(
      { url },
      url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}
    ) as ConnectionOptions;
  }
  return {
    host:     process.env.REDIS_HOST     ?? '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
    db:       parseInt(process.env.REDIS_DB   ?? '0',    10),
  };
}

// ── Job payload types ─────────────────────────────────────────────────────────

export interface EmbeddingJobData {
  userId:    string;
  texts:     string[];
  targetTable: 'memories' | 'conversation_turns';
  rowIds:    string[];
}

export interface MemoryConsolidateJobData {
  userId:    string;
  sessionId: string;
  maxMemories?: number;
}

export interface MemoryPruneJobData {
  userId:          string;
  retentionDays?:  number;
  minImportance?:  number;
}

export interface TmapJobData {
  userId:    string;
  sessionId: string;
  task:      string;
  mode:      string;
  creds:     Record<string, string>;
}

export interface NotificationJobData {
  userId:   string;
  channel:  string;
  payload:  Record<string, unknown>;
}

export type AnyJobData =
  | EmbeddingJobData
  | MemoryConsolidateJobData
  | MemoryPruneJobData
  | TmapJobData
  | NotificationJobData;

// ── Queue names ───────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  embeddings:     'cgntx:embeddings',
  memConsol:      'cgntx:memory-consolidate',
  memPrune:       'cgntx:memory-prune',
  tmap:           'cgntx:tmap',
  notifications:  'cgntx:notifications',
  dlq:            'cgntx:dlq',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ── Default job options ───────────────────────────────────────────────────────

const defaultJobOptions = {
  attempts:    3,
  backoff: {
    type:  'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: { count: 500 },
  removeOnFail:     { count: 1000 },
};

// ── Queue singletons ──────────────────────────────────────────────────────────

let _embeddingsQ:    Queue | null = null;
let _memConsolQ:     Queue | null = null;
let _memPruneQ:      Queue | null = null;
let _tmapQ:          Queue | null = null;
let _notificationsQ: Queue | null = null;
let _dlq:            Queue | null = null;

function makeQueue(name: QueueName): Queue {
  return new Queue(name, {
    connection:      redisConnection(),
    defaultJobOptions,
  });
}

export function getEmbeddingsQueue():    Queue { return (_embeddingsQ    ??= makeQueue(QUEUE_NAMES.embeddings));    }
export function getMemConsolQueue():     Queue { return (_memConsolQ     ??= makeQueue(QUEUE_NAMES.memConsol));     }
export function getMemPruneQueue():      Queue { return (_memPruneQ      ??= makeQueue(QUEUE_NAMES.memPrune));      }
export function getTmapQueue():          Queue { return (_tmapQ          ??= makeQueue(QUEUE_NAMES.tmap));          }
export function getNotificationsQueue(): Queue { return (_notificationsQ ??= makeQueue(QUEUE_NAMES.notifications)); }
export function getDLQ():               Queue { return (_dlq             ??= makeQueue(QUEUE_NAMES.dlq));           }

// ── Enqueue helpers ───────────────────────────────────────────────────────────

export async function enqueueEmbedding(data: EmbeddingJobData, priority = 5): Promise<string> {
  const job = await getEmbeddingsQueue().add('embed', data, { priority });
  return job.id!;
}

export async function enqueueConsolidation(
  data: MemoryConsolidateJobData,
  delayMs = 5000
): Promise<string> {
  const job = await getMemConsolQueue().add('consolidate', data, { delay: delayMs });
  return job.id!;
}

export async function enqueuePrune(data: MemoryPruneJobData): Promise<string> {
  const job = await getMemPruneQueue().add('prune', data);
  return job.id!;
}

export async function enqueueTmap(data: TmapJobData): Promise<string> {
  const job = await getTmapQueue().add('tmap', data, { priority: 1 });
  return job.id!;
}

export async function enqueueNotification(data: NotificationJobData): Promise<string> {
  const job = await getNotificationsQueue().add('notify', data, {
    attempts: 1,
    removeOnComplete: { count: 200 },
  });
  return job.id!;
}

export async function enqueueDLQ(
  originalQueue: QueueName,
  originalJobId: string,
  data:          AnyJobData,
  reason:        string
): Promise<string> {
  const job = await getDLQ().add('dead', {
    originalQueue,
    originalJobId,
    data,
    reason,
    failedAt: new Date().toISOString(),
  }, { attempts: 1 });
  return job.id!;
}

// ── Queue stats ───────────────────────────────────────────────────────────────

export interface QueueStats {
  name:      QueueName;
  waiting:   number;
  active:    number;
  completed: number;
  failed:    number;
  delayed:   number;
  paused:    boolean;
}

export async function getQueueStats(queue: Queue): Promise<QueueStats> {
  const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ]);
  return {
    name:      queue.name as QueueName,
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused:    isPaused,
  };
}

export async function getAllQueueStats(): Promise<QueueStats[]> {
  return Promise.all([
    getEmbeddingsQueue(),
    getMemConsolQueue(),
    getMemPruneQueue(),
    getTmapQueue(),
    getNotificationsQueue(),
    getDLQ(),
  ].map(getQueueStats));
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  await Promise.allSettled(
    [_embeddingsQ, _memConsolQ, _memPruneQ, _tmapQ, _notificationsQ, _dlq]
      .filter(Boolean)
      .map((q) => q!.close())
  );
}
