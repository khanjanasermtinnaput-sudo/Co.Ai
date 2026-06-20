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
    const credBag = {
      openrouter: creds.openrouter,
      gemini:     creds.gemini,
      deepseek:   creds.deepseek,
      qwen:       creds.qwen,
      llama:      creds.llama,
    };

    await job.updateProgress(10);
    await publish(PubSubChannels.tmap(sessionId), {
      event: 'resolving',
      providers: Object.keys(credBag).filter((k) => !!credBag[k as keyof typeof credBag]),
    });

    // Delegate to the TMAP orchestrator
    const { createBlackboard } = await import('../../core/blackboard.js');
    const { runTMAP } = await import('../../core/orchestrator.js');

    const bb = createBlackboard(task, mode as import('../../types.js').Mode);
    bb.sessionId = sessionId;

    const result = await runTMAP(
      bb,
      (role, text, kind = 'status') => {
        void publish(PubSubChannels.tmap(sessionId), { event: 'progress', role, text, kind });
      },
      { creds: credBag },
    );

    await job.updateProgress(97);

    // Persist result to session record
    const { updateSession } = await import('../db.js');
    await updateSession(sessionId, {
      status:     'done',
      summary:    result.planText?.slice(0, 500) ?? '',
      filesCount: result.files?.length ?? 0,
    });

    await job.updateProgress(100);
    await publish(PubSubChannels.tmap(sessionId), {
      event:   'completed',
      jobId:   job.id,
      summary: result.planText?.slice(0, 200) ?? '',
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
