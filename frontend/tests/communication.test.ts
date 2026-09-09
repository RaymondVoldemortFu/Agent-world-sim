import { it, expect } from 'vitest';
import { ActionSchema } from '../src/sim/types';
import { createWorld, hashWorld } from '../src/sim/world';
import { act, applyEvent, endDay, nextTask, observe } from '../src/sim/engine';
import { nextBatch } from '../src/sim/scheduler';

it('rejects mixed proposal operations during format validation so the model can repair them', () => {
  const mixed = ActionSchema.safeParse({
    type: 'chat',
    text: '我接受',
    proposal: { kind: 'reproduce', targetId: 2 },
    acceptProposalId: 'p-123',
  });
  expect(mixed.success).toBe(false);
  expect(
    ActionSchema.safeParse({ type: 'chat', text: '我接受', acceptProposalId: 'p-123' }).success,
  ).toBe(true);
});

it('automatically refreshes local perception without spending AP or generating events', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  a.x = a.y = 3;
  b.x = 5;
  b.y = 3;
  const before = hashWorld(w);
  expect(observe(w, a).people).toHaveLength(0);
  expect(observe(w, a).tiles).toHaveLength(9);
  expect(hashWorld(w)).toBe(before);
  act(w, a.id, { intent: '', action: { type: 'move', dx: 1, dy: 0 } }, 'move');
  expect(observe(w, a).people.map((p) => p.id)).toEqual([b.id]);
  expect(observe(w, a).people[0]).toMatchObject({ sex: b.sex, ageStage: 'adult' });
  expect(a.ap).toBe(4);
  expect(w.seq).toBe(1);
  expect(ActionSchema.safeParse({ type: 'look' }).success).toBe(false);
});

it.each(['F', 'M'] as const)(
  'rejects same-sex %s proposals while allowing ordinary chat',
  (sex) => {
    const w = createWorld({ population: 2 });
    const [a, b] = w.agents;
    b.x = a.x;
    b.y = a.y;
    a.sex = b.sex = sex;
    const failed = act(
      w,
      a.id,
      {
        intent: '',
        action: {
          type: 'chat',
          text: '一起繁衍',
          proposal: { kind: 'reproduce', targetId: b.id },
        },
      },
      'same-sex',
    );
    expect(failed.success).toBe(false);
    expect(failed.text).toContain('双方必须为异性');
    expect(w.proposals).toHaveLength(0);
    expect(b.inbox).toHaveLength(0);
    expect(w.counters.chats).toBe(0);
    expect(
      act(
        w,
        a.id,
        {
          intent: '',
          action: {
            type: 'chat',
            targetId: b.id,
            text: '一起采集',
          },
        },
        'ordinary-chat',
      ).success,
    ).toBe(true);
    expect(w.counters.chats).toBe(1);
  },
);

it('allows adult opposite-sex negotiation and rejects invalid legacy proposals before acceptance', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  b.x = a.x;
  b.y = a.y;
  a.sex = 'F';
  b.sex = 'M';
  expect(
    act(
      w,
      a.id,
      {
        intent: '',
        action: {
          type: 'chat',
          text: '一起繁衍',
          proposal: { kind: 'reproduce', targetId: b.id },
        },
      },
      'proposal',
    ).success,
  ).toBe(true);
  const p = w.proposals[0];
  const accept = () =>
    act(
      w,
      b.id,
      {
        intent: '',
        action: {
          type: 'chat',
          text: '同意',
          acceptProposalId: p.id,
        },
      },
      `accept-${w.seq}`,
    );
  b.sex = 'F';
  expect(accept().success).toBe(false);
  expect(p.accepted).toBe(false);
  b.sex = 'M';
  b.age = 0;
  expect(accept().success).toBe(false);
  expect(p.accepted).toBe(false);
  b.age = w.config.adultAge;
  expect(accept().success).toBe(true);
  expect(p.accepted).toBe(true);
});

