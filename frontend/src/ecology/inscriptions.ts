import type { World, Agent } from '../sim/types';
import type { Tx } from '../sim/transaction';
import { ecoAt } from './world';
import { batch, put, consume, capability, wear } from './batches';
import type { Inscription } from './types';
import { BUILDINGS } from './catalog';

export function visibleInscriptions(w: World, a: Agent): Inscription[] {
  const t = ecoAt(w, a.x, a.y, a.eco!.region).eco!;
  const records = [
    ...a.eco!.stock,
    ...t.ground,
    ...t.structures.filter((s) => s.condition > 0.2).flatMap((s) => s.contents),
  ]
    .filter((b) => b.inscription && b.kg + 1e-7 >= (b.item === 'inscribed_stone' ? 2 : 1))
    .map((b) => b.inscription!);
  return [...new Map(records.map((r) => [r.id, r])).values()];
}
export function readInscriptions(w: World, tx: Tx, a: Agent) {
  if (a.death) return;
  const fresh = visibleInscriptions(w, a).filter((r) => !a.brain!.readInscriptions?.includes(r.id));
  if (!fresh.length) return;
  tx.a(a);
  for (const record of fresh)
    tx.tell(
      a,
      `读到${record.authorName} #${record.authorId} 在第${record.day}天刻下的铭文 ${record.id}：“${record.text}”（作者记述，是否得到他人同意须另行核实）`,
      'observed',
      undefined,
      8,
    );
  a.brain!.readInscriptions = [...(a.brain!.readInscriptions ?? []), ...fresh.map((r) => r.id)];
}
export function inscribe(w: World, tx: Tx, a: Agent, item: string, text: string) {
  if (!['wood_tablet', 'stone_tablet'].includes(item) || !text?.trim() || text.length > 240)
    throw Error('刻字需要空白木板或石板及1–240字的内容');
  const t = ecoAt(w, a.x, a.y, a.eco!.region).eco!;
  const stores = [
    a.eco!.stock,
    t.ground,
    ...t.structures.filter((s) => s.condition > 0.2).map((s) => s.contents),
  ];
  if (capability(stores, 'cutting') <= 0) throw Error('刻字需要完整的石片或其他切削工具');
  if (item === 'stone_tablet' && capability(stores, 'hammer') <= 0)
    throw Error('石板刻字还需要锤击工具');
  tx.a(a);
  tx.t(a.x, a.y, a.eco!.region);
  const kg = item === 'stone_tablet' ? 2 : 1;
  consume(stores, { [item]: kg });
  wear(stores, 'cutting', item === 'stone_tablet' ? 120 : 60);
  if (item === 'stone_tablet') wear(stores, 'hammer', 120);
  const id = `inscription-${w.ecology!.nextId++}`;
  const record: Inscription = {
    id,
    authorId: a.id,
    authorName: a.name,
    day: w.tick,
    eventSeq: w.seq + 1,
    text: text.trim(),
  };
  const board = t.structures.find(
    (s) =>
      s.kind === 'noticeboard' && s.condition > 0.2 && s.progress >= BUILDINGS.noticeboard.minutes,
  );
  put(board ? board.contents : t.ground, [
    {
      ...batch(
        item === 'stone_tablet' ? 'inscribed_stone' : 'inscribed_wood',
        kg,
        w.tick,
        id,
        '刻字',
      ),
      inscription: record,
    },
  ]);
  for (const b of w.agents)
    if (!b.death && b.eco!.region === a.eco!.region && b.x === a.x && b.y === a.y)
      readInscriptions(w, tx, b);
  return `在${item === 'stone_tablet' ? '石板' : '木板'}上刻下 ${id}：“${record.text}”，${board ? '留在告示板' : '置于地面'}供人阅读`;
}
