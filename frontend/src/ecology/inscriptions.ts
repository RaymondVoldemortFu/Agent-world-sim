import type { World, Agent } from '../sim/types';
import type { Tx } from '../sim/transaction';
import { ecoAt } from './world';
import { batch, put, consume, capability, wear } from './batches';
import type { Batch, Inscription } from './types';
import { BUILDINGS } from './catalog';

export const inscriptionRecords = (b: Batch): Inscription[] => [
  ...(b.inscription ? [b.inscription] : []),
  ...(b.pages ?? []),
];

// A closed book is visible as an object, but its text requires possession or a deliberate showing.
export function concealLedgerPages(b: Batch): Batch {
  const copy = structuredClone(b);
  if (copy.item === 'personal_ledger') delete copy.pages;
  return copy;
}
function heldLedger(a: Agent, id?: string): Batch {
  const book = a.eco!.stock.find(
    (b) => b.id === id && b.item === 'personal_ledger' && b.kg >= 1 - 1e-7,
  );
  if (!book) throw Error('必须实际持有完整个人账簿，id填写背包中的账簿实物ID');
  return book;
}
function rememberInscription(w: World, tx: Tx, a: Agent, record: Inscription, shownBy?: Agent) {
  tx.tell(
    a,
    `${shownBy ? `#${shownBy.id} 向你展示个人账簿 ${record.carrierId}：` : '读到'}${record.authorName} #${record.authorId} 在第${record.day}天写下的铭文 ${record.id}：“${record.text}”（作者记述，是否属实或得到他人同意须另行核实）`,
    'observed',
    shownBy?.id,
    8,
  );
  a.brain!.readInscriptions = [...new Set([...(a.brain!.readInscriptions ?? []), record.id])];
}
export function writeLedger(
  w: World,
  tx: Tx,
  a: Agent,
  id: string | undefined,
  text: string,
): string {
  const book = heldLedger(a, id);
  if (!text.trim() || text.length > 240) throw Error('账簿记录需要1–240字');
  tx.a(a);
  const record: Inscription = {
    id: `inscription-${w.ecology!.nextId++}`,
    carrierId: book.id,
    authorId: a.id,
    authorName: a.name,
    day: w.tick,
    eventSeq: w.seq + 1,
    text: text.trim(),
  };
  book.pages = [...(book.pages ?? []), record];
  rememberInscription(w, tx, a, record);
  // Neighbors can observe writing, but do not receive the private text.
  return `向个人账簿 ${book.id} 追加第${book.pages.length}条记录，账簿仍在手中`;
}
export function showLedger(
  w: World,
  tx: Tx,
  a: Agent,
  id: string | undefined,
  targetId?: number,
): string {
  const book = heldLedger(a, id);
  const target = w.agents.find(
    (b) =>
      b.id === targetId &&
      b.id !== a.id &&
      !b.death &&
      !b.away &&
      b.eco!.region === a.eco!.region &&
      Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) <= 1,
  );
  if (!target) throw Error('展示对象必须是一格内另一位活着的居民');
  for (const record of book.pages ?? []) rememberInscription(w, tx, target, record, a);
  if (!book.pages?.length)
    tx.tell(target, `#${a.id} 向你展示了空白个人账簿 ${book.id}`, 'observed', a.id, 5);
  return `向 #${target.id} 展示个人账簿 ${book.id} 当前${book.pages?.length ?? 0}条记录，仍自行持有`;
}

export function visibleInscriptions(w: World, a: Agent): Inscription[] {
  const t = ecoAt(w, a.x, a.y, a.eco!.region).eco!;
  const records = [
    ...a.eco!.stock,
    ...t.ground.filter((b) => b.item !== 'personal_ledger'),
    ...t.structures
      .filter((s) => s.condition > 0.2)
      .flatMap((s) => s.contents)
      .filter((b) => b.item !== 'personal_ledger'),
  ]
    .filter((b) => b.kg + 1e-7 >= (b.item === 'inscribed_stone' ? 2 : 1))
    .flatMap(inscriptionRecords);
  return [...new Map(records.map((r) => [r.id, r])).values()];
}
export function readInscriptions(w: World, tx: Tx, a: Agent) {
  if (a.death) return;
  const fresh = visibleInscriptions(w, a).filter((r) => !a.brain!.readInscriptions?.includes(r.id));
  if (!fresh.length) return;
  tx.a(a);
  for (const record of fresh) rememberInscription(w, tx, a, record);
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
