// ── Phase stream — splits one provider generation into Model Workflow phases ──
// Co.AI Master Prompt Part 4: Kanon makes exactly one provider call per turn.
// Processing/Deep Think/Review still need to be real, separately-observable
// stages, so the model is asked (buildWorkflowSystem(), model-workflow.ts) to
// emit each phase behind a line-anchored marker (PHASE_MARKER) inside its one
// reply. This module sits between the raw adapter generator and
// primeAndStream(), parsing those markers out of the stream: everything before
// the final marker is suppressed (buffered, never yielded, only logged);
// everything from the final marker onward streams to the user exactly as the
// unmodified final stage always did. primeAndStream, the failover loop,
// decodeFrames and every client store are untouched by this module.
//
// The one rule that must never be broken: this generator must not yield
// anything before the wrapped generator's first non-empty chunk. primeAndStream
// commits the HTTP 200 on the first truthy yield — yielding a stage frame (or
// anything else) before the provider has actually produced content would
// commit a response to a request that hasn't even reached the provider yet,
// silently destroying the failover chain for every provider failure that
// happens before the first token (missing key, bad model, 401, ...).

import { isAbort } from "./ai-providers";
import {
  emptyResponseError,
  encodeErrorFrame,
  encodeStageFrame,
  makeStageNotice,
  type UsageNotice,
} from "@/lib/errors";
import { PHASE_MARKER, type WorkflowStage, type WorkflowStageSpec } from "./model-workflow";

export interface PhaseRecord {
  stage: WorkflowStage;
  label: string;
  /** Whether the model actually emitted this phase's marker. */
  executed: boolean;
  chars: number;
  durationMs: number;
}

export interface PhaseSummary {
  phases: PhaseRecord[];
  usage?: UsageNotice;
  /** Set when the model never emitted the final marker and phaseStream had to
   *  flush the best available partial content instead. */
  fallback?: "no-final-marker";
  /** Characters actually streamed to the user (post-FINAL, or the fallback flush). */
  outputChars: number;
  aborted: boolean;
}

export interface PhaseStreamOpts {
  /** Provider-facing (non-local) stages only, in order, final last. */
  phases: WorkflowStageSpec[];
  /** 1-based index of phases[0] within the FULL stage list (local stages, if
   *  any, occupy the indices before this). */
  stageOffset: number;
  totalStages: number;
  errorCtx: { providerLabel: string; model: string; requestId: string };
  onComplete: (summary: PhaseSummary) => void;
}

interface MarkerHit {
  idx: number;
  len: number;
  phaseIdx: number;
}

/** Wraps a raw provider generator, splitting it into Model Workflow phases.
 *  Never yields before `gen`'s first non-empty chunk (see module header). */