it('guides duplicate offers into one accepted proposal and completes mating within daily AP', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  b.x = a.x;
  b.y = a.y;
  a.sex = 'F';
  b.sex = 'M';
  a.hunger = b.hunger = 100;
  const replay = structuredClone(w);
  const offer = (actorId: number, targetId: number) => {
    const e = act(
      w,
      actorId,
      {
        intent: '',
        action: {
          type: 'chat',
          text: '一起繁衍',
          proposal: { kind: 'reproduce', targetId },
        },
      },
      `offer-${w.seq}`,
    );
    applyEvent(replay, e);
    return e;
  };
  expect(offer(a.id, b.id).success).toBe(true);
  const p = w.proposals[0];
  expect(offer(a.id, b.id).text).toContain('等待对方');
  expect(offer(b.id, a.id).text).toContain(`acceptProposalId:"${p.id}"`);
  expect(w.proposals).toHaveLength(1);
  const saidYes = act(
    w,
    b.id,
    {
      intent: '',
      action: {
        type: 'chat',
        text: '我接受',
        targetId: a.id,
      },
    },
    'verbal-yes',
  );
  applyEvent(replay, saidYes);
  expect(p.accepted).toBe(false);
  const accepted = act(
    w,
    b.id,
    {
      intent: '',
      action: {
        type: 'chat',
        text: '我接受',
        acceptProposalId: p.id,
      },
    },
    'accept',
  );
  applyEvent(replay, accepted);
  expect(accepted.success).toBe(true);
  expect(offer(a.id, b.id).text).toContain(`reproduce{proposalId:"${p.id}"}`);
  for (const actor of [a, b]) {
    const event = act(
      w,
      actor.id,
      {
        intent: '',
        action: {
          type: 'reproduce',
          proposalId: p.id,
        },
      },
      `mate-${actor.id}`,
    );
    expect(event.success).toBe(true);
    applyEvent(replay, event);
  }
  expect(p.completed).toBe(true);
  expect(a.pregnancy).toEqual({ father: b.id, due: w.tick + 5 });
  expect(a.ap).toBe(1);
  expect(b.ap).toBe(1);
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('shout reaches distance two including diagonals, with attribution and exact replay', () => {
  const w = createWorld({ population: 5 });
  const positions = [
    [3, 3],
    [5, 3],
    [5, 5],
    [6, 3],
    [4, 3],
  ];
  w.agents.forEach((a, i) => {
    [a.x, a.y] = positions[i];
  });
  const [a, b, c, d, dead] = w.agents;
  dead.death = { day: 1, cause: '测试' };
  dead.hp = 0;
  const replay = structuredClone(w);
  const event = act(
    w,
    a.id,
    { intent: '', action: { type: 'shout', text: '来这里一起采集' } },
    'shout',
  );
  expect(event.success).toBe(true);
  expect(event.recipients).toEqual([a.id, b.id, c.id]);
  expect(a.ap).toBe(3);
  expect(w.counters.chats).toBe(1);
  for (const listener of [b, c]) {
    expect(listener.inbox.at(-1)).toMatchObject({
      source: 'heard',
      speakerId: a.id,
      eventIds: [event.seq],
    });
    expect(observe(w, listener).recentEvents.at(-1)?.content).toContain('来这里一起采集');
    expect(observe(w, listener).people).not.toContainEqual(expect.objectContaining({ id: a.id }));
  }
  expect(d.inbox).toHaveLength(0);
  expect(dead.inbox).toHaveLength(0);
  applyEvent(replay, event);
  expect(hashWorld(replay)).toBe(hashWorld(w));
});

it('shout costs two AP for juveniles too; insufficient AP fails without broadcasting', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  b.x = a.x;
  b.y = a.y;
  a.age = 0;
  a.ap = 2;
  expect(act(w, a.id, { intent: '', action: { type: 'shout', text: '你好' } }, 'ok').success).toBe(
    true,
  );
  expect(a.ap).toBe(0);
  const inbox = structuredClone(b.inbox);
  a.ap = 1;
  const failed = act(w, a.id, { intent: '', action: { type: 'shout', text: '不应听到' } }, 'fail');
  expect(failed.success).toBe(false);
  expect(a.ap).toBe(0);
  expect(w.counters.chats).toBe(1);
  expect(b.inbox).toEqual(inbox);
});

it('two shouts use the entire daily AP allocation with no extra action slots', () => {
  const w = createWorld({ population: 1, days: 1, dailyAP: 4 });
  let shouts = 0;
  while (w.cursor.phase !== 'complete') {
    const task = nextTask(w);
    if (!task) {
      endDay(w);
      continue;
    }
    expect(
      act(w, task.agent.id, { intent: '', action: { type: 'shout', text: '有人吗' } }, task.id)
        .success,
    ).toBe(true);
    shouts++;
  }
  expect(shouts).toBe(2);
});

it('serializes listeners at radius two and preserves distant prefetched observations', () => {
  const w = createWorld({ population: 2 });
  const [a, b] = w.agents;
  a.x = a.y = 3;
  b.x = b.y = 5;
  expect(nextBatch(w, 6)).toHaveLength(1);
  act(w, a.id, { intent: '', action: { type: 'shout', text: '近处消息' } }, nextTask(w)!.id);
  expect(observe(w, nextBatch(w, 6)[0].agent).recentEvents.at(-1)?.content).toContain('近处消息');
  const distant = createWorld({ population: 2 });
  const [x, y] = distant.agents;
  x.x = x.y = 3;
  y.x = y.y = 6;
  const batch = nextBatch(distant, 6);
  expect(batch).toHaveLength(2);
  const prefetched = structuredClone(observe(distant, y));
  act(distant, x.id, { intent: '', action: { type: 'shout', text: '远处消息' } }, batch[0].id);
  expect(observe(distant, y)).toEqual(prefetched);
});
