// BullMQ worker: delivers real-time notifications via Redis pub/sub
import type { Job } from 'bullmq';
import { publish } from '../redis.js';

interface NotificationJobData {
  userId:  string;
  channel: string;
  payload: Record<string, unknown>;
}

export async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  const { channel, payload } = job.data;
  await publish(channel, { ...payload, _jobId: job.id, _ts: Date.now() });
}