export async function* phaseStream(
  gen: AsyncGenerator<string, UsageNotice | undefined>,
  opts: PhaseStreamOpts,
): AsyncGenerator<string, UsageNotice | undefined> {
  const { phases, stageOffset, totalStages, errorCtx, onComplete } = opts;
  const markers = phases.map((p) => PHASE_MARKER[p.stage] ?? "");
  const finalIdx = phases.length - 1;

  const phaseBuf: string[] = phases.map(() => "");
  const phaseStart: number[] = phases.map(() => 0);
  const phaseEnd: number[] = phases.map(() => 0);
  const phaseExecuted: boolean[] = phases.map(() => false);
  let preambleBuf = "";

  // -1 = preamble (before any marker); else index into `phases` currently
  // accumulating text. Search range for the next marker is always
  // [stageCursor + 1, finalIdx] — not just the immediate next one — so a model
  // that jumps straight to FINAL (skipping an intermediate phase) still
  // transitions correctly instead of falling into the no-marker fallback.
  let stageCursor = -1;
  let acc = "";
  let atLineStart = true; // does position 0 of `acc` sit at the start of a line?
  let streaming = false;
  let emitted = false;
  let outputChars = 0;
  let usage: UsageNotice | undefined;
  let aborted = false;
  let endedNormally = false;
  const t0 = Date.now();

  function findNextMarker(buf: string): MarkerHit | null {
    let best: MarkerHit | null = null;
    for (let p = stageCursor + 1; p <= finalIdx; p++) {
      const marker = markers[p];
      if (!marker) continue;
      let from = 0;
      for (;;) {
        const idx = buf.indexOf(marker, from);
        if (idx < 0) break;
        const lineStart = idx === 0 ? atLineStart : buf[idx - 1] === "\n";
        if (lineStart) {
          if (!best || idx < best.idx) best = { idx, len: marker.length, phaseIdx: p };
          break;
        }
        from = idx + 1;
      }
    }
    return best;
  }

  /** The longest proper, line-anchored prefix of any remaining marker at the
   *  end of `buf` — held back so a marker split across chunk boundaries is
   *  never leaked to the user (or into a phase buffer) as text. */
  function partialMarkerTail(buf: string): string {
    let best = "";
    for (let p = stageCursor + 1; p <= finalIdx; p++) {
      const marker = markers[p];
      if (!marker) continue;
      const maxLen = Math.min(marker.length - 1, buf.length);
      for (let len = maxLen; len > best.length; len--) {
        const startPos = buf.length - len;
        const lineStart = startPos === 0 ? atLineStart : buf[startPos - 1] === "\n";
        if (lineStart && marker.startsWith(buf.slice(startPos))) {
          best = buf.slice(startPos);
          break;
        }
      }
    }
    return best;
  }

  function appendToCurrent(text: string): void {
    if (!text) return;
    if (stageCursor === -1) preambleBuf += text;
    else phaseBuf[stageCursor] += text;
  }

  try {
    outer: for (;;) {
      const next = await gen.next();
      if (next.done) {
        usage = next.value;
        break;
      }
      const chunk = next.value;
      if (!chunk) continue; // empty-but-not-done frame — never counts as "the first chunk"

      if (!emitted) {
        emitted = true;
        // Early UI signal only — authoritative phaseStart/phaseExecuted for
        // whichever phase actually begins is set exclusively by the
        // marker-crossing logic below, once a real marker is confirmed.
        yield encodeStageFrame(makeStageNotice(phases[0].stage, phases[0].label, stageOffset, totalStages, "running"));
      }

      if (streaming) {
        outputChars += chunk.length;
        yield chunk;
        continue;
      }

      acc += chunk;

      for (;;) {
        const hit = findNextMarker(acc);
        if (!hit) {
          const tail = partialMarkerTail(acc);
          const resolved = acc.slice(0, acc.length - tail.length);
          appendToCurrent(resolved);
          if (resolved) atLineStart = resolved.endsWith("\n");
          acc = tail;
          continue outer;
        }

        appendToCurrent(acc.slice(0, hit.idx));
        if (stageCursor >= 0) phaseEnd[stageCursor] = Date.now();
        const closedIdx = stageCursor;
        stageCursor = hit.phaseIdx;
        phaseStart[stageCursor] = Date.now();
        phaseExecuted[stageCursor] = true;

        if (closedIdx >= 0) {
          const closed = phases[closedIdx];
          yield encodeStageFrame(makeStageNotice(closed.stage, closed.label, stageOffset + closedIdx, totalStages, "done"));
        }
        // phases[0]'s "running" frame was already announced the moment the
        // provider's first chunk arrived (below, `if (!emitted)`) — re-emitting
        // it here on the preamble→phases[0] transition (the common case: the
        // model's very first chunk IS its opening marker) would duplicate it.
        // Every other transition (later phases, or a skip-ahead straight from
        // preamble into a later phase) still needs its own "running" frame.
        const alreadyAnnounced = closedIdx === -1 && stageCursor === 0;
        if (!alreadyAnnounced) {
          const opened = phases[stageCursor];
          yield encodeStageFrame(makeStageNotice(opened.stage, opened.label, stageOffset + stageCursor, totalStages, "running"));
        }

        acc = acc.slice(hit.idx + hit.len);
        atLineStart = true;
        if (acc.startsWith("\r\n")) acc = acc.slice(2);
        else if (acc.startsWith("\n")) acc = acc.slice(1);

        if (stageCursor === finalIdx) {
          streaming = true;
          if (acc) {
            outputChars += acc.length;
            yield acc;
          }
          acc = "";
          continue outer;
        }
      }
    }
    endedNormally = true;
  } catch (thrown) {
    aborted = isAbort(thrown);
    throw thrown;
  } finally {
    if (endedNormally && !streaming) {
      appendToCurrent(acc);
      acc = "";
      if (stageCursor >= 0) phaseEnd[stageCursor] = Date.now();

      if (emitted) {
        yield encodeStageFrame(
          makeStageNotice(phases[finalIdx].stage, phases[finalIdx].label, stageOffset + finalIdx, totalStages, "running"),
        );
        const candidates = [...phaseBuf.slice(0, finalIdx)].reverse().concat([preambleBuf]);
        const fallback = candidates.find((b) => b.trim().length > 0) ?? "";
        if (fallback) {
          outputChars += fallback.length;
          yield fallback;
        } else {
          yield encodeErrorFrame(emptyResponseError(errorCtx.providerLabel, errorCtx.model, errorCtx.requestId));
        }
      }
    }

    if (emitted) {
      const now = Date.now();
      const records: PhaseRecord[] = phases.map((p, i) => ({
        stage: p.stage,
        label: p.label,
        executed: phaseExecuted[i],
        chars: phaseBuf[i].length,
        durationMs: phaseExecuted[i] ? Math.max(0, (phaseEnd[i] || now) - phaseStart[i]) : 0,
      }));
      onComplete({
        phases: records,
        usage,
        fallback: endedNormally && !streaming ? "no-final-marker" : undefined,
        outputChars,
        aborted,
      });
    }
  }

  return usage;
}
