import {
  DAY,
  RATION,
  TILE,
  PlanSchema,
  body,
  position,
  type Agent,
  type Event,
  type Motion,
  type Plan,
  type Point,
  type Task,
  type World,
  type Patch,
} from './types';

const HOUR = 3600000;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cell = (p: Point) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`;
const clone = <T>(v: T): T => structuredClone(v);

/** Four-connected paths have continuous positions and cannot cut wall corners. */
export function route(w: World, a: Agent, target: Point): Point[] | undefined {
  const from = position(a, w.time);
  const blocked = new Set(w.walls.map(cell));
  for (const g of w.gates) if (!g.open && !a.keys.includes(g.key)) blocked.add(cell(g));
  const start = { x: Math.floor(from.x / TILE), y: Math.floor(from.y / TILE) };
  const goal = { x: Math.floor(target.x / TILE), y: Math.floor(target.y / TILE) };
  if (goal.x < 0 || goal.y < 0 || goal.x >= w.size.w || goal.y >= w.size.h) return;
  const key = (x: number, y: number) => `${x},${y}`;
  if (blocked.has(key(goal.x, goal.y))) return;
  const q = [start],
    parent = new Map<string, string>();
  parent.set(key(start.x, start.y), '');
  for (let index = 0; index < q.length; index++) {
    const p = q[index];
    if (p.x === goal.x && p.y === goal.y) {
      const path: Point[] = [];
      let k = key(p.x, p.y);
      while (k) {
        const [x, y] = k.split(',').map(Number);
        path.unshift({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
        k = parent.get(k)!;
      }
      // Return to the current cell's center before turning, preventing corner cutting
      // when a route is replaced midway along an edge.
      if (dist(from, path[0]) > 0.001) path.unshift(from);
      else path[0] = from;
      if (dist(path.at(-1)!, target) > 0.001) path.push(target);
      return path;
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const x = p.x + dx,
        y = p.y + dy,
        k = key(x, y);
      if (x < 0 || y < 0 || x >= w.size.w || y >= w.size.h || blocked.has(k) || parent.has(k))
        continue;
      parent.set(k, key(p.x, p.y));
      q.push({ x, y });
    }
  }
}

export class ContinuousEngine {
  readonly events: Event[] = [];
  private previous: World;
  constructor(public world: World) {
    this.previous = clone(world);
  }

  private emit(
    type: string,
    text = '',
    actor?: number,
    listeners?: number[],
    channel?: Event['channel'],
  ) {
    const w = this.world;
    w.seq++;
    const patch: Patch = { meta: {} };
    for (const key of ['agents', 'stores', 'fields', 'gates'] as const) {
      const changed = w[key].filter(
        (row, i) => JSON.stringify(row) !== JSON.stringify(this.previous[key][i]),
      );
      if (changed.length) (patch as Record<string, unknown>)[key] = clone(changed);
    }
    for (const key of [
      'time',
      'seq',
      'status',
      'resourceVersion',
      'nextBody',
      'nextDay',
      'ledger',
      'calls',
    ] as const)
      if (JSON.stringify(w[key]) !== JSON.stringify(this.previous[key]))
        (patch.meta as Record<string, unknown>)[key] = clone(w[key]);
    const event: Event = { seq: w.seq, time: w.time, type, text, actor, listeners, channel, patch };
    this.events.push(event);
    this.previous = clone(w);
    return event;
  }

  private touchBody(a: Agent) {
    Object.assign(a, body(a, this.world.time));
    a.bodyAt = this.world.time;
  }

  private stop(a: Agent) {
    const w = this.world,
      action = a.action;
    if (a.motion) {
      const p = position(a, w.time);
      a.stats.distance +=
        a.motion.total *
        Math.max(0, Math.min(1, (w.time - a.motion.start) / (a.motion.end - a.motion.start)));
      Object.assign(a, p);
      delete a.motion;
    }
    if (action?.kind === 'work') {
      const f = w.fields.find((f) => f.id === action.target)!;
      const work = Math.max(0, Math.min(w.time, action.end) - action.start);
      const applied = Math.min(work, Math.max(0, f.required - f.work));
      f.work += applied;
      a.stats.workMs += applied;
    }
    if (action?.kind === 'withdraw') {
      const s = w.stores.find((s) => s.id === action.target)!;
      s.reserved = Math.max(0, s.reserved - action.amount);
      w.resourceVersion++;
    }
    delete a.action;
  }

  setPlan(id: number, raw: Plan, source = 'operator', expectedVersion?: number) {
    const plan = PlanSchema.parse(raw),
      a = this.world.agents.find((a) => a.id === id);
    if (!a || a.dead) throw Error('角色已死亡或不存在');
    if (expectedVersion !== undefined && a.planVersion !== expectedVersion) {
      this.emit('plan_rejected', '计划已更新，迟到回复未覆盖当前任务', id);
      return false;
    }
    if (plan.task) {
      const site = this.world.sites.find((s) => s.id === plan.task!.target);
      if (!site) throw Error('目标地点不存在');
      if (
        ['supply', 'deliver'].includes(plan.task.kind) &&
        !this.world.stores.some((s) => s.id === site.id)
      )
        throw Error('取放粮食需要指定储藏');
      if (plan.task.kind === 'farm' && !this.world.fields.some((f) => f.id === site.id))
        throw Error('农活需要指定田条');
    }
    // Speech and routine-only updates need not interrupt an ongoing walk or job.
    if (plan.task !== undefined) {
      this.stop(a);
      a.task = plan.task ?? undefined;
      delete a.blocked;
    }
    if (plan.routine) a.routine = clone(plan.routine);
    a.intent = plan.intent;
    a.planVersion++;
    this.emit(
      'plan',
      `${source === 'llm' ? 'LLM' : source === 'operator' ? '观察者' : '脚本'}计划：${plan.intent}`,
      id,
    );
    if (plan.speech) this.speak(id, plan.speech.text, plan.speech.mode);
    this.ensureAction(a);
    return true;
  }

  speak(id: number, text: string, mode: 'talk' | 'public_speak' | 'shout' = 'public_speak') {
    const a = this.world.agents.find((a) => a.id === id);
    if (!a || a.dead) return;
    if (a.voice) return;
    // Eating owns the mouth; speech can accompany locomotion and light work.
    if (a.action?.kind === 'eat') this.stop(a);
    a.voice = {
      text,
      mode,
      start: this.world.time,
      end: this.world.time + Math.max(3000, ([...text].length / 4) * 1000),
    };
    this.emit('speaking', `${a.name}开始说话`, id);
  }

  gate(id: string, open: boolean) {
    const w = this.world,
      g = w.gates.find((g) => g.id === id);
    if (!g) throw Error('门不存在');
    if (!open && w.agents.some((a) => !a.dead && dist(position(a, w.time), g) < 3))
      throw Error('有人正在通过门口，请稍后关门');
    g.open = open;
    w.resourceVersion++;
    // Stop every affected route at its current physical location before the door.
    if (!open)
      for (const a of w.agents)
        if (a.motion && !a.keys.includes(g.key)) {
          const traveled =
            a.motion.total *
            Math.max(0, (w.time - a.motion.start) / (a.motion.end - a.motion.start));
          let accumulated = 0;
          const remaining = a.motion.points.filter((_, i) => {
            if (i === 0) return false;
            accumulated += a.motion!.lengths[i - 1];
            return accumulated >= traveled;
          });
          if (remaining.some((p) => cell(p) === cell(g))) {
            this.stop(a);
            a.blocked = { reason: '庄园门已关闭，路径需要重新规划', version: w.resourceVersion };
          }
        }
    this.emit('gate', `庄园门${open ? '打开' : '关闭'}`);
    this.wakeBlocked();
    for (const a of w.agents) if (!a.action) this.ensureAction(a);
  }

  private wakeBlocked() {
    for (const a of this.world.agents)
      if (
        a.action?.kind === 'wait' &&
        a.blocked &&
        a.blocked.version !== this.world.resourceVersion
      )
        this.stop(a);
  }

  pause(paused: boolean) {
    if (this.world.status === 'complete') return;
    this.world.status = paused ? 'paused' : 'running';
    this.emit('control', paused ? '模拟已暂停' : '模拟已继续');
  }

  thinking(id: number, requestId: string) {
    const a = this.world.agents.find((a) => a.id === id)!;
    if (a.thinking || a.dead || this.world.calls >= this.world.maxCalls) return;
    a.thinking = { id: requestId, version: a.planVersion, at: this.world.time };
    a.lastRead = this.world.seq;
    a.nextThink = this.world.time + DAY / 2;
    this.world.calls++;
    this.emit('think_started', '正在异步思考，已有任务继续执行', id);
    return clone(a.thinking);
  }

  thought(
    id: number,
    requestId: string,
    version: number,
    result: { plan?: Plan; error?: string; tokens?: number },
  ) {
    const a = this.world.agents.find((a) => a.id === id)!;
    if (a.thinking?.id !== requestId) return;
    delete a.thinking;
    a.thoughts++;
    a.tokens += result.tokens ?? 0;
    a.nextThink = Math.max(this.world.time + DAY / 4, a.nextThink);
    this.emit(
      'think_finished',
      result.error ? `思考失败：${result.error}` : '思考完成，校验当前任务',
      id,
    );
    if (result.plan && !a.dead) {
      try {
        this.setPlan(id, result.plan, 'llm', version);
      } catch (e) {
        this.emit('plan_rejected', String(e), id);
      }
    }
  }

  private block(a: Agent, reason: string) {
    a.blocked = { reason, version: this.world.resourceVersion };
    this.start(a, 'wait', '', 0, 30 * 60000);
  }

  private start(
    a: Agent,
    kind: NonNullable<Agent['action']>['kind'],
    target: string,
    amount: number,
    duration: number,
    auto = false,
  ) {
    a.action = {
      kind,
      target,
      amount,
      start: this.world.time,
      end: this.world.time + Math.max(100, duration),
      auto,
    };
    this.emit('action_started', kind === 'wait' ? '' : `${kind}:${target}`, a.id);
  }

  private walk(a: Agent, target: Point, id: string) {
    if (dist(position(a, this.world.time), target) < 0.01) return false;
    const points = route(this.world, a, target);
    if (!points) {
      this.block(a, `无法到达 ${id}，等待门状态变化或新的目标`);
      return true;
    }
    const lengths = points.slice(1).map((p, i) => dist(points[i], p));
    const total = lengths.reduce((a, b) => a + b, 0);
    const speed = (1.2 / (1 + a.grain / 30)) * Math.max(0.35, body(a, this.world.time).hp / 100);
    const duration = Math.max(100, (total / speed) * 1000);
    a.motion = {
      points,
      lengths,
      total,
      start: this.world.time,
      end: this.world.time + duration,
    } satisfies Motion;
    this.start(a, 'walk', id, 0, duration);
    return true;
  }

  private ensureAction(a: Agent) {
    const w = this.world;
    if (a.dead || a.action || w.status === 'complete') return;
    this.touchBody(a);
    if (a.hp <= 0) {
      this.die(a);
      return;
    }
    if (a.routine.eat && a.food <= 4000 && a.grain > 0.0001 && !a.voice) {
      this.start(a, 'eat', '', Math.min(a.grain, (5000 - a.food) / 3400), 5 * 60000, true);
      return;
    }
    if (a.blocked && a.blocked.version === w.resourceVersion) {
      this.start(a, 'wait', '', 0, 30 * 60000);
      return;
    }
    delete a.blocked;
    let task = a.task;
    // Replenishment is performed only when the agent explicitly enabled it.
    if (a.routine.fetch && a.grain < 2 * RATION)
      task = { kind: 'supply', target: a.home, amount: a.routine.reserveDays * RATION };
    if (!task && a.routine.work) task = { kind: 'farm', target: a.plot, amount: 1 };
    if (!task) {
      this.start(a, 'wait', '', 0, 30 * 60000);
      return;
    }
    const target = w.sites.find((s) => s.id === task.target);
    if (!target) {
      this.block(a, '目标地点已失效');
      return;
    }
    if (this.walk(a, target, task.target)) return;
    switch (task.kind) {
      case 'navigate':
        delete a.task;
        this.emit('arrived', `已到达 ${target.label}`, a.id);
        this.start(a, 'wait', '', 0, 1000);
        return;
      case 'supply': {
        const s = w.stores.find((s) => s.id === task.target)!;
        const amount = Math.min(
          Math.max(0, task.amount - a.grain),
          s.grain - s.reserved,
          a.capacity - a.grain,
        );
        if (task.amount - a.grain <= 0.0001) {
          if (a.task === task) delete a.task;
          this.start(a, 'wait', '', 0, 1000);
          return;
        }
        if (amount <= 0.0001) {
          this.block(a, '粮箱可用库存或背包空间不足');
          return;
        }
        s.reserved += amount;
        this.start(a, 'withdraw', s.id, amount, 15000 + amount * 8000, a.task !== task);
        return;
      }
      case 'deliver': {
        const amount = Math.min(task.amount, a.grain);
        if (amount <= 0.0001) {
          this.block(a, '随身没有可交付的粮食');
          return;
        }
        this.start(a, 'deposit', target.id, amount, 15000 + amount * 8000);
        return;
      }
      case 'farm': {
        const f = w.fields.find((f) => f.id === task.target)!;
        if (f.harvest > 0 && a.grain < a.capacity) {
          const n = Math.min(f.harvest, a.capacity - a.grain, 5);
          f.harvest -= n;
          a.grain += n;
          w.resourceVersion++;
          this.emit('harvest', `收获 ${n.toFixed(2)} kg 谷物`, a.id);
          this.start(a, 'wait', '', 0, 60000);
          return;
        }
        if (a.grain >= a.capacity - 0.001) {
          this.block(a, '背包已满，需安排送粮入仓');
          return;
        }
        if (f.work >= f.required) {
          this.block(a, '本月田间劳动已完成，等待月末成熟');
          return;
        }
        this.start(a, 'work', f.id, 0, Math.min(30 * 60000, f.required - f.work));
        return;
      }
      default:
        this.start(a, 'rest', target.id, 0, HOUR);
        return;
    }
  }

  private die(a: Agent) {
    this.stop(a);
    a.dead = true;
    a.hp = 0;
    delete a.voice;
    delete a.task;
    this.emit('death', `${a.name}因持续饥饿死亡，尸体与随身物品留在原地`, a.id);
  }

  private finish(a: Agent) {
    const w = this.world,
      act = a.action!;
    this.touchBody(a);
    if (a.hp <= 0) {
      this.die(a);
      return;
    }
    if (act.kind === 'walk') {
      const m = a.motion!;
      Object.assign(a, m.points.at(-1));
      a.stats.distance += m.total;
      delete a.motion;
    } else if (act.kind === 'eat') {
      const n = Math.min(a.grain, act.amount);
      a.grain -= n;
      a.food = Math.min(5000, a.food + n * 3400);
      a.stats.eatenKg += n;
      w.ledger.eaten += n;
    } else if (act.kind === 'withdraw') {
      const s = w.stores.find((s) => s.id === act.target)!;
      const n = Math.min(act.amount, s.grain, a.capacity - a.grain);
      s.reserved = Math.max(0, s.reserved - act.amount);
      s.grain -= n;
      a.grain += n;
      w.resourceVersion++;
      if (!act.auto && a.task?.kind === 'supply' && a.grain >= a.task.amount - 0.0001)
        delete a.task;
    } else if (act.kind === 'deposit') {
      const s = w.stores.find((s) => s.id === act.target)!;
      const n = Math.min(act.amount, a.grain);
      s.grain += n;
      a.grain -= n;
      a.stats.deliveredKg += n;
      w.resourceVersion++;
      if (a.task?.kind === 'deliver') {
        a.task.amount -= n;
        if (a.task.amount <= 0.0001) delete a.task;
      }
    } else if (act.kind === 'work') {
      const f = w.fields.find((f) => f.id === act.target)!;
      const n = Math.min(act.end - act.start, Math.max(0, f.required - f.work));
      f.work += n;
      a.stats.workMs += n;
    }
    delete a.action;
    this.emit(
      act.kind === 'wait' ? 'idle' : act.kind,
      ['withdraw', 'deposit'].includes(act.kind)
        ? `${act.kind === 'withdraw' ? '领取' : '存入'} ${act.amount.toFixed(2)} kg · ${act.target}`
        : act.kind === 'work'
          ? `田间劳动完成 ${(act.end - act.start) / 60000} 分钟`
          : '',
      a.id,
    );
  }

  advance(target: number) {
    const w = this.world;
    if (w.status !== 'running') return;
    target = Math.max(w.time, Math.min(target, w.days * DAY));
    for (const a of w.agents) this.ensureAction(a);
    let count = 0;
    while (w.time < target && w.status === 'running') {
      if (++count > 100000) throw Error('推进事件预算超限');
      const next = Math.min(
        target,
        w.nextBody,
        w.nextDay,
        ...w.agents.flatMap((a) => [
          ...(a.action ? [a.action.end] : []),
          ...(a.voice ? [a.voice.end] : []),
        ]),
      );
      w.time = next;
      for (const a of w.agents) if (a.action && a.action.end <= next) this.finish(a);
      for (const a of w.agents)
        if (a.voice && a.voice.end <= next) {
          const speech = a.voice;
          delete a.voice;
          const radius = speech.mode === 'shout' ? 75 : 12;
          const listeners = w.agents
            .filter(
              (b) =>
                b.id !== a.id && !b.dead && dist(position(a, next), position(b, next)) <= radius,
            )
            .map((b) => b.id);
          a.stats.spoken++;
          this.emit('speech', speech.text, a.id, listeners, speech.mode);
        }
      if (w.nextBody <= next) {
        w.nextBody += 30 * 60000;
        for (const a of w.agents)
          if (!a.dead) {
            this.touchBody(a);
            if (a.hp <= 0) this.die(a);
          }
        // Automatic eating can interrupt long work, preserving the completed labor.
        for (const a of w.agents)
          if (
            !a.dead &&
            a.routine.eat &&
            a.food <= 4000 &&
            a.grain > 0.001 &&
            !a.voice &&
            a.action?.kind !== 'eat'
          )
            this.stop(a);
        this.emit('body');
      }
      if (w.nextDay <= next) {
        const day = Math.round(w.nextDay / DAY);
        w.nextDay += DAY;
        if (day % 30 === 0) {
          let grown = 0;
          for (const f of w.fields) {
            const n = 30 * RATION * Math.min(1, f.work / f.required) * (day >= 40 ? 0.5 : 1);
            f.harvest += n;
            f.work = 0;
            grown += n;
          }
          w.ledger.grown += grown;
          w.resourceVersion++;
          this.emit('season', `月末成熟 ${grown.toFixed(2)} kg 谷物`);
        }
        if (w.mode === 'scripted')
          for (const a of w.agents)
            if (!a.dead) {
              this.speak(
                a.id,
                [
                  `今天去${w.sites.find((s) => s.id === a.plot)?.label}干活，有事来田边找我。`,
                  '大厅的粮箱里有粮，我正在把口粮带在身上。',
                  '做完农活，我们在榆树广场见。',
                ][a.id % 3],
                'shout',
              );
            }
        this.emit('day_end', `第 ${day} 天结束`);
        if (day >= w.days) {
          w.status = 'complete';
          this.emit('control', '实验已到设定天数');
        }
      }
      this.wakeBlocked();
      if (w.status === 'running') for (const a of w.agents) this.ensureAction(a);
    }
  }
}
