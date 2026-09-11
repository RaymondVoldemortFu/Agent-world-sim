import AgentDecisionHistory from './AgentDecisionHistory';
import { useState } from 'react';
import type { World } from '../sim/types';
import { quantity } from '../ecology/batches';
import { RATION_KG } from '../manor/world';
import ManorMap from './ManorMap';
const num = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const KINDS = {
  green: '草地',
  road: '道路',
  plaza: '广场',
  house: '小屋',
  field: '农田',
  keep: '庄园大厅',
  gate: '庄园入口',
  wall: '石墙',
  store: '粮仓',
  smithy: '工棚',
  well: '井',
};
export default function ManorDashboard({
  world: w,
  externalName,
  onInspect,
  historical,
}: {
  world: World;
  externalName?: string;
  onInspect?: (id: string) => Promise<boolean>;
  historical?: boolean;
}) {
  const [pos, setPos] = useState<[number, number]>([9, 10]),
    [person, setPerson] = useState<number>(1),
    [panel, setPanel] = useState<'decisions' | 'tile'>('decisions');
  const m = w.manor!,
    t = w.tiles[pos[1] * w.config.size + pos[0]],
    people = w.agents.filter((a) => !a.away && a.x === pos[0] && a.y === pos[1]);
  const a = w.agents.find((a) => a.id === person) ?? people[0];
  const stores = w.tiles
    .flatMap((t) => t.eco!.structures.map((s) => ({ t, s })))
    .filter(({ s }) => s.kind === 'granary');
  const grain =
    stores.reduce((n, { s }) => n + quantity(s.contents, 'grain'), 0) +
    w.agents.filter((a) => !a.away).reduce((n, a) => n + quantity(a.eco!.stock, 'grain'), 0);
  const living = w.agents.filter(
    (a) => !a.death && !a.away && !m.missions.some((x) => x.agentId === a.id),
  );
  return (
    <section className="manor-dashboard">
      <header className="manor-heading">
        <div>
          <small>领地实验 / THE MANOR</small>
          <h2>鸦溪 · 收成与王税</h2>
          <p>家庭、广场与庄园之间，粮食正在决定秩序。</p>
        </div>
        <div className="manor-day">
          <strong>{w.tick}</strong>
          <span>DAY / {w.config.days}</span>
        </div>
      </header>
      <div className="manor-kpis">
        {[
          ['本地居民', `${living.length} / 31`],
          ['境内储粮', `${num(grain / RATION_KG)} 人日`],
          ['下次成熟', `第 ${Math.ceil(w.tick / 30) * 30} 天`],
          ['作物产能', m.shock ? `${m.settings.yieldMultiplier * 100}%` : '100%'],
          ['王室欠税', `${num(m.king.arrears)} 人日`],
          [
            '王室状态',
            { collecting: '等待缴税', warning: '欠税催缴', expedition: '征缴远征' }[m.king.phase],
          ],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <div className="manor-layout">
        <ManorMap
          world={w}
          selected={pos}
          onSelect={(p) => {
            setPos(p);
            const resident = w.agents.find((a) => !a.away && a.x === p[0] && a.y === p[1]);
            if (resident) {
              setPerson(resident.id);
              setPanel('decisions');
            } else setPanel('tile');
          }}
        />
        <aside className="manor-inspector">
          <div className="manor-inspector-controls">
            <label>
              查看居民
              <select
                aria-label="地图右侧居民"
                value={a?.id ?? person}
                onChange={(e) => {
                  setPerson(Number(e.target.value));
                  setPanel('decisions');
                }}
              >
                {w.agents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} #{p.id}
                    {p.death ? ' · 已死亡' : p.away ? ' · 已离开' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                if (a) setPos([a.x, a.y]);
              }}
            >
              定位
            </button>
          </div>
          <div className="manor-panel-tabs">
            <button
              className={panel === 'decisions' ? 'active' : ''}
              onClick={() => setPanel('decisions')}
            >
              决策历史
            </button>
            <button className={panel === 'tile' ? 'active' : ''} onClick={() => setPanel('tile')}>
              地块与物资
            </button>
          </div>
          {panel === 'decisions' && a && (
            <>
              <h3>
                {a.name} #{a.id}
              </h3>
              <p>
                生命 {num(a.hp)} · 饱食 {num(a.hunger)} · 随身谷物{' '}
                {num(quantity(a.eco!.stock, 'grain'))}kg
              </p>
              <p className="manor-muted">{a.brain?.goalBlocked}</p>
              <AgentDecisionHistory
                key={`${w.id}:${externalName}:${a.id}:${historical ? w.seq : 'live'}`}
                world={w}
                agentId={a.id}
                externalName={externalName}
                onInspect={onInspect}
                historical={historical}
              />
            </>
          )}
          <div hidden={panel !== 'tile'}>
            <small>地块观察 / {pos.join(', ')}</small>
            <h3>{t.manor!.label ?? KINDS[t.manor!.kind]}</h3>
            {t.manor!.lock && (
              <p>
                入口{t.manor!.lock.locked && t.manor!.lock.hp > 0 ? '已锁' : '开放'} · 强度{' '}
                {t.manor!.lock.hp} · 钥匙 {t.manor!.lock.key}
              </p>
            )}
            {t.manor!.plot && (
              <>
                <p>
                  {t.manor!.plot.id} · 本月劳动 {num(t.manor!.plot.work)} / {t.manor!.plot.required}{' '}
                  分钟
                </p>
                <progress value={t.manor!.plot.work} max={t.manor!.plot.required} />
                <p>待收割 {num(t.manor!.plot.harvest)} kg</p>
              </>
            )}
            {t.eco!.structures.map((s) => (
              <div key={s.id}>
                <h4>{s.id}</h4>
                {s.contents.length ? (
                  s.contents.map((b) => (
                    <span className="manor-chip" key={b.id}>
                      {b.item} {num(b.kg)}kg
                    </span>
                  ))
                ) : (
                  <p>空</p>
                )}
              </div>
            ))}
            <h4>此处居民 · {people.length}</h4>
            <div className="manor-people">
              {people.map((p) => (
                <button
                  className={a?.id === p.id ? 'active' : ''}
                  key={p.id}
                  onClick={() => {
                    setPerson(p.id);
                    setPanel('decisions');
                  }}
                >
                  {p.name} #{p.id}
                  {p.death ? ' †' : ''}
                </button>
              ))}
            </div>
            {a && (
              <>
                <h3>{a.name}</h3>
                <p>
                  生命 {num(a.hp)} · 饱食 {num(a.hunger)}
                </p>
                <progress value={a.hp} max={100} />
                <p>{a.intent || '尚未行动'}</p>
                <p className="manor-muted">{a.brain?.goalBlocked}</p>
                <details>
                  <summary>角色初始认知</summary>
                  <p>{a.residence?.biography}</p>
                </details>
                <h4>最近经历</h4>
                {a.memories
                  .slice(-4)
                  .reverse()
                  .map((x) => (
                    <p className="manor-memory" key={x.id}>
                      D{x.day} · {x.content}
                    </p>
                  ))}
              </>
            )}
          </div>
        </aside>
      </div>
      <div className="manor-bottom">
        <section>
          <h3>储粮分布</h3>
          <p className="manor-muted">观察者视角；Agent 只能看到自己可及的实物。</p>
          {stores
            .filter(({ s }) => s.id !== 'workshop')
            .map(({ s, t }) => (
              <button className="manor-stock-row" key={s.id} onClick={() => setPos([t.x, t.y])}>
                <span>{t.manor!.label ?? s.id}</span>
                <progress
                  value={quantity(s.contents, 'grain')}
                  max={Math.max(1, ...stores.map(({ s }) => quantity(s.contents, 'grain')))}
                />
                <b>{num(quantity(s.contents, 'grain') / RATION_KG)} 人日</b>
              </button>
            ))}
        </section>
        <section>
          <h3>王室与收成记录</h3>
          <p>
            下次税期 D{m.king.dueDay} · 实收累计 {num(m.king.totalReceived)} 人日粮
          </p>
          {m.king.rebellion && (
            <p className="manor-alert">
              王室认定：{m.king.rebellion.reason} · 来源：{m.king.rebellion.source}
            </p>
          )}
          {m.history
            .slice(-8)
            .reverse()
            .map((e, i) => (
              <p className="manor-memory" key={i}>
                <b>D{e.day}</b> {e.text}
              </p>
            ))}
          {!m.history.length && <p className="manor-muted">王室等待第一次收成后的贡粮。</p>}
        </section>
      </div>
    </section>
  );
}
