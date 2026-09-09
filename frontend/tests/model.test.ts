import { it, expect, vi } from 'vitest';
import { requestDecision, makeRecord, account, budgetReason } from '../src/runtime/model';
import { createWorld } from '../src/sim/world';
const response = (content: string) =>
  new Response(
    JSON.stringify({
      content,
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'test',
      elapsedMs: 5,
    }),
    { status: 200 },
  );
it('repairs invalid JSON once and saves all attempts', async () => {
  const w = createWorld({ population: 1 }),
    r = makeRecord(w),
    save = vi.fn(async () => {});
  let i = 0;
  const fetcher = vi.fn(async () =>
    response(i++ ? ' {"intent":"等候","action":{"type":"wait"}}' : 'bad'),
  ) as any;
  const result = await requestDecision(r, save, '', fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.decision?.action.type).toBe('wait');
  expect(result.status).toBe('received');
  expect(result.attempts[0].error).toContain('格式');
  account(w, result);
  expect(w.usage.calls).toBe(2);
  expect(w.usage.inputTokens).toBe(20);
});
it('does not request again when a received response was persisted', async () => {
  const w = createWorld({ population: 1 }),
    r = makeRecord(w);
  r.status = 'received';
  r.decision = { intent: '', action: { type: 'wait' } };
  const fetcher = vi.fn();
  await requestDecision(r, async () => {}, '', fetcher);
  expect(fetcher).not.toHaveBeenCalled();
});
it('repairs mixed reproduction negotiation fields before spending an action', async () => {
  const w = createWorld({ population: 2 });
  const r = makeRecord(w);
  const accepted = { type: 'chat', text: '我接受', acceptProposalId: 'p-123' };
  let requests = 0;
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
    if (requests++) {
      expect(JSON.parse(init.body as string).repair).toContain('只能填写一个');
      return response(JSON.stringify({ action: accepted }));
    }
    return response(
      JSON.stringify({
        action: {
          ...accepted,
          proposal: { kind: 'reproduce', targetId: 2 },
        },
      }),
    );
  }) as any;
  const result = await requestDecision(r, async () => {}, '', fetcher);
  expect(result.decision?.action).toEqual(accepted);
  expect(result.attempts).toHaveLength(2);
  expect(w.agents[0].ap).toBe(5);
  expect(w.seq).toBe(0);
});
it('pauses immediately on authentication failure', async () => {
  const r = makeRecord(createWorld({ population: 1 }));
  const fetcher = vi.fn(async () => new Response('{}', { status: 401 })) as any;
  await requestDecision(r, async () => {}, '', fetcher);
  expect(r.fatal).toContain('401');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('bounds repeated malformed output and consecutive technical failures', async () => {
  const w = createWorld({ population: 1 });
  const r = makeRecord(w);
  const fetcher = vi.fn(async () => response('{}')) as any;
  await requestDecision(r, async () => {}, '', fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(r.decision?.action.type).toBe('wait');
  w.usage.consecutiveErrors = 5;
  expect(budgetReason(w, 0)).toContain('连续');
});

it('retries rate limits and server errors with a finite budget', async () => {
  vi.useFakeTimers();
  try {
    const r = makeRecord(createWorld({ population: 1 }));
    let calls = 0;
    const fetcher = vi.fn(async () =>
      ++calls === 1
        ? new Response('{}', { status: 429 })
        : calls === 2
          ? new Response('{}', { status: 502 })
          : response('{"action":{"type":"wait"}}'),
    ) as any;
    const promise = requestDecision(r, async () => {}, '', fetcher);
    await vi.runAllTimersAsync();
    await promise;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(r.technicalFailure).toBeUndefined();
    expect(r.decision?.action.type).toBe('wait');
  } finally {
    vi.useRealTimers();
  }
});
it('exhausted timeouts produce one wait without an infinite retry loop', async () => {
  vi.useFakeTimers();
  try {
    const r = makeRecord(createWorld({ population: 1 }));
    const fetcher = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    }) as any;
    const promise = requestDecision(r, async () => {}, '', fetcher);
    await vi.runAllTimersAsync();
    await promise;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(r.technicalFailure).toBe(true);
    expect(r.decision?.action.type).toBe('wait');
  } finally {
    vi.useRealTimers();
  }
});
