import ContextTrace from './ContextTrace';
import EcoDashboard from './EcoDashboard';
import StatisticsPage from './StatisticsPage';
import DialoguePage from './DialoguePage';
import ExperiencesPage from './ExperiencesPage';
import InscriptionsPage from './InscriptionsPage';
import { useChronicle } from './useChronicle';
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
import { DEFAULT_CONFIG, ConfigSchema } from '../sim/types';
import { db } from '../runtime/store';
import Map from './Map';
import WorldConfig from './WorldConfig';
import { foodSummary } from '../sim/food';
import { metrics } from '../sim/engine';
import { lonelinessCapacity } from '../sim/social';
import type { FoodBatch } from '../sim/types';
import { eventNames } from '../runtime/event-search';
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
type ExperimentControl = {
  state: 'running' | 'stopping' | 'paused' | 'completed' | 'failed';
  reason: string;
  canResume: boolean;
  concurrency: number;
};
const controlLabels = {
  running: '运行中',
  stopping: '正在保存并中断…',
  paused: '已中断',
  completed: '已完成',
  failed: '运行异常',
};
async function controlRequest(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data.detail === 'string' ? data.detail : '操作失败，请检查实验参数');
  return data;
}
function InventoryView({
  value,
  batches,
  day = 1,
}: {
  value: Inventory;
  batches?: FoodBatch[];
  day?: number;
}) {
  return (
    <div className="inventory">
      {Object.entries(value)
        .filter(([, n]) => n)
        .map(([k, n]) => (
          <span key={k}>
            {names[k] ?? k} <b>{n}</b>
          </span>
        ))}
      {batches && (value.food ?? 0) > 0 && (
        <div className="food-batches">
          <span>
            新鲜 {foodSummary(batches, day).fresh} · 腐败 {foodSummary(batches, day).spoiled}
          </span>
          {batches.map((b) => (
            <small key={b.expiresOnDay}>
              {b.quantity} 份 · {day >= b.expiresOnDay ? '已腐败' : `第 ${b.expiresOnDay} 天腐败`}
            </small>
          ))}
        </div>
      )}
      {!Object.values(value).some(Boolean) && <span className="muted">空</span>}
    </div>
  );
}
function Meter({
  label,
  value,
  color,
  max = 100,
}: {
  label: string;
  value: number;
  color: string;
  max?: number;
}) {
  return (
    <div className="meter">
      <label>
        {label}
        <b>
          {value}
          <small> / {max}</small>
        </b>
      </label>
      <div>
        <i style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
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
    [contextWindow, setContextWindow] = useState<number>(),
    [selected, setSelected] = useState<[number, number] | null>(null),
    [focus, setFocus] = useState<[number, number]>(),
    [agentId, setAgentId] = useState<number | undefined>(
      () => Number(new URLSearchParams(location.search).get('agent')) || undefined,
    ),
    [tab, setTab] = useState('居民'),
    [layer, setLayer] = useState('terrain');
  const [eventType, setEventType] = useState(''),
    [query, setQuery] = useState(''),
    [settings, setSettings] = useState(false),
    [config, setConfig] = useState<Config>({
      ...DEFAULT_CONFIG,
      worldModel: 'ecology',
      controller: 'hybrid',
    }),
    [decision, setDecision] = useState<DecisionRecord>();
  const [page, setPage] = useState<
    'world' | 'config' | 'statistics' | 'experiences' | 'dialogue' | 'inscriptions'
  >(() => {
    const value = new URLSearchParams(location.search).get('page');
    return value === 'config' ||
      value === 'statistics' ||
      value === 'experiences' ||
      value === 'dialogue' ||
      value === 'inscriptions'
      ? value
      : 'world';
  });
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [replaySeq, setReplaySeq] = useState(0);
  const [replayTarget, setReplayTarget] = useState<number>();
  const [serverReplay, setServerReplay] = useState(false);
  const [externalName, setExternalName] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get('experiment') ?? undefined,
  );
  const { events, eventsLoading, eventsError, hasMoreEvents, loadMoreEvents, refreshEvents } =
    useChronicle(world, history?.seq, externalName, query, eventType, page === 'world');
  useEffect(() => {
    const url = new URL(location.href);
    if (page === 'world') url.searchParams.delete('page');
    else url.searchParams.set('page', page);
    if (page === 'experiences' && agentId) url.searchParams.set('agent', String(agentId));
    else url.searchParams.delete('agent');
    window.history.replaceState(null, '', url);
  }, [page, agentId]);
  const external = useRef(externalName);
  const [control, setControl] = useState<ExperimentControl>();
  const [controlBusy, setControlBusy] = useState(false);
  const [newMode, setNewMode] = useState<'llm' | 'scripted'>('llm');
  const [newConcurrency, setNewConcurrency] = useState(6);
  const controlRevision = useRef(0);
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
  const selectSource = (name?: string, restore = true) => {
    setReplayTarget(undefined);
    setServerReplay(false);
    external.current = name;
    controlRevision.current++;
    setControl(undefined);
    setRunning(false);
    setExternalName(name);
    const url = new URL(location.href);
    if (name) url.searchParams.set('experiment', name);
    else url.searchParams.delete('experiment');
    window.history.replaceState(null, '', url);
    setHistory(undefined);
    setAgentId(undefined);
    setSelected(null);
    setDecision(undefined);
    if (!name) {
      setWorld(undefined);
      if (restore) worker.current?.postMessage({ type: 'restore' });
    }
  };
  const send = (type: string, extra: Record<string, unknown> = {}) =>
    worker.current?.postMessage({ type, ...extra });
  const operate = async (operation: 'pause' | 'resume') => {
    if (!externalName || controlBusy) return;
    const name = externalName;
    setControlBusy(true);
    controlRevision.current++;
    setError('');
    try {
      const info = await controlRequest(
        `/api/experiments/${encodeURIComponent(name)}/${operation}`,
      );
      if (external.current === name) {
        setControl(info);
        setRunning(info.state === 'running' || info.state === 'stopping');
        setStatus(
          `${name} · ${controlLabels[info.state as ExperimentControl['state']]}${info.reason ? ` · ${info.reason}` : ''}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      controlRevision.current++;
      setControlBusy(false);
    }
  };
  const startExperiment = async () => {
    if (controlBusy) return;
    const parsed = ConfigSchema.safeParse({
      ...config,
      contextWindow: config.contextWindow ?? contextWindow ?? 65536,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；'),
      );
      return;
    }
    setControlBusy(true);
    setError('');
    try {
      const data = await controlRequest('/api/experiments', {
        config: parsed.data,
        mode: newMode,
        concurrency: newConcurrency,
      });
      selectSource(data.name);
      setWorld(undefined);
      setControl(data.control);
      setSettings(false);
      setPage('world');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setControlBusy(false);
    }
  };
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
      } else if (data.type === 'progress' && !external.current) setStatus(data.status);
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
      .then((c) => {
        setModel(c.configured ? c.model : '密钥未配置');
        setContextWindow(c.contextWindow);
      })
      .catch(() => setModel('后端未连接'));
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    if (!externalName) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = controlRevision.current;
      try {
        const res = await fetch(
          `/api/experiments/${encodeURIComponent(externalName)}/snapshot?include_events=false`,
        );
        if (!res.ok) throw new Error('无法读取该实验');
        const data = await res.json();
        if (active) {
          setWorld(data.world);
          setServerReplay(data.storage === 'mysql-delta-v1');
          if (revision === controlRevision.current) {
            const info: ExperimentControl = data.control;
            setControl(info);
            setRunning(info?.state === 'running' || info?.state === 'stopping');
            setStatus(
              `${externalName} · ${info ? controlLabels[info.state] : '状态读取中'}${info?.reason ? ` · ${info.reason}` : ''}`,
            );
          }
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
  useEffect(() => {
    if (!externalName || replayTarget === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/experiments/${encodeURIComponent(externalName)}/replay?seq=${replayTarget}`,
          { signal: controller.signal },
        );
        if (!r.ok) throw Error('历史回放读取失败');
        const data = await r.json();
        if (!controller.signal.aborted) {
          setHistory(data.world);
          setReplaySeq(data.world.seq);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(String(e));
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [externalName, replayTarget]);
  const displayed = history ?? world;
  const currentMetrics = displayed ? metrics(displayed) : undefined;
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
  const inspect = async (e: Pick<WorldEvent, 'decisionId' | 'position' | 'actorId'>) => {
    if (e.position) {
      setSelected(e.position);
      setFocus(e.position);
    }
    if (e.actorId) setAgentId(e.actorId);
    const r = externalName
      ? await fetch(
          `/api/experiments/${encodeURIComponent(externalName)}/decision?id=${encodeURIComponent(e.decisionId.replace(/:complete$/, ''))}`,
        ).then((r) => (r.ok ? r.json() : undefined))
      : await db.decisions.get(e.decisionId.replace(/:complete$/, ''));
    setDecision(r);
    return !!r;
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
          <span className="live-dot" /> 自主演化实验 <span className="divider">/</span>{' '}
          {displayed?.ecology ? 'ECO 02' : 'MVP 01'}
        </div>
        <div className="header-actions">
          <nav className="page-nav" aria-label="页面导航">
            <button
              aria-current={page === 'world' ? 'page' : undefined}
              onClick={() => setPage('world')}
            >
              世界
            </button>
            <button
              aria-current={page === 'config' ? 'page' : undefined}
              onClick={() => setPage('config')}
            >
              配置
            </button>
            <button
              aria-current={page === 'statistics' ? 'page' : undefined}
              onClick={() => setPage('statistics')}
            >
              统计数据
            </button>
            <button
              aria-current={page === 'experiences' ? 'page' : undefined}
              onClick={() => setPage('experiences')}
            >
              Agent 经历
            </button>
            <button
              aria-current={page === 'dialogue' ? 'page' : undefined}
              onClick={() => setPage('dialogue')}
            >
              对话分析
            </button>
            <button
              aria-current={page === 'inscriptions' ? 'page' : undefined}
              onClick={() => setPage('inscriptions')}
            >
              铭文
            </button>
          </nav>
          <button
            className="text-button"
            disabled={running && !externalName}
            onClick={() => setArchiveOpen(true)}
          >
            实验档案 ↗
          </button>
          <span className="model-badge">
            <i /> {model}
          </span>
          <button
            className="text-button new-experiment"
            disabled={controlBusy || (running && !externalName)}
            onClick={() => setSettings(true)}
          >
            开始新实验
          </button>
        </div>
      </header>
      <main>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError('')}>关闭</button>
          </div>
        )}

        {page === 'inscriptions' ? (
          <InscriptionsPage world={displayed} historical={!!history} />
        ) : page === 'dialogue' ? (
          <DialoguePage
            world={displayed}
            historical={!!history}
            externalName={externalName}
            onInspect={(decisionId) => inspect({ decisionId })}
          />
        ) : page === 'statistics' ? (
          <StatisticsPage
            externalName={externalName}
            world={displayed}
            historical={!!history}
            onAgent={(id) => {
              setAgentId(id);
              setPage('experiences');
            }}
          />
        ) : page === 'experiences' ? (
          <ExperiencesPage
            world={displayed}
            historical={!!history}
            externalName={externalName}
            agentId={agentId}
            onAgent={setAgentId}
            onInspect={(decisionId) => inspect({ decisionId })}
          />
        ) : page === 'config' ? (
          <WorldConfig
            world={displayed}
            draft={config}
            model={model}
            contextWindow={contextWindow}
            onCreate={() => setSettings(true)}
          />
        ) : (
          <>
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
                  {fmt(currentMetrics?.freshFood ?? currentMetrics?.food ?? 0)}
                  <small>{displayed?.ecology ? 'FD' : '份'}</small>
                </strong>
                <p>
                  {displayed?.ecology ? '储存食物热量（1 FD = 2500 kcal）' : '新鲜储备与农田收成'}
                  {currentMetrics?.spoiledFood !== undefined
                    ? ` · 腐败 ${fmt(currentMetrics.spoiledFood)} 份`
                    : ''}
                </p>
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
                  {displayed?.ecology
                    ? displayed.tiles.reduce((n, t) => n + t.eco!.fields.length, 0)
                    : (displayed?.tiles.filter((t) => t.farm >= 3).length ?? 0)}
                  <small>块</small>
                </strong>
                <p>
                  {displayed?.counters.discoveries ?? 0} 次配方发现 <em>·</em>{' '}
                  {displayed?.tiles.filter((t) => t.shelter?.complete).length ?? 0} 座棚屋
                </p>
              </div>
            </section>
            {displayed?.ecology && <EcoDashboard world={displayed} layer={layer} />}
            <section
              className="workspace"
              style={displayed?.ecology ? { display: 'block' } : undefined}
            >
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
                {displayed?.ecology ? null : displayed ? (
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
                      {config.size} × {config.size} 的原野，{config.population} 个独立的生命。
                      <br />
                      地形由种子生成，故事由他们决定。
                    </p>
                    <button
                      className="primary"
                      onClick={() => {
                        selectSource(undefined, false);
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
                <div
                  className="map-footer"
                  style={displayed?.ecology ? { display: 'none' } : undefined}
                >
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
                  <span>× 尸体 · 滚轮缩放 · 拖动探索 · 点击查看</span>
                </div>
                <div className="playback">
                  <div className="playback-actions">
                    <button
                      className="primary"
                      disabled={
                        !world ||
                        !!history ||
                        world?.cursor.phase === 'complete' ||
                        controlBusy ||
                        (!!externalName &&
                          (!control ||
                            control.state === 'stopping' ||
                            (control.state !== 'running' && !control.canResume)))
                      }
                      onClick={() =>
                        externalName
                          ? void operate(control?.state === 'running' ? 'pause' : 'resume')
                          : send(running ? 'pause' : 'run')
                      }
                    >
                      {externalName
                        ? controlBusy
                          ? '正在处理…'
                          : control?.state === 'stopping'
                            ? '正在保存…'
                            : control?.state === 'running'
                              ? '中断实验'
                              : '继续实验'
                        : running
                          ? 'Ⅱ 暂停'
                          : '▶ 开始演化'}
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
                      disabled={!!externalName}
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
              <aside
                className="inspector"
                style={displayed?.ecology ? { display: 'none' } : undefined}
              >
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
                                {agent.name}{' '}
                                <small>
                                  #{agent.id}
                                  {agent.role === 'prophet' ? ' · 先知' : ''}
                                </small>
                              </h3>
                              <p>
                                {agent.sex === 'F' ? '女性' : '男性'} ·{' '}
                                {agent.age < displayed!.config.adultAge ? '幼年' : '成年'} · (
                                {agent.x}, {agent.y}) {agent.death ? '· 已死亡' : ''}
                              </p>
                            </div>
                          </div>
                          <Meter label="生命" value={agent.hp} color="#8fbf8b" />
                          <Meter label="饱食度" value={agent.hunger} color="#d7bd79" />
                          {agent.social && (
                            <>
                              <Meter
                                label="孤单"
                                value={agent.social.loneliness}
                                max={lonelinessCapacity(agent)}
                                color={agent.social.depressed ? '#c87575' : '#a99ac9'}
                              />
                              <p className="muted small">
                                {agent.social.depressed
                                  ? '抑郁 · 每日额外扣 10 血，孤单清零后解除'
                                  : `孤单上限 ${lonelinessCapacity(agent)} · 向人说话可缓解`}
                              </p>
                            </>
                          )}
                          <div className="section-label">当前打算</div>
                          <p className="intent">{agent.intent || '尚未开始决策。'}</p>
                          {agent.survey && (
                            <div className="survey-result">
                              <div className="section-label">最近全力观察</div>
                              <p className="muted small">
                                第 {agent.survey.day} 天 · 事件 #{agent.survey.eventSeq} ·
                                三格环境快照
                              </p>
                              <p className="muted small">
                                {agent.survey.tiles.length} 个地块 · {agent.survey.people.length}{' '}
                                名活人 · {agent.survey.corpses.length} 具尸体
                              </p>
                              <p className="muted small">
                                活人：
                                {agent.survey.people
                                  .map((p) => `${p.name} #${p.id} (${p.x},${p.y})`)
                                  .join('、') || '未发现'}
                              </p>
                              <p className="muted small">
                                尸体：
                                {agent.survey.corpses
                                  .map((p) => `${p.name} #${p.id} (${p.x},${p.y})`)
                                  .join('、') || '未发现'}
                              </p>
                            </div>
                          )}
                          <div className="section-label">携带物品</div>
                          <InventoryView
                            value={agent.inventory}
                            batches={agent.foodBatches}
                            day={displayed?.tick}
                          />
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
                          <div className="section-label">已掌握配方</div>
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
                                    {a.name}{' '}
                                    <small>
                                      #{a.id}
                                      {a.role === 'prophet' ? ' · 先知' : ''}
                                    </small>
                                  </b>
                                  <em>
                                    {a.death
                                      ? `${a.death.cause}死亡`
                                      : a.social?.depressed
                                        ? '抑郁 · 需要交流'
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
                          <InventoryView
                            value={tile.ground}
                            batches={tile.groundFoodBatches}
                            day={displayed?.tick}
                          />
                          <div className="section-label">地面尸体</div>
                          {displayed?.agents.some(
                            (a) => a.corpse?.x === tile.x && a.corpse?.y === tile.y,
                          ) ? (
                            displayed.agents
                              .filter((a) => a.corpse?.x === tile.x && a.corpse?.y === tile.y)
                              .map((a) => (
                                <button
                                  className="resident-link"
                                  key={a.id}
                                  onClick={() => choose(a)}
                                >
                                  {a.name} #{a.id} · 尸体 <span>查看 ↗</span>
                                </button>
                              ))
                          ) : (
                            <p className="muted small">此处没有尸体</p>
                          )}
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
                              <button
                                className="resident-link"
                                key={a.id}
                                onClick={() => choose(a)}
                              >
                                {a.name} #{a.id} <span>查看 ↗</span>
                              </button>
                            ))}
                          <div className="note">
                            物品的位置是物理事实；土地属于谁，由居民各自理解。
                          </div>
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
                    onClick={loadMoreEvents}
                  >
                    加载更早记录
                  </button>
                  <button
                    className="text-button"
                    disabled={!world || eventsLoading}
                    onClick={refreshEvents}
                  >
                    刷新纪事
                  </button>
                  <span role="status">
                    {eventsError ||
                      (eventsLoading ? '正在检索历史…' : '点击事件，查看当时的决策上下文')}
                  </span>
                </div>
              </div>
              <div className="chart-panel">
                <div className="panel-toolbar">
                  <div className="panel-title">生命的轨迹</div>
                  <button className="text-button" onClick={() => setPage('statistics')}>
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
                value={replayTarget ?? (history ? replaySeq : (world?.seq ?? 0))}
                disabled={!world || (externalName ? !serverReplay : running)}
                onChange={(e) => {
                  setReplaySeq(Number(e.target.value));
                  if (externalName) setReplayTarget(Number(e.target.value));
                  else send('replay', { seq: Number(e.target.value) });
                }}
              />
              <button
                disabled={!history && replayTarget === undefined}
                onClick={() => {
                  setReplayTarget(undefined);
                  setHistory(undefined);
                  if (!externalName) send('current');
                }}
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
                accept=".json,.gz"
                onChange={async (e) => {
                  try {
                    const f = e.target.files?.[0];
                    if (f) {
                      const head = await f.slice(0, 256).text();
                      if (f.name.endsWith('.gz') || head.includes('agent-world-delta-v1')) {
                        setStatus('正在校验并导入数据库档案…');
                        const r = await fetch('/api/storage-import', { method: 'POST', body: f });
                        if (!r.ok) throw Error('数据库档案校验失败');
                        const data = await r.json();
                        selectSource(data.name);
                      } else {
                        selectSource(undefined, false);
                        send('import', { bundle: JSON.parse(await f.text()) });
                      }
                    }
                  } catch (error) {
                    setError(error instanceof Error ? error.message : '无法解析导入文件');
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
          </>
        )}
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
            <p className="muted">新实验独立保存，已有实验保留。后台实验关闭页面后仍会运行。</p>
            {externalName && running && (
              <p className="note">
                当前实验仍在运行。可以先关闭此窗口并中断当前实验，再开始新一轮。
              </p>
            )}
            {error && (
              <p role="alert" className="note">
                {error}
              </p>
            )}
            <div className="settings-grid">
              {(
                [
                  ['size', '地图边长'],
                  ['plainFoodCapacity', '平原食物上限'],
                  ['plainRecoveryDays', '平原采集恢复等待（天）'],
                  ['foodShelfLifeDays', '采后保鲜期（天）'],
                  ['inventoryCapacity', '背包容量'],
                  ['spoiledFoodDamage', '每份腐败食物伤害'],
                  ['spoiledFoodHungerGain', '每份腐败食物饱食度恢复'],
                  ['seed', '世界种子'],
                  ['population', '初始居民'],
                  ['days', '实验天数'],
                  ['dailyAP', '每日行动点'],
                  ...(config.worldModel === 'ecology'
                    ? ([
                        ['regions', '区域数量'],
                        ['llmDailyTokens', '每人每日 Token 准入阈值'],
                        ['contextWindow', '下次实验上下文窗口（tokens）'],
                      ] as [keyof Config, string][])
                    : []),
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
              )
                .filter(
                  ([k]) =>
                    config.worldModel !== 'ecology' ||
                    ![
                      'plainFoodCapacity',
                      'plainRecoveryDays',
                      'foodShelfLifeDays',
                      'spoiledFoodDamage',
                      'spoiledFoodHungerGain',
                      'gestation',
                      'adultAge',
                    ].includes(k),
                )
                .map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input
                      type="number"
                      min={k === 'size' ? 10 : k === 'contextWindow' ? 4000 : undefined}
                      max={k === 'size' ? 64 : k === 'contextWindow' ? 262144 : undefined}
                      value={
                        (config[k] ??
                          (k === 'contextWindow' ? (contextWindow ?? 65536) : undefined)) as number
                      }
                      onChange={(e) => setConfig((c) => ({ ...c, [k]: Number(e.target.value) }))}
                    />
                  </label>
                ))}
              <label>
                世界规则
                <select
                  value={config.worldModel}
                  onChange={(e) =>
                    setConfig({ ...config, worldModel: e.target.value as Config['worldModel'] })
                  }
                >
                  <option value="ecology">生态产业 / 混合 Agent</option>
                  <option value="legacy">历史简化规则</option>
                </select>
              </label>
              {config.worldModel === 'ecology' && (
                <label>
                  野兽与聚居地袭击
                  <input
                    type="checkbox"
                    checked={config.wildlifeEnabled !== false}
                    onChange={(e) => setConfig({ ...config, wildlifeEnabled: e.target.checked })}
                  />
                </label>
              )}
              {config.worldModel === 'ecology' && (
                <>
                  <label>
                    野兽死亡后刷新冷却（天）
                    <input
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      value={config.beastRespawnDays ?? 10}
                      onChange={(e) =>
                        setConfig({ ...config, beastRespawnDays: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    野兽战斗力倍率
                    <input
                      type="number"
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={config.beastPowerMultiplier ?? 1}
                      onChange={(e) =>
                        setConfig({ ...config, beastPowerMultiplier: Number(e.target.value) })
                      }
                    />
                  </label>
                  <p>
                    同一区域有野兽被击败后，冷却期间不刷新新野兽；到期后按每5天的刷新节奏补充。倍率同时缩放野兽生命、攻击和回血，0.5表示减半。
                  </p>
                </>
              )}
              <label>
                生态开局
                <select
                  aria-label="生态开局"
                  value={config.ecoPreset}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      ecoPreset: e.target.value as Config['ecoPreset'],
                      ...(e.target.value === 'village' ? { spawn: 'compact' as const } : {}),
                    })
                  }
                >
                  <option value="forager">采集者（先知 + 初始口粮）</option>
                  <option value="settlement">农业定居（实物种粮 / 畜群 / 仓库）</option>
                  <option value="village">初始村落（集中居住 / 农田 / 农具 / 储粮）</option>
                </select>
              </label>
              <label>
                开始年内日
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={config.startDay}
                  onChange={(e) => setConfig({ ...config, startDay: Number(e.target.value) })}
                />
              </label>
              <label>
                每人每日模型请求上限
                <input
                  type="number"
                  min="0"
                  max="3"
                  value={config.llmDailyCalls}
                  onChange={(e) => setConfig({ ...config, llmDailyCalls: Number(e.target.value) })}
                />
              </label>
              <label>
                运行模式
                <select
                  aria-label="运行模式"
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value as 'llm' | 'scripted')}
                >
                  <option value="llm">LLM 自主演化</option>
                  <option value="scripted">脚本基线</option>
                </select>
              </label>
              <label>
                后台并发上限
                <select
                  aria-label="后台并发上限"
                  value={newConcurrency}
                  onChange={(e) => setNewConcurrency(Number(e.target.value))}
                >
                  {[1, 2, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                出生分布
                <select
                  aria-label="出生分布"
                  value={config.spawn}
                  disabled={config.worldModel === 'ecology' && config.ecoPreset === 'village'}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, spawn: e.target.value as Config['spawn'] }))
                  }
                >
                  <option value="clusters">分区随机</option>
                  <option value="uniform">全图均匀随机</option>
                  <option value="compact">扎堆出现（同一区域 2×2 四格）</option>
                </select>
              </label>
            </div>
            <div className="note">
              {config.worldModel === 'ecology' ? (
                <>
                  按初始人口计算，模型请求上限约{' '}
                  {fmt(
                    Math.min(
                      config.maxCalls,
                      config.population * config.days * config.llmDailyCalls,
                    ),
                  )}{' '}
                  次（含重试）；日常规则动作不调用模型。每格 6.25 ha，背包按 kg
                  计，食物按种类与储藏条件损耗；成年 16 岁、妊娠 280 天。
                </>
              ) : (
                <>
                  按初始人口估计，约{' '}
                  {fmt(
                    config.population *
                      (config.days * config.dailyAP + Math.floor(config.days / 5)),
                  )}{' '}
                  次常规决策与反思；免费丢弃、重试和新增人口会增加调用。
                </>
              )}
            </div>
            <button
              className="primary"
              disabled={controlBusy || (running && !externalName)}
              onClick={() => void startExperiment()}
            >
              {controlBusy ? '正在启动…' : '启动后台实验 ↗'}
            </button>
            <button
              disabled={running || controlBusy}
              onClick={() => {
                selectSource(undefined, false);
                send('create', {
                  config: {
                    ...config,
                    contextWindow: config.contextWindow ?? contextWindow ?? 65536,
                  },
                });
                setAgentId(undefined);
                setSelected(null);
                setSettings(false);
                setPage('world');
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
            <h3>行动 / 反思</h3>
            <pre>{JSON.stringify(decision.decision ?? decision.reflection, null, 2)}</pre>
            <h3>模型响应与校验</h3>
            <pre>{JSON.stringify(decision.attempts, null, 2)}</pre>
            {decision.attempts.filter((a) => a.contextTrace).at(-1)?.contextTrace ? (
              <ContextTrace
                turnId={
                  decision.attempts.filter((a) => a.contextTrace).at(-1)!.contextTrace!.turnId
                }
              />
            ) : (
              <>
                <h3>角色当时可见的上下文</h3>
                {decision.contextSource === 'reconstructed-from-events' && (
                  <p className="note">
                    这条早期记录的观察从动作发生前的历史状态重建，原保存副本保留在导出文件中。
                  </p>
                )}
                {decision.contextPruned ? (
                  <p className="note">
                    规则动作保留结构化行动和状态增量；当时的世界状态可通过历史回放查看。
                  </p>
                ) : (
                  <pre>{JSON.stringify(decision.context, null, 2)}</pre>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
