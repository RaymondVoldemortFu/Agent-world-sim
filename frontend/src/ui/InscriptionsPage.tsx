import { useEffect, useMemo, useState } from 'react';
import type { World } from '../sim/types';
import { ITEMS } from '../ecology/catalog';
import { worldInscriptions } from './inscriptions-data';

const PAGE_SIZE = 50;
export default function InscriptionsPage({
  world: w,
  historical,
}: {
  world?: World;
  historical: boolean;
}) {
  const [query, setQuery] = useState(''),
    [author, setAuthor] = useState(''),
    [material, setMaterial] = useState(''),
    [location, setLocation] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [page, setPage] = useState(0);
  const rows = useMemo(() => worldInscriptions(w), [w]);
  const authors = useMemo(
    () =>
      [...new Map(rows.map((r) => [r.record.authorId, r.record.authorName])).entries()].sort(
        (a, b) => a[0] - b[0],
      ),
    [rows],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return rows.filter(
      (r) =>
        (!author || String(r.record.authorId) === author) &&
        (!material || r.item === material) &&
        (!location || r.locations.some((l) => l.kind === location)) &&
        (!start || r.record.day >= Number(start)) &&
        (!end || r.record.day <= Number(end)) &&
        (!q ||
          [
            r.record.text,
            r.record.authorName,
            r.record.authorId,
            r.record.id,
            ...r.locations.map(
              (l) => `${l.label} ${w?.ecology?.regionNames[l.region] ?? l.region} (${l.x},${l.y})`,
            ),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(q)),
    );
  }, [rows, query, author, material, location, start, end, w]);
  useEffect(() => setPage(0), [query, author, material, location, start, end, w?.id]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    current = Math.min(page, pages - 1);
  return (
    <section className="data-page inscriptions-page" aria-label="铭文档案">
      <div className="data-heading">
        <div>
          <p className="eyebrow">WRITTEN RECORDS</p>
          <h2>铭文</h2>
          <p className="muted">
            查看世界中留存的文字、原作者与载体去向。文字是作者的记述，不代表全体居民同意。
          </p>
        </div>
        {w && (
          <div className="data-season">
            第 {w.tick} 天
            <small>
              {historical ? '历史回放' : '当前世界'} · E{w.seq}
            </small>
          </div>
        )}
      </div>
      {!w ? (
        <p className="note">加载或开始一个实验后查看铭文。</p>
      ) : !w.ecology ? (
        <p className="note">生态世界支持木板、石板刻字。</p>
      ) : (
        <>
          <div className="data-cards">
            {[
              ['留存铭文', rows.length],
              ['书写者', authors.length],
              ['账簿记录', rows.filter((r) => r.item === 'personal_ledger').length],
              ['木板铭文', rows.filter((r) => r.item === 'inscribed_wood').length],
              ['石板铭文', rows.filter((r) => r.item === 'inscribed_stone').length],
            ].map(([name, n]) => (
              <div className="data-card" key={name}>
                <span>{name}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <div className="experience-filters">
            <label>
              搜索铭文
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="正文、作者、持有人或位置"
              />
            </label>
            <label>
              书写者
              <select value={author} onChange={(e) => setAuthor(e.target.value)}>
                <option value="">全部作者</option>
                {authors.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name} #{id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              载体
              <select value={material} onChange={(e) => setMaterial(e.target.value)}>
                <option value="">全部载体</option>
                <option value="inscribed_wood">木板</option>
                <option value="inscribed_stone">石板</option>
                <option value="personal_ledger">个人账簿</option>
              </select>
            </label>
            <label>
              存放处
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">全部位置</option>
                <option value="ground">地面</option>
                <option value="bag">居民背包</option>
                <option value="storage">设施库存</option>
              </select>
            </label>
            <label>
              刻写起始日
              <input
                type="number"
                min="1"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              刻写结束日
              <input type="number" min="1" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <button
              onClick={() => {
                setQuery('');
                setAuthor('');
                setMaterial('');
                setLocation('');
                setStart('');
                setEnd('');
              }}
            >
              重置筛选
            </button>
          </div>
          <p className="muted" aria-live="polite">
            共 {filtered.length} 篇符合条件的铭文 · 按刻写时间倒序
          </p>
          <div className="experience-list">
            {filtered
              .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
              .map(({ record, item, locations }) => (
                <article className="experience-row inscription-card" key={record.id}>
                  <div className="experience-meta">
                    <strong>{ITEMS[item]?.name ?? item}</strong>
                    <span>
                      第 {record.day} 天 · E{record.eventSeq}
                    </span>
                    <span>{record.id}</span>
                  </div>
                  <h3>
                    {record.authorName} #{record.authorId} 刻写
                  </h3>
                  <p className="inscription-text">{record.text}</p>
                  <ul className="inscription-locations">
                    {locations.map((l) => (
                      <li key={l.key}>
                        {w.ecology!.regionNames[l.region] ?? `区域 ${l.region}`} ({l.x},{l.y}) ·{' '}
                        {l.label} · {l.kg.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} kg
                        {l.readable ? '' : ' · 残片（不足一块）'}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
          </div>
          {!filtered.length && (
            <p className="note">
              {rows.length
                ? '没有匹配的铭文，试试调整筛选。'
                : '当前快照没有留存铭文。Agent 刻字后会在这里显示。'}
            </p>
          )}
          <div className="panel-toolbar inscription-pagination">
            <button disabled={current === 0} onClick={() => setPage(current - 1)}>
              上一页
            </button>
            <span>
              第 {current + 1} / {pages} 页
            </span>
            <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              下一页
            </button>
          </div>
          <p className="muted">
            已销毁的载体不在当前清单中；在世界页切换历史回放后，可查看当时留存的铭文。背包中的文字也会显示在此查看页，Agent
            的实际阅读仍受位置限制。
          </p>
        </>
      )}
    </section>
  );
}
