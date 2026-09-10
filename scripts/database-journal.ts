import { gzipSync } from 'node:zlib';
import type { World, WorldEvent, DecisionRecord } from '../frontend/src/sim/types';

export class DatabaseJournal {
  private entries: { event: WorldEvent; record?: DecisionRecord }[] = [];
  private expected = 0;
  readonly pending = new Map<string, DecisionRecord>();
  constructor(
    readonly name: string,
    private base: string,
  ) {}
  async request(route = '', data?: unknown): Promise<any> {
    const body = data === undefined ? undefined : gzipSync(JSON.stringify(data));
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(
          `${this.base}/api/storage/${encodeURIComponent(this.name)}${route}`,
          {
            method: data === undefined ? 'GET' : 'POST',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } : {},
            body,
            signal: AbortSignal.timeout(120000),
          },
        );
        if (res.status === 404 && !data) return undefined;
        if (!res.ok) {
          const detail = await res.text();
          if (res.status < 500) throw Object.assign(new Error(detail), { permanent: true });
          throw new Error(`Storage HTTP ${res.status}: ${detail}`);
        }
        return await res.json();
      } catch (e) {
        if ((e as { permanent?: boolean }).permanent || attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  async restore() {
    const c = await this.request();
    if (c) {
      this.expected = c.world.seq;
      for (const r of await this.request('/pending')) this.pending.set(r.id, r);
    }
    return c as { world: World; elapsedMs: number } | undefined;
  }
  async initialize(world: World) {
    await this.request('/initialize', { world, elapsedMs: 0 });
    this.expected = world.seq;
  }
  async savePending(r: DecisionRecord) {
    await this.request('/pending', r);
    this.pending.set(r.id, structuredClone(r));
  }
  async append(
    world: World,
    event: WorldEvent,
    record: DecisionRecord | undefined,
    elapsedMs: number,
  ) {
    this.entries.push({ event, record });
    // Bound memory, recovery window, and UI lag. No full checkpoint written per action.
    if (this.entries.length >= 50 || event.type === 'day_end') await this.flush(world, elapsedMs);
  }
  async flush(world: World, elapsedMs: number) {
    if (!this.entries.length) return;
    // Legacy nextTask advances cursor before deciding; checkpoint the latest event boundary.
    const committedWorld = { ...world, ...this.entries.at(-1)!.event.patch.meta };
    await this.request('/commit', {
      expected: this.expected,
      checkpoint: { world: committedWorld, elapsedMs },
      entries: this.entries,
    });
    this.expected = committedWorld.seq;
    for (const e of this.entries) if (e.record) this.pending.delete(e.record.id);
    this.entries = [];
  }
  async metadata(key: string, value: unknown) {
    await this.request('/metadata', { key, value });
  }
}
