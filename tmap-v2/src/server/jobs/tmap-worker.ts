// BullMQ worker: runs TMAP pipeline as a background job
// Allows long-running code generation to survive HTTP timeouts.
import type { Job } from 'bullmq';
import { publish, PubSubChannels } from '../redis.js';

interface TmapJobData {
  userId:    string;
  sessionId: string;
  task:      string;
  mode:      string;
  creds:     Record<string, string>;
}

export async function processTmapJob(job: Job<TmapJobData>): Promise<{ sessionId: string }> {
  const { userId, sessionId, task, mode, creds } = job.data;

  await job.updateProgress(5);
  await publish(PubSubChannels.tmap(sessionId), { event: 'started', jobId: job.id });

  try {
    // Resolve providers from credential bag
    const { resolveAllWith } = await import('../../config.js');
    const credBag = {
      openrouter: creds.openrouter,
      gemini:     creds.gemini,
      deepseek:   creds.deepseek,
      qwen:       creds.qwen,
      llama:      creds.llama,
    };
    const providers = resolveAllWith(credBag);

    await job.updateProgress(10);
    await publish(PubSubChannels.tmap(sessionId), { event: 'resolving', providers: Object.keys(providers) });

    // Delegate to the TMAP orchestrator
    const { runTMAP } = await import('../../core/orchestrator.js');

    const result = await runTMAP({
      task,
      mode:      mode as import('../../types.js').Mode,
      providers,
      onProgress: async (pct: number, phase: string) => {
        await job.updateProgress(10 + Math.floor(pct * 0.85));
        await publish(PubSubChannels.tmap(sessionId), { event: 'progress', phase, pct });
      },
    });

    await job.updateProgress(97);

    // Persist result to session record
    const { updateSession } = await import('../db.js');
    await updateSession(sessionId, {
      status:     'done',
      summary:    result.plan?.slice(0, 500) ?? '',
      filesCount: result.files?.length ?? 0,
    });

    await job.updateProgress(100);
    await publish(PubSubChannels.tmap(sessionId), {
      event:   'completed',
      jobId:   job.id,
      summary: result.plan?.slice(0, 200) ?? '',
    });

    return { sessionId };
  } catch (err) {
    const message = (err as Error).message;
    await publish(PubSubChannels.tmap(sessionId), { event: 'error', message });

    try {
      const { updateSession } = await import('../db.js');
      await updateSession(sessionId, { status: 'error' });
    } catch {
      // non-fatal
    }

    throw err;
  }
}
