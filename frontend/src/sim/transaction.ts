import type { World, Agent, Memory, Patch, WorldEvent, Item } from './types';
import { add } from './world';
import { validateFood, mergeFood } from './food';
export class Tx {
  private memoryIndex = 0;
  agents = new Set<number>();
  tiles = new Set<number>();
  recipients: number[] = [];
  before = new Map<number, Agent>();
  initialIds: Set<number>;
  constructor(public w: World) {
    this.initialIds = new Set(w.agents.map((a) => a.id));
  }
  a(a: Agent) {
    if (!this.before.has(a.id)) this.before.set(a.id, structuredClone(a));
    this.agents.add(a.id);
    return a;
  }
  t(x: number, y: number, region = 0) {
    const t =
      this.w.tiles[region * this.w.config.size * this.w.config.size + y * this.w.config.size + x];
    this.tiles.add(region * this.w.config.size * this.w.config.size + y * this.w.config.size + x);
    return t;
  }
  tell(
    a: Agent,
    text: string,
    source: Memory['source'] = 'observed',
    speakerId?: number,
    importance = 2,
  ) {
    this.a(a);
    const m: Memory = {
      id: `${this.w.seq + 1}:${a.id}:${this.memoryIndex++}`,
      day: this.w.tick,
      content: text,
      source,
      eventIds: [this.w.seq + 1],
      speakerId,
      importance,
    };
    a.memories.push(m);
    a.inbox.push(m);
    a.inbox = a.inbox.slice(-12);
    a.memories = a.memories.slice(-200);
    if (!this.recipients.includes(a.id)) this.recipients.push(a.id);
  }
  die(a: Agent, cause: string) {
    if (a.death) return;
    this.a(a);
    a.hp = 0;
    a.ap = 0;
    a.death = { day: this.w.tick, cause };
    if (['mvp-1.6.0', 'mvp-1.7.0'].includes(this.w.rulesVersion))
      a.corpse = { x: a.x, y: a.y, sinceDay: this.w.tick };
    const t = this.t(a.x, a.y);
    validateFood(a.inventory, a.foodBatches);
    validateFood(t.ground, t.groundFoodBatches);
    t.groundFoodBatches = mergeFood(t.groundFoodBatches, a.foodBatches);
    for (const [k, v] of Object.entries(a.inventory)) add(t.ground, k as Item, v!);
    a.inventory = {};
    a.foodBatches = [];
    a.pregnancy = undefined;
    this.w.counters.deaths++;
  }
  finish(
    type: string,
    text: string,
    decisionId: string,
    success: boolean,
    actor?: Agent,
    targetId?: number,
    metricChange = false,
  ): WorldEvent {
    const w = this.w,
      day = w.tick,
      round = w.cursor.round;
    w.seq++;
    w.lastEvent = text;
    const { agents, tiles, proposals, metrics, ...meta } = w;
    const changed = agents.filter((a) => this.agents.has(a.id));
    const delta = (before: Memory[], after: Memory[]) => {
      const oldIds = new Set(before.map((m) => m.id)),
        newIds = new Set(after.map((m) => m.id));
      return {
        drop: before.filter((m) => !newIds.has(m.id)).length,
        append: after.filter((m) => !oldIds.has(m.id)),
      };
    };
    const patch: Patch = {
      agents: changed.filter((a) => !this.initialIds.has(a.id)),
      agentChanges: changed
        .filter((a) => this.initialIds.has(a.id))
        .map((a) => {
          const before = this.before.get(a.id)!;
          const { memories, inbox, claims, ...state } = a;
          return {
            state,
            memories: delta(before.memories, memories),
            inbox: delta(before.inbox, inbox),
            claims: delta(before.claims, claims),
          };
        }),
      tiles: [...this.tiles].map((i) => tiles[i]),
      proposals,
      meta,
      ...(metricChange ? { metrics } : {}),
    };
    return structuredClone({
      seq: w.seq,
      day,
      round,
      type,
      actorId: actor?.id,
      targetId,
      position: actor ? [actor.x, actor.y] : undefined,
      text,
      success,
      decisionId,
      recipients: this.recipients,
      patch,
    });
  }
}
