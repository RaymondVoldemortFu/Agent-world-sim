import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld } from '../src/sim/world';
import { ConfigSchema, DEFAULT_CONFIG } from '../src/sim/types';
import { ecoAt } from '../src/ecology/world';
import { observeEco } from '../src/ecology/engine';
import { compactContext } from '../src/brain/controller';
import { batch, take, put } from '../src/ecology/batches';
import { BUILDINGS } from '../src/ecology/catalog';
import { worldInscriptions } from '../src/ui/inscriptions-data';

describe('per-experiment context window', () => {
  it('validates bounds and carries the saved value into model policy', () => {
    for (const n of [3999, 262145, 16000.5, NaN])
      expect(ConfigSchema.safeParse({ ...DEFAULT_CONFIG, contextWindow: n }).success).toBe(false);
    const w = createWorld({ worldModel: 'ecology', contextWindow: 32768 }, 'window-test');
    expect(w.config.contextWindow).toBe(32768);
    expect(compactContext(observeEco(w, w.agents[0])).policy.contextWindow).toBe(32768);
    const restored = JSON.parse(JSON.stringify(w));
    expect(compactContext(observeEco(restored, restored.agents[0])).policy.contextWindow).toBe(
      32768,
    );
    delete restored.config.contextWindow;
    expect(
      compactContext(observeEco(restored, restored.agents[0])).policy.contextWindow,
    ).toBeUndefined();
    expect(w.config.contextWindow).toBe(32768);
  });
});

describe('physical inscription catalogue', () => {
  it('tracks transport and split fragments, preserves authorship and reflects destruction at each replay boundary', () => {
    const w = createWorld({ worldModel: 'ecology', population: 2, regions: 1 }, 'writing-test');
    const t = ecoAt(w, 5, 5).eco!;
    const record = {
      id: 'writing-1',
      authorId: 1,
      authorName: '旧名',
      day: 1,
      eventSeq: 2,
      text: '轮班约定 <script>文本</script>',
    };
    t.ground.push({
      ...batch('inscribed_stone', 2, 1, 'stone-board', 'test'),
      inscription: record,
    });
    t.structures.push({
      id: 'store',
      kind: 'granary',
      progress: BUILDINGS.granary.minutes,
      condition: 1,
      contents: [],
    });
    put(w.agents[1].eco!.stock, take(t.ground, 'inscribed_stone', 0.5));
    put(t.structures[0].contents, take(t.ground, 'inscribed_stone', 0.5));
    w.agents[0].name = '新名';
    const saved = structuredClone(w),
      before = hashWorld(w);
    const entries = worldInscriptions(w);
    expect(entries).toHaveLength(1);
    expect(entries[0].record.authorName).toBe('旧名');
    expect(entries[0].locations.map((l) => l.kind).sort()).toEqual(['bag', 'ground', 'storage']);
    expect(entries[0].locations.every((l) => !l.readable)).toBe(true);
    expect(entries[0].locations.find((l) => l.kind === 'bag')!.label).toContain('#2');
    expect(hashWorld(w)).toBe(before);
    t.ground = [];
    t.structures[0].contents = [];
    w.agents[1].eco!.stock = w.agents[1].eco!.stock.filter((b) => !b.inscription);
    expect(worldInscriptions(w)).toEqual([]);
    expect(worldInscriptions(saved)[0].record.text).toBe(record.text);
    expect(worldInscriptions()).toEqual([]);
    expect(worldInscriptions(createWorld({ worldModel: 'legacy' }))).toEqual([]);
  });
});
