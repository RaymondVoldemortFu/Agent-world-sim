import { useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import type { World, WorldEvent, Agent, Inventory, Config, DecisionRecord } from '../sim/types';
import { DEFAULT_CONFIG } from '../sim/types';
import { db } from '../runtime/store';
import Map from './Map';
import { eventNames, matchesEvent } from '../runtime/event-search';
const names: Record<string, string> = {
  food: '食物',
  wood: '木材',
  stone: '石材',
  ore: '矿石',
  basic_tool: '基础工具',
  advanced_tool: '高级工具',
};
const fmt = (n: number) =>
  new Intl.NumberFormat('zh-CN', {
    notation: n >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(n);
function InventoryView({ value }: { value: Inventory }) {
  return (
    <div className="inventory">
      {Object.entries(value)
        .filter(([, n]) => n)
        .map(([k, n]) => (
          <span key={k}>
            {names[k] ?? k} <b>{n}</b>
          </span>
        ))}
      {!Object.values(value).some(Boolean) && <span className="muted">空</span>}
    </div>
  );
}
function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="meter">
      <label>
        {label}
        <b>
          {value}
          <small> / 100</small>
        </b>
      </label>
      <div>
        <i style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
export default function App() {
  const worker = useRef<Worker | null>(null),
    file = useRef<HTMLInputElement>(null);
  const [world, setWorld] = useState<World>(),
    [history, setHistory] = useState<World>(),
    [running, setRunning] = useState(false),
    [status, setStatus] = useState('正在读取本地记录…'),
    [error, setError] = useState('');
  const [model, setModel] = useState('连接中'),
    [selected, setSelected] = useState<[number, number] | null>(null),
    [focus, setFocus] = useState<[number, number]>(),
    [agentId, setAgentId] = useState<number>(),
    [tab, setTab] = useState('居民'),
    [layer, setLayer] = useState('terrain');
  const [events, setEvents] = useState<WorldEvent[]>([]),
    [eventType, setEventType] = useState(''),
    [query, setQuery] = useState(''),
    [settings, setSettings] = useState(false),
    [config, setConfig] = useState<Config>({ ...DEFAULT_CONFIG }),
    [decision, setDecision] = useState<DecisionRecord>(),
    [statsOpen, setStatsOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [replaySeq, setReplaySeq] = useState(0),
    [eventPage, setEventPage] = useState(120);
  const [eventsLoading, setEventsLoading] = useState(false),
    [eventsError, setEventsError] = useState(''),
    [hasMoreEvents, setHasMoreEvents] = useState(false);
  const [externalName, setExternalName] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get('experiment') ?? undefined,
  );
  const external = useRef(externalName);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archives, setArchives] = useState<
    {
      name: string;
      day: number;
      days: number;
      population: number;
      alive: number;
      model: string;
      complete: boolean;
    }[]
  >([]);
  const selectSource = (name?: string) => {
    external.current = name;
    setExternalName(name);
    setHistory(undefined);
    setAgentId(undefined);
    setSelected(null);
    setDecision(undefined);
    if (!name) {
      setWorld(undefined);
      setEvents([]);
      worker.current?.postMessage({ type: 'restore' });
    }
  };
  const send = (type: string, extra: Record<string, unknown> = {}) =>
    worker.current?.postMessage({ type, ...extra });
  useEffect(() => {
    const w = new Worker(new URL('../runtime/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === 'state') {
        if (external.current) return;
        setWorld(data.world);
        setRunning(data.running);
        setStatus(data.status);
        setHistory(undefined);
      } else if (data.type === 'progress') setStatus(data.status);
      else if (data.type === 'error') setError(data.message);
      else if (data.type === 'replay') setHistory(data.world);
      else if (data.type === 'export') {
        const blob = new Blob([JSON.stringify(data.bundle)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data.bundle.world.id}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    };
    w.postMessage({ type: 'restore' });
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => setModel(c.configured ? c.model : '密钥未配置'))
      .catch(() => setModel('后端未连接'));
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    setEventPage(120);
  }, [query, eventType, externalName, world?.id, history?.seq]);
  useEffect(() => {
    if (!world) return;
    let active = true;
    const controller = new AbortController();
    setEventsLoading(true);
    setEventsError('');
    const timer = setTimeout(async () => {
      try {
        const through = history?.seq ?? world.seq;
        let rows: WorldEvent[], hasMore: boolean;
        if (externalName) {
          const params = new URLSearchParams({
            q: query,
            event_type: eventType,
            limit: String(eventPage),
            through: String(through),
          });
          const res = await fetch(
            `/api/experiments/${encodeURIComponent(externalName)}/events?${params}`,
            { signal: controller.signal },
          );
          if (!res.ok) throw new Error('无法检索实验事件');
          const data = await res.json();
          rows = data.events;
          hasMore = data.hasMore;
        } else {
          const found = await db.events
            .where('[runId+seq]')
            .between([world.id, 0], [world.id, through], true, true)
            .reverse()
            .filter((e) => matchesEvent(e, query, eventType))
            .limit(eventPage + 1)
            .toArray();
          rows = found.slice(0, eventPage);
          hasMore = found.length > eventPage;
        }
        if (active) {
          setEvents(rows);
          setHasMoreEvents(hasMore);
        }
      } catch (e) {
        if (active) {
          setEvents([]);
          setHasMoreEvents(false);
          setEventsError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (active) setEventsLoading(false);
      }
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [world?.id, world?.seq, history?.seq, eventPage, externalName, query, eventType]);
  useEffect(() => {
    if (!externalName) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/experiments/${encodeURIComponent(externalName)}/snapshot`);
        if (!res.ok) throw new Error('无法读取该实验');
        const data = await res.json();
        if (active) {
          setWorld(data.world);
          setRunning(false);
          setStatus(
            `外部实验 · ${externalName} · ${data.world.cursor.phase === 'complete' ? '已完成' : '持续观察中'}`,
          );
        }
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) timer = setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [externalName]);
  useEffect(() => {
    if (archiveOpen)
      fetch('/api/experiments')
        .then((r) => r.json())
        .then(setArchives)
        .catch(() => setError('无法读取实验档案'));
  }, [archiveOpen]);
  const displayed = history ?? world;
  const living = displayed?.agents.filter((a) => !a.death) ?? [];
  const agent = displayed?.agents.find((a) => a.id === agentId);
  const tile =
    selected && displayed
      ? displayed.tiles[selected[1] * displayed.config.size + selected[0]]
      : undefined;
  const choose = (a: Agent) => {
    setAgentId(a.id);
    setSelected([a.x, a.y]);
    setFocus([a.x, a.y]);
    setTab('居民');
  };
  const inspect = async (e: WorldEvent) => {
    if (e.position) {
      setSelected(e.position);
      setFocus(e.position);
    }
    if (e.actorId) setAgentId(e.actorId);
    const r = externalName
      ? await fetch(
          `/api/experiments/${encodeURIComponent(externalName)}/decision?id=${encodeURIComponent(e.decisionId)}`,
        ).then((r) => (r.ok ? r.json() : undefined))
      : await db.decisions.get(e.decisionId);
    setDecision(r);
  };
  return (
    <div className="app-shell">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <h1>
              原野<span>AGENT WORLD</span>
            </h1>
            <p>一个正在发生的世界</p>
          </div>
        </div>
        <div className="header-center">
          <span className="live-dot" /> 自主演化实验 <span className="divider">/</span> MVP 01
        </div>
        <div className="header-actions">
          <button className="text-button" disabled={running} onClick={() => setArchiveOpen(true)}>
            实验档案 ↗
          </button>
          <span className="model-badge">
            <i /> {model}
          </span>
          <button className="icon-button" onClick={() => setSettings(true)} title="新建与实验设置">
            ⚙
          </button>
        </div>
      </header>
      <main>
        <section className="heading">
          <div>
            <p className="eyebrow">THE WORLD OBSERVATORY</p>
            <h2>
              观察秩序，如何生长<span>。</span>
            </h2>
            <p className="description">
              有限的资源，独立的意志。每一次行动，都成为这个世界的历史。
            </p>
          </div>
          <div className="day-counter">
            <span>{history ? '历史回放' : '世界时间'}</span>
            <strong>
              {String(displayed?.tick ?? 1).padStart(3, '0')}
              <small>天</small>
            </strong>
            <p>/ {world?.config.days ?? config.days} 天实验周期</p>
          </div>
        </section>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError('')}>关闭</button>
          </div>
        )}
        <section className="summary-grid">
          <div className="summary-card">
            <span>
              存活居民 <i>◉</i>
            </span>
            <strong>
              {living.length}
              <small>人</small>
            </strong>
            <p>
              {displayed?.config.population ?? 20} 位初始居民 <em>·</em>{' '}
              {displayed?.counters.births ?? 0} 次新生
            </p>
          </div>
          <div className="summary-card">
            <span>
              可用食物 <i>♧</i>
            </span>
            <strong>
              {fmt(
                living.reduce((n, a) => n + (a.inventory.food ?? 0), 0) +
                  (displayed?.tiles.reduce((n, t) => n + (t.ground.food ?? 0) + t.farmFood, 0) ??
                    0),
              )}
              <small>份</small>
            </strong>
            <p>背包、地面储备与农田收成</p>
          </div>
          <div className="summary-card">
            <span>
              交流记录 <i>◌</i>
            </span>
            <strong>
              {fmt(displayed?.counters.chats ?? 0)}
              <small>次</small>
            </strong>
            <p>每一次对话，都可能改变关系</p>
          </div>
          <div className="summary-card">
            <span>
              已开垦农田 <i>▧</i>
            </span>
            <strong>
              {displayed?.tiles.filter((t) => t.farm >= 3).length ?? 0}
              <small>块</small>
            </strong>
            <p>
              {displayed?.counters.discoveries ?? 0} 次配方发现 <em>·</em>{' '}
              {displayed?.tiles.filter((t) => t.shelter?.complete).length ?? 0} 座棚屋
            </p>
          </div>
        </section>
        <section className="workspace">
          <div className="world-panel">
            <div className="panel-toolbar">
              <div className="panel-title">
                <span className="live-dot" /> 世界地图{' '}
                <small>{history ? 'HISTORY' : running ? 'LIVE' : 'PAUSED'}</small>
              </div>
              <div className="segmented">
                <button
                  className={layer === 'terrain' ? 'active' : ''}
                  onClick={() => setLayer('terrain')}
                >
                  地形
                </button>
                <button
                  className={layer === 'food' ? 'active' : ''}
                  onClick={() => setLayer('food')}
                >
                  食物分布
                </button>
              </div>
            </div>
            {displayed ? (
              <Map
                world={displayed}
                selected={selected}
                onSelect={(p) => {
                  setSelected(p);
                  setTab('地块');
                }}
                layer={layer}
                focus={focus}
              />
            ) : (
              <div className="empty-map">
                <div className="contours" />
                <span>◈</span>
                <h3>给世界一个起点</h3>
                <p>
                  64 × 64 的原野，20 个独立的生命。
                  <br />
                  地形由种子生成，故事由他们决定。
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    external.current = undefined;
                    setExternalName(undefined);
                    send('create', { config });
                  }}
                >
                  生成世界 <span>↗</span>
                </button>
                <button className="text-button" onClick={() => setSettings(true)}>
                  调整初始条件
                </button>
              </div>
            )}
            <div className="map-footer">
              <div className="legend">
                <span>
                  <i style={{ background: '#40593d' }} />
                  平原
                </span>
                <span>
                  <i style={{ background: '#6b704a' }} />
                  丘陵
                </span>
                <span>
                  <i style={{ background: '#989787' }} />
                  高山
                </span>
                <span>
                  <i className="round" style={{ background: '#e8d5a0' }} />
                  居民
                </span>
              </div>
              <span>滚轮缩放 · 拖动探索 · 点击查看</span>
            </div>
            <div className="playback">
              <div className="playback-actions">
                <button
                  className="primary"
                  disabled={
                    !world || !!history || !!externalName || world?.cursor.phase === 'complete'
                  }
                  onClick={() => send(running ? 'pause' : 'run')}
                >
                  {running ? 'Ⅱ 暂停' : '▶ 开始演化'}
                </button>
                <button
                  disabled={
                    !world ||
                    running ||
                    !!history ||
                    !!externalName ||
                    world?.cursor.phase === 'complete'
                  }
                  onClick={() => send('step')}
                  title="执行一次决策或日末结算"
                >
                  单步 ▷
                </button>
                <button
                  disabled={!world || running || !!externalName}
                  onClick={() => {
                    setConfig({ ...world!.config });
                    setBudgetOpen(true);
                  }}
                >
                  预算
                </button>
                <select
                  aria-label="并发上限"
                  defaultValue="6"
                  disabled={!!externalName}
                  onChange={(e) => send('concurrency', { value: Number(e.target.value) })}
                >
                  {[1, 2, 4, 6, 8].map((n) => (
                    <option value={n} key={n}>
                      {n === 1 ? '串行' : `并发 ${n}`}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="播放速度"
                  defaultValue="50"
                  onChange={(e) => send('speed', { delay: Number(e.target.value) })}
                >
                  <option value="500">舒缓</option>
                  <option value="50">标准</option>
                  <option value="0">最快</option>
                </select>
              </div>
              <div className="run-status">
                <i className={running ? 'pulse' : ''} />
                <span>{status}</span>
              </div>
            </div>
          </div>
          <aside className="inspector">
            <div className="inspector-tabs">
              {['居民', '地块', '认知'].map((t) => (
                <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
              <span>观察者视图</span>
            </div>
            <div className="inspector-body">
              {tab === '居民' && (
                <>
                  {agent ? (
                    <>
                      <button className="back-button" onClick={() => setAgentId(undefined)}>
                        ← 全部居民
                      </button>
                      <div className="agent-heading">
                        <div className="avatar">{agent.name}</div>
                        <div>
                          <h3>
                            {agent.name} <small>#{agent.id}</small>
                          </h3>
                          <p>
                            {agent.sex === 'F' ? '女性' : '男性'} ·{' '}
                            {agent.age < displayed!.config.adultAge ? '幼年' : '成年'} · ({agent.x},{' '}
                            {agent.y}) {agent.death ? '· 已死亡' : ''}
                          </p>
                        </div>
                      </div>
                      <Meter label="生命" value={agent.hp} color="#8fbf8b" />
                      <Meter label="饱食度" value={agent.hunger} color="#d7bd79" />
                      <div className="section-label">当前打算</div>
                      <p className="intent">{agent.intent || '尚未开始决策。'}</p>
                      <div className="section-label">携带物品</div>
                      <InventoryView value={agent.inventory} />
                      <div className="section-label">性格倾向</div>
                      {['开放性', '尽责性', '外向性', '宜人性', '神经质'].map((p, i) => (
                        <div className="trait" key={p}>
                          <span>{p}</span>
                          <div>
                            <i style={{ width: `${agent.personality[i] * 100}%` }} />
                          </div>
                          <b>{Math.round(agent.personality[i] * 100)}</b>
                        </div>
                      ))}
                      <div className="section-label">已验证配方</div>
                      <p className="muted">
                        {agent.recipes.map((r) => names[r] ?? '棚屋').join('、') || '尚未发现'}
                      </p>
                      {agent.parents.length > 0 && (
                        <p className="muted">
                          生物学父母：{agent.parents.map((id) => `#${id}`).join('、')}
                        </p>
                      )}
                      {agent.pregnancy && (
                        <p className="muted">妊娠中，预计第 {agent.pregnancy.due} 天生产</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="section-label">
                        居民档案 <b>{living.length} 人存活</b>
                      </div>
                      <p className="muted small">选择一个人，查看他的经历与当下。</p>
                      <div className="agent-list">
                        {displayed?.agents.map((a) => (
                          <button
                            className={a.death ? 'dead' : ''}
                            key={a.id}
                            onClick={() => choose(a)}
                          >
                            <span className="mini-avatar">{a.name}</span>
                            <span>
                              <b>
                                {a.name} <small>#{a.id}</small>
                              </b>
                              <em>
                                {a.death
                                  ? `${a.death.cause}死亡`
                                  : a.hunger <= 20
                                    ? '饥饿 · 需要食物'
                                    : a.intent?.slice(0, 15) || '准备探索世界'}
                              </em>
                            </span>
                            <span className="agent-position">
                              {a.x}, {a.y} <i>↗</i>
                            </span>
                          </button>
                        ))}
                      </div>
                      {!displayed && (
                        <div className="inspector-empty">世界生成后，居民将在这里出现。</div>
                      )}
                    </>
                  )}
                </>
              )}
              {tab === '地块' && (
                <>
                  {tile ? (
                    <>
                      <div className="section-label">地块档案</div>
                      <h3 className="tile-title">
                        {{ plain: '平原', hill: '丘陵', mountain: '高山' }[tile.terrain]}{' '}
                        <small>
                          ({tile.x}, {tile.y})
                        </small>
                      </h3>
                      <div className="section-label">自然资源</div>
                      <InventoryView value={tile.resources} />
                      <div className="section-label">地面物品</div>
                      <InventoryView value={tile.ground} />
                      <div className="section-label">生产与建筑</div>
                      <p className="muted">
                        农田进度 {tile.farm}/3 · 可收获 {tile.farmFood} 份
                      </p>
                      <p className="muted">
                        {tile.shelter
                          ? `棚屋 ${tile.shelter.complete ? '已落成' : `施工中 (${tile.shelter.labor}/4)`}`
                          : '暂无建筑'}
                      </p>
                      <div className="section-label">此处居民</div>
                      {living
                        .filter((a) => a.x === tile.x && a.y === tile.y)
                        .map((a) => (
                          <button className="resident-link" key={a.id} onClick={() => choose(a)}>
                            {a.name} #{a.id} <span>查看 ↗</span>
                          </button>
                        ))}
                      <div className="note">物品的位置是物理事实；土地属于谁，由居民各自理解。</div>
                    </>
                  ) : (
                    <div className="inspector-empty">点击地图上的地块，查看资源与居民。</div>
                  )}
                </>
              )}
              {tab === '认知' && (
                <>
                  {agent ? (
                    <>
                      <div className="section-label">
                        {agent.name} #{agent.id} 的私有认知
                      </div>
                      <p className="muted small">主张记录角色的判断，并非世界裁定。</p>
                      <div className="section-label">社会主张</div>
                      {agent.claims.length ? (
                        agent.claims
                          .slice()
                          .reverse()
                          .map((m) => (
                            <div className="memory" key={m.id}>
                              <small>
                                第 {m.day} 天 · 自我归纳 · 来源 {m.eventIds.join(', ')}
                              </small>
                              <p>{m.content}</p>
                            </div>
                          ))
                      ) : (
                        <p className="muted">尚未形成记录。</p>
                      )}
                      <div className="section-label">近期记忆</div>
                      {agent.memories
                        .slice(-25)
                        .reverse()
                        .map((m) => (
                          <div className="memory" key={m.id}>
                            <small>
                              第 {m.day} 天 ·{' '}
                              {m.source === 'observed'
                                ? '亲历'
                                : m.source === 'heard'
                                  ? '听闻'
                                  : '自我归纳'}
                            </small>
                            <p>{m.content}</p>
                          </div>
                        ))}
                    </>
                  ) : (
                    <div className="inspector-empty">先选择一位居民，进入他的记忆。</div>
                  )}
                </>
              )}
            </div>
          </aside>
        </section>
        <section className="lower-grid">
          <div className="timeline-panel">
            <div className="panel-toolbar">
              <div className="panel-title">
                世界纪事 <small>{world?.seq ?? 0} EVENTS</small>
              </div>
              <div className="event-tools">
                <input
                  aria-label="搜索事件"
                  placeholder="搜索人物、地点或内容…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="事件类型"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                >
                  <option value="">全部事件</option>
                  {Object.entries(eventNames).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="timeline">
              {events.length ? (
                events.map((e) => (
                  <button
                    className={`event-row ${e.success ? '' : 'failed'}`}
                    key={e.seq}
                    onClick={() => inspect(e)}
                  >
                    <span className="event-day">
                      DAY {String(e.day).padStart(3, '0')}
                      <small>#{e.seq}</small>
                    </span>
                    <span className="event-type">{eventNames[e.type] ?? e.type}</span>
                    <span className="event-text">{e.text}</span>
                    <span className="event-arrow">↗</span>
                  </button>
                ))
              ) : (
                <div className="timeline-empty">
                  <span>⌁</span>
                  <p>
                    {eventsError ||
                      (eventsLoading
                        ? '正在检索历史…'
                        : query.trim() || eventType
                          ? '没有匹配的事件，试试其他关键词或类型。'
                          : '世界的第一段历史，等待发生。')}
                  </p>
                </div>
              )}
            </div>
            <div className="timeline-bottom">
              <button
                className="text-button"
                disabled={!world || eventsLoading || !hasMoreEvents}
                onClick={() => setEventPage((p) => p + 200)}
              >
                加载更早记录
              </button>
              <span>点击事件，查看当时的决策上下文</span>
            </div>
          </div>
          <div className="chart-panel">
            <div className="panel-toolbar">
              <div className="panel-title">生命的轨迹</div>
              <button className="text-button" onClick={() => setStatsOpen(true)}>
                统计详情 ↗
              </button>
            </div>
            <div className="chart-label">
              <span>存活人数</span>
              <strong>
                {living.length}
                <small>人</small>
              </strong>
            </div>
            <div className="chart">
              {displayed?.metrics.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={displayed.metrics}>
                    <defs>
                      <linearGradient id="pop" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#b9cf93" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#b9cf93" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#29372d" vertical={false} />
                    <XAxis
                      dataKey="day"
                      stroke="#748272"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#748272"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      width={25}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#1b271f',
                        border: '1px solid #3b4a3b',
                        borderRadius: 8,
                      }}
                      labelFormatter={(d) => `第 ${d} 天`}
                    />
                    <Area
                      type="monotone"
                      dataKey="alive"
                      name="存活"
                      stroke="#b9cf93"
                      fill="url(#pop)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="chart-placeholder">
                  <div />
                  <span>每日结算后生成趋势</span>
                </div>
              )}
            </div>
            <div className="usage-line">
              <span>
                模型调用 <b>{fmt(world?.usage.calls ?? 0)}</b>
              </span>
              <span>
                总 tokens{' '}
                <b>{fmt((world?.usage.inputTokens ?? 0) + (world?.usage.outputTokens ?? 0))}</b>
              </span>
            </div>
          </div>
        </section>
        <div className="history-bar">
          <span>◷ 历史回放</span>
          <input
            aria-label="历史事件序号"
            type="range"
            min="0"
            max={world?.seq ?? 0}
            value={history ? replaySeq : (world?.seq ?? 0)}
            disabled={running || !world || !!externalName}
            onChange={(e) => {
              setReplaySeq(Number(e.target.value));
              send('replay', { seq: Number(e.target.value) });
            }}
          />
          <button
            disabled={!history && !externalName}
            onClick={() => (externalName ? selectSource() : send('current'))}
          >
            返回当前
          </button>
          <button
            disabled={!world || running}
            onClick={() =>
              externalName
                ? window.open(
                    `/api/experiments/${encodeURIComponent(externalName)}/download`,
                    '_self',
                  )
                : send('export')
            }
          >
            导出记录 ↓
          </button>
          <button disabled={running} onClick={() => file.current?.click()}>
            导入 ↑
          </button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".json"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (f) {
                  external.current = undefined;
                  setExternalName(undefined);
                  send('import', { bundle: JSON.parse(await f.text()) });
                }
              } catch {
                setError('无法解析导入文件');
              }
              e.target.value = '';
            }}
          />
        </div>
        <footer>
          <span>原野 · GENERATIVE SOCIETY SIMULATION</span>
          <span>物理事实由规则维护，社会意义由生命书写。</span>
          <span>本地运行 · 自动保存</span>
        </footer>
      </main>
      {archiveOpen && (
        <div className="modal-backdrop" onClick={() => setArchiveOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label="实验档案"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setArchiveOpen(false)}>
              ×
            </button>
            <p className="eyebrow">EXPERIMENT ARCHIVE</p>
            <h2>每个世界，都留下痕迹。</h2>
            <p className="muted">查看本地实验进度与记录。导出后可导入浏览器进行完整回放。</p>
            <div className="archive-list">
              {archives.map((r) => (
                <button
                  key={r.name}
                  onClick={() => {
                    selectSource(r.name);
                    setArchiveOpen(false);
                  }}
                >
                  <span>
                    <b>{r.name}</b>
                    <small>
                      {r.model === '未连接' ? '脚本基线' : r.model} · {r.population} 位初始居民
                    </small>
                  </span>
                  <span>
                    {r.day} / {r.days} 天 <small>{r.complete ? '已完成' : '查看进度'} ↗</small>
                  </span>
                </button>
              ))}
            </div>
            {!archives.length && (
              <p className="note">暂无本地实验记录。可以先生成一个世界开始观察。</p>
            )}
          </div>
        </div>
      )}
      {budgetOpen && (
        <div className="modal-backdrop" onClick={() => setBudgetOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label="运行预算"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setBudgetOpen(false)}>
              ×
            </button>
            <p className="eyebrow">RUN BUDGET</p>
            <h2>调整本轮运行预算</h2>
            <div className="settings-grid">
              {(
                [
                  ['maxCalls', '调用上限'],
                  ['maxTokens', 'Token 上限'],
                  ['maxMinutes', '时长上限（分钟）'],
                  ['populationLimit', '人口阈值'],
                  ['maxCost', '费用上限（0 为关闭）'],
                  ['inputPrice', '输入价 / 百万 tokens'],
                  ['outputPrice', '输出价 / 百万 tokens'],
                  ['cachePrice', '缓存价 / 百万 tokens'],
                ] as [keyof Config, string][]
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    value={config[key] as number}
                    onChange={(e) => setConfig((c) => ({ ...c, [key]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
            <div className="note">修改会记录在本轮历史中，暂停后的世界可继续推进。</div>
            <button
              className="primary"
              onClick={() => {
                const {
                  maxCalls,
                  maxTokens,
                  maxMinutes,
                  populationLimit,
                  maxCost,
                  inputPrice,
                  outputPrice,
                  cachePrice,
                } = config;
                send('budget', {
                  config: {
                    maxCalls,
                    maxTokens,
                    maxMinutes,
                    populationLimit,
                    maxCost,
                    inputPrice,
                    outputPrice,
                    cachePrice,
                  },
                });
                setBudgetOpen(false);
              }}
            >
              保存预算
            </button>
          </div>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label="实验设置"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setSettings(false)}>
              ×
            </button>
            <p className="eyebrow">INITIAL CONDITIONS</p>
            <h2>世界，从这里开始。</h2>
            <p className="muted">新建实验会保留已有记录。模型由本地 Python 后端配置。</p>
            <div className="settings-grid">
              {(
                [
                  ['seed', '世界种子'],
                  ['population', '初始居民'],
                  ['days', '实验天数'],
                  ['maxCalls', '调用次数上限'],
                  ['maxTokens', 'Token 上限'],
                  ['populationLimit', '人口暂停阈值'],
                  ['gestation', '妊娠天数'],
                  ['adultAge', '成年年龄（天）'],
                  ['maxMinutes', '时长上限（分钟）'],
                  ['maxCost', '费用上限（0 为关闭）'],
                  ['inputPrice', '输入价 / 百万 tokens'],
                  ['outputPrice', '输出价 / 百万 tokens'],
                  ['cachePrice', '缓存命中价 / 百万 tokens'],
                ] as [keyof Config, string][]
              ).map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input
                    type="number"
                    value={config[k] as number}
                    onChange={(e) => setConfig((c) => ({ ...c, [k]: Number(e.target.value) }))}
                  />
                </label>
              ))}
              <label>
                出生分布
                <select
                  value={config.spawn}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, spawn: e.target.value as Config['spawn'] }))
                  }
                >
                  <option value="clusters">分区随机</option>
                  <option value="uniform">全图均匀随机</option>
                </select>
              </label>
            </div>
            <div className="note">
              压缩生命周期用于观察代际机制。默认 20 人 × 100 天，预计约 6,400
              次模型调用；费用依据填写的单价估算。
            </div>
            <button
              className="primary"
              disabled={running}
              onClick={() => {
                external.current = undefined;
                setExternalName(undefined);
                send('create', { config });
                setAgentId(undefined);
                setSelected(null);
                setSettings(false);
              }}
            >
              生成新世界 ↗
            </button>
          </div>
        </div>
      )}
      {decision && (
        <div className="modal-backdrop" onClick={() => setDecision(undefined)}>
          <div
            className="modal wide"
            role="dialog"
            aria-label="决策记录"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setDecision(undefined)}>
              ×
            </button>
            <p className="eyebrow">DECISION TRACE</p>
            <h2>一次行动的来处</h2>
            <p className="muted">
              第 {decision.day} 天 · 居民 #{decision.agentId} · {decision.attempts.length}{' '}
              次模型请求
            </p>
            <h3>模型响应与校验</h3>
            <pre>{JSON.stringify(decision.attempts, null, 2)}</pre>
            <h3>角色当时可见的上下文</h3>
            {decision.contextSource === 'reconstructed-from-events' && (
              <p className="note">
                这条早期记录的观察从动作发生前的历史状态重建，原保存副本保留在导出文件中。
              </p>
            )}
            <pre>{JSON.stringify(decision.context, null, 2)}</pre>
          </div>
        </div>
      )}
      {statsOpen && (
        <div className="modal-backdrop" onClick={() => setStatsOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-label="统计详情"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setStatsOpen(false)}>
              ×
            </button>
            <p className="eyebrow">EXPERIMENT METRICS</p>
            <h2>世界的运行记录</h2>
            <div className="stats-list">
              {Object.entries({
                模型: world?.usage.model ?? model,
                已完成天数: world?.metrics.length ?? 0,
                出生: world?.counters.births ?? 0,
                死亡: world?.counters.deaths ?? 0,
                赠与及照料: world?.counters.gifts ?? 0,
                攻击: world?.counters.attacks ?? 0,
                实验: world?.counters.experiments ?? 0,
                配方发现: world?.counters.discoveries ?? 0,
                无效动作: world?.counters.failures ?? 0,
                模型请求错误: world?.usage.errors ?? 0,
                格式修复: world?.usage.repairs ?? 0,
                输入tokens: world?.usage.inputTokens ?? 0,
                输出tokens: world?.usage.outputTokens ?? 0,
                缓存命中tokens: world?.usage.cachedTokens ?? 0,
                估算费用: world?.config.inputPrice ? world.usage.cost.toFixed(4) : '尚未配置单价',
              }).map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
            <p className="note">关系的解释由居民持有。这里记录可追溯的物理事件与调用数据。</p>
          </div>
        </div>
      )}
    </div>
  );
}
