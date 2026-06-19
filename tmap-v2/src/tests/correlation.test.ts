// Tests for the AsyncLocalStorage-based correlation ID system
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Correlation context', () => {
  test('getContext returns undefined outside of runWithContext', async () => {
    const { getContext } = await import('../server/correlation.js');
    assert.equal(getContext(), undefined);
  });

  test('runWithContext makes context available inside fn', async () => {
    const { runWithContext, getContext } = await import('../server/correlation.js');
    let captured: ReturnType<typeof getContext>;
    runWithContext(
      { correlationId: 'corr-123', requestId: 'req-456', path: '/test', method: 'GET' },
      () => { captured = getContext(); }
    );
    assert.equal(captured!.correlationId, 'corr-123');
    assert.equal(captured!.requestId,     'req-456');
  });

  test('context is isolated between separate runWithContext calls', async () => {
    const { runWithContext, getContext } = await import('../server/correlation.js');
    let ctxA: ReturnType<typeof getContext>;
    let ctxB: ReturnType<typeof getContext>;

    runWithContext({ correlationId: 'A', requestId: 'rA' }, () => { ctxA = getContext(); });
    runWithContext({ correlationId: 'B', requestId: 'rB' }, () => { ctxB = getContext(); });

    assert.equal(ctxA!.correlationId, 'A');
    assert.equal(ctxB!.correlationId, 'B');
  });

  test('patchContext mutates the current store', async () => {
    const { runWithContext, getContext, patchContext } = await import('../server/correlation.js');
    let ctx: ReturnType<typeof getContext>;
    runWithContext({ correlationId: 'orig', requestId: 'r1' }, () => {
      patchContext({ userId: 'user-xyz' });
      ctx = getContext();
    });
    assert.equal(ctx!.userId, 'user-xyz');
    assert.equal(ctx!.correlationId, 'orig'); // unchanged
  });

  test('getCorrelationId returns id from store', async () => {
    const { runWithContext, getCorrelationId } = await import('../server/correlation.js');
    let id: string | undefined;
    runWithContext({ correlationId: 'my-corr', requestId: 'r2' }, () => {
      id = getCorrelationId();
    });
    assert.equal(id, 'my-corr');
  });

  test('correlationMiddleware is a function returning an Express handler', async () => {
    const { correlationMiddleware } = await import('../server/correlation.js');
    const mw = correlationMiddleware();
    assert.equal(typeof mw, 'function');
    assert.equal(mw.length, 3);
  });
});
