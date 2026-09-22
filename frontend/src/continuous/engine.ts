import { hearDoorNoise, DOOR_NOISE_RADIUS, type DoorAlarm } from './manor/perception';
import { permitted, nextAccessExpiry, allowedDoors } from './manor/access';
import {
  accessible,
  load,
  carryingCapacity,
  targetPoint,
  validateOperation,
  operationMinutes,
  settleOperation,
  royalDay,
  royalTask,
  witness,
  demoPlan,
  distance,
} from './manor/rules';
import { interactionPoint, segmentClear, solids } from './game/space';
import { route } from './game/navigation';
import type { Letter } from './manor/state';
import { deliverLetters, nextLetterTime } from './manor/letters';
import { assignRoyalTargets, navigationFailure, blockedDoorTask } from './manor/royal-navigation';
import { movementSpeed, actionDuration } from './game/rules';
export { route } from './game/navigation';
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

export class ContinuousEngine {
  readonly events: Event[] = [];
  private previousRows: Record<string, string[]> = {};
  private previousLetters = new Map<string, string>();
  private metaValue(key: keyof World) {
    if (key !== 'manor' || !this.world.manor) return this.world[key];
    const { letters, ...metadata } = this.world.manor;
    return metadata;
  }
  private letterVersion(l: Letter) {
    return `${l.status}|${l.holder}|${l.dueAt}|${l.receivedAt}|${l.note}`;
  }
  private previousMeta = new Map<string, string | undefined>();
  constructor(public world: World) {
    for (const key of ['agents', 'stores', 'fields', 'gates'] as const)
      this.previousRows[key] = world[key].map((row) => JSON.stringify(row));
    for (const key of [
      'time',
      'seq',
      'status',
      'resourceVersion',
      'nextBody',
      'nextDay',
      'ledger',
      'calls',
      'manor',
    ] as const)
      this.previousMeta.set(key, JSON.stringify(this.metaValue(key)));
    for (const l of world.manor?.letters ?? [])
      this.previousLetters.set(l.id, this.letterVersion(l));
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
      const encoded = w[key].map((row) => JSON.stringify(row));
      const changed = w[key].filter((row, i) => encoded[i] !== this.previousRows[key][i]);
      this.previousRows[key] = encoded;
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
      'manor',
    ] as const) {
      const encoded = JSON.stringify(this.metaValue(key));
      if (encoded !== this.previousMeta.get(key))
        (patch.meta as Record<string, unknown>)[key] = clone(this.metaValue(key));
      this.previousMeta.set(key, encoded);
    }
    const mail = (w.manor?.letters ?? []).filter(
      (l) => this.previousLetters.get(l.id) !== this.letterVersion(l),
    );
    if (mail.length) {
      patch.mail = clone(mail);
      for (const l of mail) this.previousLetters.set(l.id, this.letterVersion(l));
    }
    const event: Event = { seq: w.seq, time: w.time, type, text, actor, listeners, channel, patch };
    this.events.push(event);
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
    if (!a || a.dead || a.away) throw Error('角色已死亡或不存在');
    if (this.world.manor?.missions.some((m) => m.agentId === id && m.taxPaidAt !== undefined)) {
      this.emit('plan_rejected', '王税已收齐，使者正自动离场，计划未覆盖离场任务', id);
      return false;
    }
    if (expectedVersion !== undefined && a.planVersion !== expectedVersion) {
      this.emit('plan_rejected', '计划已更新，迟到回复未覆盖当前任务', id);
      return false;
    }
    if (plan.task) {
      const site = targetPoint(this.world, a, plan.task);
      if (!site)
        throw Error(
          'coordinate_error：坐标错误或目标地点ID不存在，请使用地图真实地点ID或 coord:x,y 米坐标',
        );
      if (
        !Number.isFinite(site.x) ||
        !Number.isFinite(site.y) ||
        site.x < 0 ||
        site.y < 0 ||
        site.x >= this.world.size.w * TILE ||
        site.y >= this.world.size.h * TILE
      )
        throw Error('coordinate_error：坐标错误，目标超出地图米制边界');
      if (
        ['supply', 'deliver'].includes(plan.task.kind) &&
        !this.world.stores.some((s) => s.id === plan.task!.target)
      )
        throw Error('取放粮食需要指定储藏');
      if (plan.task.kind === 'farm' && !this.world.fields.some((f) => f.id === plan.task!.target))
        throw Error('农活需要指定田条');
    }
    if (plan.routine) {
      if (
        plan.routine.fetch &&
        !this.world.stores.some((s) => s.id === (plan.routine!.supplyStore ?? a.home))
      )
        throw Error('没有默认家庭粮仓；开启 fetch 必须用 supplyStore 指定真实储藏，出口不是粮仓');
      for (const id of [plan.routine.supplyStore, plan.routine.depositStore])
        if (id && !this.world.stores.some((s) => s.id === id)) throw Error('日程储藏不存在');
      for (const id of plan.routine.plots ?? [])
        if (!this.world.fields.some((f) => f.id === id)) throw Error('日程田条不存在');
      if (plan.routine.idleAt && !this.world.sites.some((s) => s.id === plan.routine!.idleAt))
        throw Error('日程休息地点不存在');
    }
    // Speech and routine-only updates need not interrupt an ongoing walk or job.
    if (plan.task !== undefined) {
      this.stop(a);
      a.task = plan.task ?? undefined;
      delete a.blocked;
    }
    if (plan.combat) a.combat = clone(plan.combat);
    if (plan.routine) a.routine = clone(plan.routine);
    // Navigation takes control even when the model repeats its previous routine in this plan.
    if (plan.task?.kind === 'navigate') {
      a.routine = { ...a.routine, fetch: false, work: false };
      delete a.routine.depositStore;
      delete a.routine.idleAt;
    }
    a.intent = plan.intent;
    a.planVersion++;
    this.emit(
      'plan',
      `${source === 'llm' ? 'LLM' : source === 'operator' ? '观察者' : '脚本'}计划：${plan.intent}`,
      id,
    );
    if (plan.task?.kind === 'navigate')
      this.emit(
        'routine_interrupted',
        `navigate 已中断旧自动任务：补粮、农活、自动存粮和闲暇返回已关闭；自动进食保持${a.routine.eat ? '开启' : '关闭'}。抵达后留在原地，后续显式设置 routine 才恢复自动任务；同一导航计划内的自动移动配置也不会生效。`,
        id,
      );
    if (plan.speech) this.speak(id, plan.speech.text, plan.speech.mode);
    this.ensureAction(a);
    return true;
  }

  speak(id: number, text: string, mode: 'talk' | 'public_speak' | 'shout' = 'public_speak') {
    const a = this.world.agents.find((a) => a.id === id);
    if (!a || a.dead || a.away) return;
    if (a.voice) return;
    // Eating owns the mouth; speech can accompany locomotion and light work.
    if (a.action?.kind === 'eat') this.stop(a);
    a.voice = {
      text,
      mode,
      start: this.world.time,
      end:
        this.world.time +
        actionDuration(this.world, 'speech', Math.max(3000, ([...text].length / 4) * 1000)),
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
        if (a.motion && !permitted(a, g.id, g.key, w.time)) {
          const traveled =
            a.motion.total *
            Math.max(0, (w.time - a.motion.start) / (a.motion.end - a.motion.start));
          let accumulated = 0;
          const remaining = a.motion.points.filter((_, i) => {
            if (i === 0) return false;
            accumulated += a.motion!.lengths[i - 1];
            return accumulated >= traveled;
          });
          const rest = [position(a, w.time), ...remaining];
          const crossing =
            w.version === 'continuous-game-2'
              ? rest.some(
                  (p, i) =>
                    i > 0 && !segmentClear(rest[i - 1], p, [{ x: g.x, y: g.y, w: 1.5, d: 7 }]),
                )
              : remaining.some((p) => cell(p) === cell(g));
          if (crossing) {
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
    if (a.thinking || a.dead) return;
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
    a.nextThink = a.replanAfterAlarm
      ? this.world.time
      : Math.max(this.world.time + DAY / 4, a.nextThink);
    delete a.replanAfterAlarm;
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
      end: this.world.time + actionDuration(this.world, kind, duration),
      auto,
    };
    this.emit('action_started', kind === 'wait' ? '' : `${kind}:${target}`, a.id);
  }

  private walk(a: Agent, target: Point, id: string) {
    target = interactionPoint(this.world, target);
    if (this.world.manor && (id.startsWith('agent:') || a.task?.kind === 'break_lock')) {
      const obstacles = solids(this.world, a.keys, allowedDoors(this.world, a));
      const contactClear = (p: Point) =>
        !id.startsWith('agent:') || segmentClear(p, target, obstacles);
      if (
        distance(position(a, this.world.time), target) <= 3.5 &&
        contactClear(position(a, this.world.time))
      )
        return false;
      const candidates = Array.from({ length: 16 }, (_, i) => ({
        x: target.x + Math.cos((i * Math.PI) / 8) * 3.2,
        y: target.y + Math.sin((i * Math.PI) / 8) * 3.2,
      })).sort((p, q) => distance(a, p) - distance(a, q));
      target = candidates.find((p) => contactClear(p) && route(this.world, a, p)) ?? target;
    }
    if (dist(position(a, this.world.time), target) < 0.01) return false;
    const points = route(this.world, a, target);
    if (!points) {
      this.block(a, navigationFailure(this.world, a, target, id));
      return true;
    }
    const lengths = points.slice(1).map((p, i) => dist(points[i], p));
    const total = lengths.reduce((a, b) => a + b, 0);
    const speed = movementSpeed(this.world, a);
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

  refreshMovementSpeed() {
    const w = this.world;
    if (w.version !== 'continuous-game-2') return;
    for (const a of w.agents) {
      const m = a.motion,
        action = a.action;
      if (!m || action?.kind !== 'walk' || a.dead || m.end <= w.time) continue;
      const speed = movementSpeed(w, a);
      const priorSpeed = (m.total * 1000) / (m.end - m.start);
      if (Math.abs(speed - priorSpeed) < 1e-9) continue;
      // Retain the remaining route and current position; completed distance is accounted once.
      let traveled = m.total * Math.max(0, (w.time - m.start) / (m.end - m.start));
      let segment = 0;
      while (segment < m.lengths.length && traveled >= m.lengths[segment])
        traveled -= m.lengths[segment++];
      const points = [position(a, w.time), ...m.points.slice(segment + 1)];
      this.stop(a);
      const lengths = points.slice(1).map((p, i) => dist(points[i], p));
      const total = lengths.reduce((n, length) => n + length, 0);
      const duration = Math.max(100, (total / speed) * 1000);
      a.motion = { points, lengths, total, start: w.time, end: w.time + duration };
      this.start(a, 'walk', action.target, 0, duration, action.auto);
    }
  }

  private doorNoise(a: Agent, task: Task, stage: DoorAlarm['stage']) {
    const w = this.world,
      at = targetPoint(w, a, task);
    if (!at) return;
    const listeners = hearDoorNoise(w, a, task.target, at, stage);
    const verb =
      stage === 'start'
        ? '开始砸门，传来猛烈撞击声'
        : stage === 'broken'
          ? '打破了门锁，传来断裂巨响'
          : '砸击门锁，传来巨响';
    this.emit(
      'door_noise',
      `${a.name} #${a.id} 正在 ${task.target} @(${at.x.toFixed(1)},${at.y.toFixed(1)})米${verb}；${DOOR_NOISE_RADIUS}米内可听见。可选择attack target=agent:${a.id}出战阻止、求援或撤离。`,
      a.id,
      listeners,
    );
  }

  private returnPaidMessengers() {
    const w = this.world;
    if (!w.manor || w.manor.king.arrears > 1e-7) return;
    for (const m of w.manor.missions) {
      if (m.kind !== 'messenger' || m.finished || m.taxPaidAt !== undefined) continue;
      const a = w.agents.find((a) => a.id === m.agentId);
      if (!a || a.dead || a.away) continue;
      this.stop(a);
      delete a.voice;
      delete a.blocked;
      m.taxPaidAt = w.time;
      a.planVersion++;
      a.routine = {
        eat: a.routine.eat,
        fetch: false,
        work: false,
        reserveDays: a.routine.reserveDays,
      };
      a.task = { kind: 'navigate', target: 'exit', amount: 1 };
      a.intent = '王税已收齐，大喊通知后自动返回exit离场';
      const memory = `D${Math.floor(w.time / DAY) + 1}：引擎确认已到期王税全部扣缴，税收齐了；我将shout通知附近人，并自动导航到exit离场。`;
      (a.systemMemory ??= []).push(memory);
      this.emit('royal_return', memory, a.id);
      this.speak(a.id, '税收齐了', 'shout');
    }
  }

  private ensureAction(a: Agent) {
    const w = this.world;
    if (a.dead || a.away || a.action || w.status === 'complete') return;
    const returning = w.manor?.missions.find(
      (m) => m.agentId === a.id && m.taxPaidAt !== undefined && !m.finished,
    );
    if (returning) {
      if (a.voice) return; // Finish the announcement before walking out.
      a.task = { kind: 'navigate', target: 'exit', amount: 1 };
      const exit = w.sites.find((s) => s.id === 'exit');
      if (exit && !route(w, a, exit)) a.task = blockedDoorTask(w, a, exit) ?? a.task;
    }

    if (witness(w, a)) this.emit('witness', '亲见受封者尸体，死因与叛乱性质待本人调查判断', a.id);
    const military = royalTask(w, a);
    if (w.manor?.missions.some((m) => m.agentId === a.id && m.kind === 'army')) {
      a.task = military;
      delete a.blocked;
    }
    this.touchBody(a);
    if (a.hp <= 0) {
      this.die(a);
      return;
    }
    if (a.routine.eat && a.food <= 4000 && a.grain > 0.0001 && !a.voice) {
      this.start(a, 'eat', '', Math.min(a.grain, (5000 - a.food) / 3400), 5 * 60000, true);
      return;
    }
    if (
      w.manor &&
      w.mode === 'scripted' &&
      !w.manor.missions.some((m) => m.agentId === a.id) &&
      a.task?.kind === 'farm' &&
      a.grain > 9 * RATION
    ) {
      delete a.task;
      delete a.blocked;
    }
    if (a.blocked && a.blocked.version === w.resourceVersion) {
      this.start(a, 'wait', '', 0, 30 * 60000);
      return;
    }
    delete a.blocked;
    let task = a.task;
    if (!task && w.manor && w.mode === 'scripted') task = a.task = demoPlan(w, a);
    // Replenishment is performed only when the agent explicitly enabled it.
    if (
      a.routine.fetch &&
      task?.kind !== 'attack' &&
      a.grain < Math.min(2, a.routine.reserveDays) * RATION - 0.0001
    )
      task = {
        kind: 'supply',
        target: a.routine.supplyStore ?? a.home,
        amount: a.routine.reserveDays * RATION,
      };
    if (!task && a.routine.depositStore && a.grain > a.routine.reserveDays * RATION + 1)
      task = {
        kind: 'deliver',
        target: a.routine.depositStore,
        amount: a.grain - a.routine.reserveDays * RATION,
      };
    if (!task && a.routine.work) {
      const f = w.fields.find(
        (f) =>
          (a.routine.plots ?? a.plots ?? [a.plot]).includes(f.id) &&
          (f.harvest > 0 || f.work < f.required),
      );
      if (f) task = { kind: 'farm', target: f.id, amount: 1 };
    }
    if (!task && a.routine.idleAt) task = { kind: 'rest', target: a.routine.idleAt, amount: 1 };
    if (!task) {
      this.start(a, 'wait', '', 0, 30 * 60000);
      return;
    }
    const target = targetPoint(w, a, task);
    if (!target) {
      this.block(a, 'coordinate_error：目标地点ID不存在或坐标错误');
      return;
    }
    const special = !['navigate', 'supply', 'deliver', 'farm', 'rest', 'guard'].includes(task.kind);
    if (special) {
      const error = validateOperation(w, a, task);
      if (error) {
        this.block(a, error);
        return;
      }
    }
    if (['supply', 'deliver'].includes(task.kind)) {
      const s = w.stores.find((s) => s.id === task.target);
      if (!s) {
        this.block(a, `补粮/存粮目标 ${task.target} 不是储藏；请关闭 fetch 或设置真实 supplyStore`);
        return;
      }
      if (!accessible(s, a, w.time)) {
        this.block(
          a,
          `door_locked：${task.target} 门锁了无法进入；索取钥匙或使用 break_lock target=${task.target} 暴力破门`,
        );
        return;
      }
    }
    if (this.walk(a, target, task.target)) return;
    if (special) {
      this.start(a, 'estate', task.target, task.amount, operationMinutes(task) * 60000);
      a.action!.operation = clone(task);
      this.emit('operation', `${task.kind} 开始`, a.id);
      if (task.kind === 'break_lock') this.doorNoise(a, task, 'start');
      return;
    }

    switch (task.kind) {
      case 'navigate':
        delete a.task;
        if (returning && task.target === 'exit') {
          returning.finished = true;
          returning.exitedAt = w.time;
          a.away = true;
          a.intent = '税收齐了，已返回exit离场';
          const memory = `D${Math.floor(w.time / DAY) + 1}：已到达exit并离开领地，税款调查任务结束。`;
          (a.systemMemory ??= []).push(memory);
          this.emit('royal_departure', memory, a.id);
          return;
        }

        this.emit(
          'arrived',
          `已到达 ${w.sites.find((s) => s.id === task.target)?.label ?? task.target}`,
          a.id,
        );
        this.start(a, 'wait', '', 0, 1000);
        return;
      case 'supply': {
        const s = w.stores.find((s) => s.id === task.target)!;
        const amount = Math.min(
          Math.max(0, task.amount - a.grain),
          s.grain - s.reserved,
          Math.max(0, carryingCapacity(a) - load(a)),
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
        this.start(a, 'deposit', task.target, amount, 15000 + amount * 8000);
        return;
      }
      case 'farm': {
        const f = w.fields.find((f) => f.id === task.target)!;
        if (f.harvest > 0 && load(a) < carryingCapacity(a)) {
          const n = Math.min(f.harvest, Math.max(0, carryingCapacity(a) - load(a)), 5);
          f.harvest -= n;
          a.grain += n;
          w.resourceVersion++;
          this.emit('harvest', `收获 ${n.toFixed(2)} kg 谷物`, a.id);
          this.start(a, 'wait', '', 0, 60000);
          return;
        }
        if (load(a) >= carryingCapacity(a) - 0.001) {
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
        this.start(a, 'rest', task.target, 0, HOUR);
        return;
    }
  }

  private die(a: Agent, cause = '持续饥饿') {
    this.stop(a);
    a.dead = true;
    a.hp = 0;
    delete a.voice;
    delete a.task;
    this.emit('death', `${a.name}因${cause}死亡，尸体与随身物品留在原地`, a.id);
  }

  private finish(a: Agent) {
    const w = this.world,
      act = a.action!;
    this.touchBody(a);
    if (a.hp <= 0) {
      this.die(a);
      return;
    }
    if (act.kind === 'estate') {
      if (act.operation?.kind === 'attack') {
        const b = w.agents.find((b) => `agent:${b.id}` === act.target);
        if (b) this.touchBody(b);
      }
      const result = settleOperation(w, a, act.operation!);
      delete a.action;
      delete a.task;
      w.resourceVersion++;
      this.emit(
        'estate',
        result.text,
        a.id,
        result.damaged ? [result.damaged.id] : result.listeners,
      );
      if (result.doorNoise) this.doorNoise(a, act.operation!, result.doorNoise);
      if (result.damaged) {
        const b = result.damaged;
        this.stop(b);
        if (b.hp <= 0) this.die(b, '战斗');
        else {
          const policy = b.combat ?? { mode: 'low_hp', retreatHp: 45 };
          if (policy.mode === 'flee' || (policy.mode === 'low_hp' && b.hp <= policy.retreatHp)) {
            const origin = position(b, w.time),
              enemy = position(a, w.time);
            const safe = w.sites
              .filter((s) => distance(s, enemy) > distance(origin, enemy) + 20)
              .sort((p, q) => distance(p, origin) - distance(q, origin))
              .find((s) => route(w, b, s));
            if (safe) b.task = { kind: 'navigate', target: safe.id, amount: 1 };
          } else b.task = { kind: 'attack', target: `agent:${a.id}`, amount: 1 };
          delete b.blocked;
          this.emit('reaction', '遭攻击后调整行动', b.id);
        }
      }
      return;
    }
    if (act.kind === 'walk') {
      const m = a.motion!;
      Object.assign(a, m.points.at(-1));
      a.stats.distance += m.total;
      delete a.motion;
    } else if (act.kind === 'eat') {
      const n = Math.min(
        a.grain,
        w.version === 'continuous-game-2' ? (5000 - a.food) / 3400 : act.amount,
      );
      a.grain -= n;
      a.food = Math.min(5000, a.food + n * 3400);
      a.stats.eatenKg += n;
      w.ledger.eaten += n;
    } else if (act.kind === 'withdraw') {
      const s = w.stores.find((s) => s.id === act.target)!;
      const n = accessible(s, a, w.time)
        ? Math.min(act.amount, s.grain, Math.max(0, carryingCapacity(a) - load(a)))
        : 0;
      s.reserved = Math.max(0, s.reserved - act.amount);
      s.grain -= n;
      a.grain += n;
      w.resourceVersion++;
      if (!act.auto && a.task?.kind === 'supply' && a.grain >= a.task.amount - 0.0001)
        delete a.task;
    } else if (act.kind === 'deposit') {
      const s = w.stores.find((s) => s.id === act.target)!;
      const n = accessible(s, a, w.time) ? Math.min(act.amount, a.grain) : 0;
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
    if (
      w.manor &&
      w.mode === 'scripted' &&
      ['work', 'rest', 'withdraw', 'deposit'].includes(act.kind)
    )
      delete a.task;
    if (
      act.kind === 'work' &&
      w.fields.find((f) => f.id === act.target)!.work >=
        w.fields.find((f) => f.id === act.target)!.required
    )
      delete a.task;
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

  advance(target: number, eventBudget = Infinity) {
    const initialEvents = this.events.length;
    const w = this.world;
    if (w.status !== 'running') return;
    target = Math.max(w.time, Math.min(target, w.days * DAY));
    this.returnPaidMessengers();
    for (const a of w.agents) this.ensureAction(a);
    let count = 0;
    while (w.time < target && w.status === 'running') {
      // Yield at a complete simulation boundary so large catch-ups can be committed in chunks.
      if (this.events.length - initialEvents >= eventBudget) return;
      if (++count > 100000) throw Error('推进事件预算超限');
      const next = Math.min(
        target,
        w.nextBody,
        w.nextDay,
        nextLetterTime(w),
        nextAccessExpiry(w),
        ...w.agents.flatMap((a) => [
          ...(a.action ? [a.action.end] : []),
          ...(a.voice ? [a.voice.end] : []),
        ]),
      );
      w.time = next;
      for (const a of w.agents) {
        const expired = (a.doorAccess ?? []).filter((g) => g.until <= next);
        if (!expired.length) continue;
        if (a.motion) this.stop(a); // Replan remaining movement using current access rights.
        a.doorAccess = a.doorAccess!.filter((g) => g.until > next);
        delete a.blocked;
        w.resourceVersion++;
        this.emit(
          'access_expired',
          `临时门禁授权到期：${expired.map((g) => g.door).join(',')}，后续进门需钥匙或重新授权`,
          a.id,
        );
      }

      for (const letter of deliverLetters(w))
        this.emit('letter_delivery', letter.text, letter.actor, letter.listeners);
      for (const a of w.agents) if (a.action && a.action.end <= next) this.finish(a);
      for (const a of w.agents)
        if (a.voice && a.voice.end <= next) {
          const speech = a.voice;
          delete a.voice;
          const radius = speech.mode === 'shout' ? 75 : 12;
          const listeners = w.agents
            .filter(
              (b) =>
                b.id !== a.id &&
                !b.dead &&
                !b.away &&
                dist(position(a, next), position(b, next)) <= radius,
            )
            .map((b) => b.id);
          a.stats.spoken++;
          this.emit('speech', speech.text, a.id, listeners, speech.mode);
        }
      if (w.nextBody <= next) {
        w.nextBody += 30 * 60000;
        for (const a of w.agents)
          if (!a.dead && !a.away) {
            this.touchBody(a);
            if (a.hp <= 0) this.die(a);
          }
        // Pursuers refresh moving targets at body boundaries, rather than every render/server tick.
        const assignments = assignRoyalTargets(w);
        for (const m of w.manor?.missions ?? []) {
          if (m.kind !== 'army') continue;
          const a = w.agents.find((a) => a.id === m.agentId)!;
          if (a.dead || a.away || a.action?.kind !== 'walk' || a.task?.kind !== 'attack') continue;
          const victim = assignments.get(a.id);
          if (
            !victim ||
            a.task.target !== `agent:${victim.id}` ||
            distance(a.motion!.points.at(-1)!, position(victim, w.time)) > 6
          )
            this.stop(a);
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
            const cfg = w.manor?.settings;
            const n =
              (f.yieldKg ?? 30 * RATION) *
              Math.min(1, f.work / f.required) *
              (cfg
                ? cfg.shockDay > 0 && day >= cfg.shockDay
                  ? cfg.yieldMultiplier
                  : 1
                : day >= 40
                  ? 0.5
                  : 1);
            f.harvest += n;
            f.work = 0;
            grown += n;
          }
          w.ledger.grown += grown;
          w.resourceVersion++;
          this.emit('season', `月末成熟 ${grown.toFixed(2)} kg 谷物`);
        }
        if (w.manor) {
          for (const note of royalDay(w, day)) this.emit('royal', note);
          for (const m of w.manor.missions)
            if (m.kind === 'army') {
              const soldier = w.agents.find((a) => a.id === m.agentId)!;
              if (!soldier.dead) {
                const n = Math.max(0, 10 * RATION - soldier.grain);
                soldier.grain += n;
                w.ledger.initial += n;
              }
            }
        }
        if (w.mode === 'scripted' && !w.manor)
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
      this.returnPaidMessengers();
      this.wakeBlocked();
      if (w.status === 'running') for (const a of w.agents) this.ensureAction(a);
    }
  }
}
