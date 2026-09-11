import ContinuousConfigPanel, { ContinuousStatistics } from './ConfigPanel';
import DialoguePage from '../ui/DialoguePage';
import { useEffect, useRef, useState } from 'react';
import Scene from './Scene';
import {
  applyEvent,
  body,
  clockLabel,
  DAY,
  position,
  RATION,
  type Event,
  type World,
} from './types';
import './style.css';

const base = '/continuous-api';
async function request(path: string, data?: unknown) {
  const r = await fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error ?? v.detail ?? `HTTP ${r.status}`);
  return v;
}
const actions: Record<string, string> = {
  walk: '沿路径行走',
  work: '田间劳动',
  eat: '吃随身口粮',
  withdraw: '装取粮食',
  deposit: '存入粮食',
  rest: '休息 / 驻留',
  wait: '等待新任务',
};
const eventNames: Record<string, string> = {
  plan: '计划',
  think_started: '思考中',
  think_finished: '思考完成',
  plan_rejected: '未采纳',
  speech: '说话',
  withdraw: '领取粮食',
  deposit: '存入粮食',
  work: '农活完成',
  arrived: '到达',
  gate: '庄园门',
  death: '死亡',
  day_end: '每日结算',
  season: '农田成熟',
  control: '控制',
};
export default function ContinuousPage({
  page = 'world',
  model,
  onCreate,
  onPage,
}: {
  page?: 'world' | 'config' | 'statistics' | 'dialogue' | 'experiences' | 'inscriptions' | 'news';
  model?: string;
  onCreate: () => void;
  onPage: (page: 'world') => void;
}) {
  const [run] = useState(new URLSearchParams(location.search).get('run') ?? '');
  const [world, setWorld] = useState<World>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState(1),
    [paths, setPaths] = useState(true);
  const [events, setEvents] = useState<Event[]>([]),
    [replay, setReplay] = useState<World>(),
    [at, setAt] = useState(0),
    [tab, setTab] = useState<'agent' | 'village'>('agent');
  const [playing, setPlaying] = useState(false);
  const [site, setSite] = useState('plaza'),
    [intervene, setIntervene] = useState(false);
  const frames = useRef<{ world: World; at: number }[]>([]),
    live = useRef<World | undefined>(undefined),
    generation = useRef(0);
  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    let active = true;
    setWorld(undefined);
    setEvents([]);
    setReplay(undefined);
    frames.current = [];
    live.current = undefined;
    const source = new EventSource(`${base}/runs/${run}/stream`);
    source.onopen = () => {
      setConnected(true);
      setError('');
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      if (!active) return;
      const data = JSON.parse(message.data);
      if (data.type === 'error') {
        setError(data.error);
        return;
      }
      if (data.type === 'snapshot') {
        live.current = data.world;
        frames.current = [];
      } else if (live.current) {
        for (const event of data.events as Event[]) {
          if (event.seq <= live.current.seq) continue;
          if (event.seq !== live.current.seq + 1) {
            source.close();
            setError('事件流中断，请重新打开实验');
            return;
          }
          applyEvent(live.current, event);
          // Preserve intermediate actions even when an entire walk fits in one network batch.
          frames.current.push({ world: structuredClone(live.current), at: performance.now() });
        }
        live.current.time = data.time;
        setEvents((old) =>
          [...old, ...data.events]
            .filter((e, i, all) => all.findIndex((x) => x.seq === e.seq) === i)
            .slice(-500),
        );
      }
      if (live.current) {
        const w = structuredClone(live.current);
        setWorld(w);
        frames.current.push({ world: w, at: performance.now() });
        frames.current = frames.current
          .filter((f) => f.world.time >= w.time - 720 * 2500)
          .slice(-2000);
      }
    };
    void fetch(`${base}/runs/${run}/events?limit=300`, { signal: controller.signal })
      .then((r) => r.json())
      .then((rows: Event[]) => {
        if (active && Array.isArray(rows))
          setEvents((old) =>
            [...rows, ...old]
              .filter((e, i, all) => all.findIndex((x) => x.seq === e.seq) === i)
              .sort((a, b) => a.seq - b.seq)
              .slice(-500),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
      source.close();
      controller.abort();
      setConnected(false);
    };
  }, [run]);
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const view = replay ?? world,
    a = view?.agents.find((a) => a.id === selected),
    status = a && view ? body(a, view.time) : undefined;
  const seen = events
    .filter(
      (e) =>
        e.text &&
        eventNames[e.type] &&
        (!replay || e.time <= replay.time) &&
        (tab === 'village' || e.actor === selected || e.listeners?.includes(selected)),
    )
    .slice(-70)
    .reverse();
  const chooseSite = (id: string) => {
    setSite(id);
    setTab('village');
  };
  const seek = async (t: number) => {
    setAt(t);
    const n = ++generation.current;
    try {
      const w = await request(`/runs/${run}/replay?at=${t}`);
      if (n !== generation.current) return false;
      setReplay(w);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  useEffect(() => {
    if (!playing || !run) return;
    let t = replay?.time ?? Math.max(0, (live.current?.time ?? 0) - 3 * 3600000),
      wall = performance.now(),
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      const now = performance.now();
      t = Math.min(live.current?.time ?? t, t + (now - wall) * 10);
      wall = now;
      pending = true;
      void seek(t).finally(() => {
        pending = false;
      });
    }, 200);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [playing, run]);
  return (
    <div className={`cv-app ${page === 'world' ? '' : 'cv-data-mode'}`}>
      <div className="cv-toolbar">
        <span className={`cv-signal ${connected ? 'online' : ''}`} />
        <span>
          {replay
            ? '历史回放'
            : world?.status === 'running'
              ? '持续运行'
              : world?.status === 'complete'
                ? '实验完成'
                : world
                  ? '已暂停'
                  : '尚未启动'}
        </span>
        <span className="cv-divider" />
        <button
          disabled={!world || busy || !!replay || world.status === 'complete'}
          onClick={() =>
            perform(() => request(`/runs/${run}/control`, { paused: world?.status === 'running' }))
          }
        >
          {world?.status === 'running' ? 'Ⅱ 暂停' : '▶ 继续'}
        </button>
        <button className={paths ? 'active' : ''} onClick={() => setPaths(!paths)}>
          轨迹
        </button>
        <div className="cv-toolbar-space" />
        <span>{view ? clockLabel(view.time) : '等待开局'} · 游戏 1 天 = 现实 2 分钟</span>
        <button className="cv-primary" disabled={busy} onClick={onCreate}>
          ＋ 新实验
        </button>
      </div>
      {error && (
        <div role="alert" className="cv-error">
          {error}
        </div>
      )}
      {page === 'config' && (
        <ContinuousConfigPanel world={world} model={model} onCreate={onCreate} />
      )}
      {page === 'statistics' && <ContinuousStatistics world={view} />}
      {page === 'dialogue' && (
        <DialoguePage
          world={
            view
              ? {
                  id: view.id,
                  seq: view.seq,
                  agents: view.agents.map((a) => ({
                    id: a.id,
                    name: a.name,
                    death: a.dead ? {} : undefined,
                  })),
                }
              : undefined
          }
          historical={!!replay}
          continuousName={run}
          onInspect={async (id) => {
            const time = Number(id.split(':')[1]);
            if (!id.startsWith('continuous:') || !Number.isFinite(time)) return false;
            setPlaying(false);
            if (!(await seek(time))) return false;
            onPage('world');
            return true;
          }}
        />
      )}
      {['experiences', 'inscriptions', 'news'].includes(page) && (
        <section className="data-page">
          <p>连续原型尚未接入此页。居民经历可在世界地图右侧查看。</p>
          <button onClick={() => onPage('world')}>返回世界</button>
        </section>
      )}
      <main className="cv-layout" style={page !== 'world' ? { display: 'none' } : undefined}>
        <section className="cv-map-panel">
          <div className="cv-map-heading">
            <div>
              <small>THE ELM COMMON</small>
              <h1>一天的生活，正在发生。</h1>
            </div>
            <span>{world?.mode === 'llm' ? '自主计划 / 异步思考' : '脚本计划 / 连续执行'}</span>
          </div>
          <Scene
            active={page === 'world'}
            frames={frames}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setTab('agent');
            }}
            onSite={chooseSite}
            paths={paths}
            replay={replay}
          />
          {!world && (
            <div className="cv-empty">
              <h2>从一个小村庄开始</h2>
              <p>
                五位居民，一座大厅，两户人家和八块田。
                <br />
                走路、劳动与交谈同时发生。
              </p>
              <button className="cv-primary" disabled={busy} onClick={onCreate}>
                配置并启动实验
              </button>
            </div>
          )}
          <div className="cv-map-footer">
            <span>拖动平移 · 滚轮缩放 · 双击复位 · 点击人物 / 建筑</span>
            <span>15 m / 地块 · 720× 时间</span>
          </div>
          <div className="cv-timeline">
            <button
              disabled={!replay}
              onClick={() => {
                setPlaying(false);
                generation.current++;
                setReplay(undefined);
              }}
            >
              回到现场
            </button>
            <button disabled={!world} onClick={() => setPlaying(!playing)}>
              {playing ? '暂停慢放' : '回放 10×'}
            </button>
            <input
              aria-label="回放时间"
              type="range"
              min="0"
              max={world?.time ?? 0}
              step="1000"
              value={replay ? at : (world?.time ?? 0)}
              onChange={(e) => {
                setPlaying(false);
                void seek(Number(e.target.value));
              }}
            />
            <span>{replay ? '只读回放' : '已提交时间线'}</span>
          </div>
          <div className="cv-roster">
            {view?.agents.map((p) => {
              const b = body(p, view.time);
              return (
                <button
                  className={selected === p.id ? 'selected' : ''}
                  key={p.id}
                  onClick={() => {
                    setSelected(p.id);
                    setTab('agent');
                  }}
                >
                  <i style={{ background: `#${p.color.toString(16)}` }} />
                  <b>{p.name}</b>
                  <small>
                    {p.dead ? '已死亡' : p.thinking ? '思考中' : actions[p.action?.kind ?? 'wait']}
                  </small>
                  <div className="cv-roster-bar">
                    <span style={{ width: `${b.food / 50}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        <aside className="cv-sidebar">
          <div className="cv-tabs">
            <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>
              居民与决策
            </button>
            <button className={tab === 'village' ? 'active' : ''} onClick={() => setTab('village')}>
              村庄现场
            </button>
          </div>
          {tab === 'agent' && a && view && status ? (
            <>
              <div className="cv-person">
                <div className="cv-avatar" style={{ background: `#${a.color.toString(16)}` }}>
                  {a.name[0]}
                </div>
                <div>
                  <h2>
                    {a.name}
                    <small>
                      #{a.id} · {a.sex === 'F' ? '女' : '男'}
                    </small>
                  </h2>
                  <p>
                    {a.thinking
                      ? '◌ 模型思考中，任务仍在执行'
                      : a.dead
                        ? '生命已经结束'
                        : '● 独立生活中'}
                  </p>
                </div>
              </div>
              <div className="cv-vitals">
                <div>
                  <span>生命</span>
                  <b>
                    {status.hp.toFixed(0)}
                    <small>/100</small>
                  </b>
                  <meter min="0" max="100" value={status.hp} />
                </div>
                <div>
                  <span>饱食度</span>
                  <b>
                    {(status.food / 50).toFixed(0)}
                    <small>/100</small>
                  </b>
                  <meter min="0" max="100" value={status.food / 50} />
                </div>
              </div>
              <div className="cv-ration">
                <span>随身口粮</span>
                <b>{a.grain.toFixed(2)} kg</b>
                <small>约 {(a.grain / RATION).toFixed(1)} 天 · 家庭储藏另计</small>
              </div>
              <div className="cv-task">
                <small>当前意图</small>
                <p>{a.intent}</p>
                <dl>
                  <dt>实际动作</dt>
                  <dd>{actions[a.action?.kind ?? 'wait']}</dd>
                  <dt>目标地点</dt>
                  <dd>{view.sites.find((s) => s.id === a.action?.target)?.label ?? '原地'}</dd>
                  <dt>连续位置</dt>
                  <dd>
                    {position(a, view.time).x.toFixed(1)}, {position(a, view.time).y.toFixed(1)} m
                  </dd>
                  <dt>任务状态</dt>
                  <dd>
                    {a.blocked?.reason ??
                      (a.task ? `${a.task.kind} → ${a.task.target}` : '等待 / 自动日程')}
                  </dd>
                </dl>
                {a.action && (
                  <div className="cv-progress">
                    <i
                      style={{
                        width: `${Math.min(100, Math.max(0, ((view.time - a.action.start) / (a.action.end - a.action.start)) * 100))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="cv-routine">
                <small>本人自动日程</small>
                <p>
                  进食 {a.routine.eat ? '开' : '关'} · 补粮 {a.routine.fetch ? '开' : '关'} · 农活{' '}
                  {a.routine.work ? '开' : '关'} · 储备 {a.routine.reserveDays} 天
                </p>
                <span>
                  思考 {a.thoughts} 次 · {(a.tokens / 1000).toFixed(1)}k tokens · 行走{' '}
                  {a.stats.distance.toFixed(0)} m
                </span>
              </div>
              <button className="cv-intervene-toggle" onClick={() => setIntervene(!intervene)}>
                {intervene ? '收起' : '展开'}观察者干预
              </button>
              {intervene && (
                <div className="cv-intervene">
                  <select
                    aria-label="干预目标"
                    value={site}
                    onChange={(e) => setSite(e.target.value)}
                  >
                    {view.sites.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || !!replay || a.dead}
                    onClick={() =>
                      perform(() =>
                        request(`/runs/${run}/plan`, {
                          actor: a.id,
                          plan: {
                            intent: `前往 ${site}`,
                            task: { kind: 'navigate', target: site, amount: 1 },
                          },
                        }),
                      )
                    }
                  >
                    切换行走目标
                  </button>
                  <button
                    disabled={busy || !!replay || a.dead}
                    onClick={() =>
                      perform(() =>
                        request(`/runs/${run}/plan`, {
                          actor: a.id,
                          plan: {
                            intent: '暂停当前任务，留在原地',
                            task: null,
                            routine: { ...a.routine, fetch: false, work: false },
                          },
                        }),
                      )
                    }
                  >
                    中断并停留
                  </button>
                </div>
              )}
            </>
          ) : tab === 'village' && view ? (
            <>
              <div className="cv-village-title">
                <h2>村庄账目</h2>
                <p>储粮、劳动与实际发生的交谈。</p>
              </div>
              <div className="cv-numbers">
                <div>
                  <b>
                    {view.agents.filter((a) => !a.dead).length}
                    <small> / 5</small>
                  </b>
                  <span>存活居民</span>
                </div>
                <div>
                  <b>
                    {view.stores.reduce((n, s) => n + s.grain, 0).toFixed(1)}
                    <small> kg</small>
                  </b>
                  <span>储藏粮食</span>
                </div>
              </div>
              {view.stores.map((s) => (
                <div key={s.id} className="cv-store">
                  <span>{s.label}</span>
                  <b>{s.grain.toFixed(2)} kg</b>
                  <small>其中 {s.reserved.toFixed(2)} kg 正在装取</small>
                </div>
              ))}
              <div className="cv-store">
                <span>累计实际劳动</span>
                <b>
                  {(view.agents.reduce((n, a) => n + a.stats.workMs, 0) / 3600000).toFixed(1)}{' '}
                  人小时
                </b>
                <small>月末按完成量成熟 · 第 40 天后减产</small>
              </div>
              <button
                disabled={busy || !!replay}
                onClick={() =>
                  perform(() =>
                    request(`/runs/${run}/gate`, { id: 'gate', open: !world?.gates[0].open }),
                  )
                }
              >
                {view.gates[0].open ? '关闭' : '打开'}庄园门
              </button>
              <p className="cv-scope">
                原型范围：移动、取放粮、自动进食、农活、交谈、异步计划与回放。王税、使者与战斗将在领地迁移阶段接入。
              </p>
            </>
          ) : (
            <p className="cv-scope">点击地图上的居民查看他的行动过程。</p>
          )}
          <div className="cv-history-title">
            <h3>{tab === 'agent' ? '经历与决策轨迹' : '现场纪事'}</h3>
            <small>实际结果与计划分开记录</small>
          </div>
          <div className="cv-history" aria-label="决策历史">
            {seen.map((e) => (
              <article key={e.seq}>
                <div>
                  <span>{eventNames[e.type]}</span>
                  <time>{clockLabel(e.time)}</time>
                </div>
                <p>{e.text}</p>
                {e.type === 'speech' && (
                  <small>
                    #{e.actor} →{' '}
                    {e.listeners?.length
                      ? e.listeners
                          .map((id) => view?.agents.find((a) => a.id === id)?.name)
                          .join('、')
                      : '无人听见'}
                  </small>
                )}
              </article>
            ))}
            {!seen.length && <p className="cv-scope">新的经历会随时间出现。</p>}
          </div>
        </aside>
      </main>
      <footer className="cv-footer">
        <span>CONTINUOUS PROTOTYPE 01</span>
        <span>独立模拟进程 · MySQL 精简事件 · 已提交轨迹回放</span>
        <span>
          {world
            ? `E${world.seq} · ${world.mode === 'llm' ? `模型调用 ${world.calls}/${world.maxCalls}` : '脚本演示'}`
            : 'READY'}
        </span>
      </footer>
    </div>
  );
}
