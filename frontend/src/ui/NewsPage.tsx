import { useEffect, useRef, useState } from 'react';
import type { World } from '../sim/types';

type Article = {
  day: number;
  boundary: number;
  article: string;
  mode: 'direct' | 'chunked';
  epochStart: number;
  counts: {
    alive: number;
    dead: number;
    away: number;
    critical: number;
    dialogues: number;
    stores: number;
  };
};
type Feed = {
  enabled: boolean;
  status: string;
  error?: string;
  completedDays: number;
  generatedDays: number;
  rows: Article[];
  nextBefore: number | null;
  calls: number;
  usage: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens: number };
};
function NewsCopy({ text }: { text: string }) {
  const inline = (value: string) =>
    value
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return (
    <div className="news-copy">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((block, i) => {
          const clean = block.replace(/^#{1,6}\s+/, '');
          return i === 0 ? (
            <h3 key={i}>{inline(clean)}</h3>
          ) : /^#{1,6}\s+/.test(block) ? (
            <h4 key={i}>{inline(clean)}</h4>
          ) : (
            <p key={i}>{inline(block)}</p>
          );
        })}
    </div>
  );
}
export default function NewsPage({
  externalName,
  world,
  historical,
  apiBase,
}: {
  externalName?: string;
  world?: Pick<World, 'seq'>;
  historical: boolean;
  apiBase?: string;
}) {
  const [feed, setFeed] = useState<Feed>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [before, setBefore] = useState(1001);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const through = historical ? world?.seq : undefined;
  const endpoint = apiBase ?? `/api/experiments/${encodeURIComponent(externalName ?? '')}/news`;
  useEffect(() => {
    setBefore(1001);
    setFeed(undefined);
    setBusy(false);
    setError('');
    generation.current++;
  }, [externalName]);
  useEffect(() => {
    if (!externalName) return;
    let stopped = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const query = new URLSearchParams({ before: String(before), limit: '10' });
        if (through !== undefined) query.set('through', String(through));
        const res = await fetch(`${endpoint}?${query}`, { signal: abort.signal });
        const data = await res.json();
        if (!res.ok) throw Error(data.detail ?? '无法读取新闻');
        if (!stopped) {
          setFeed(data);
          setError('');
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : '读取失败');
      } finally {
        if (!stopped) timer = setTimeout(load, 8000);
      }
    };
    void load();
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [externalName, endpoint, before, through, revision]);
  const toggle = async () => {
    if (!externalName || busy) return;
    const current = ++generation.current;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !feed?.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.detail ?? '操作失败');
      if (current === generation.current) setRevision((n) => n + 1);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const ratio = feed?.usage.prompt_tokens
    ? (100 * feed.usage.prompt_cache_hit_tokens) / feed.usage.prompt_tokens
    : 0;
  return (
    <section className="data-page news-page" aria-label="当日新闻">
      <div className="data-heading">
        <div>
          <p className="eyebrow">THE DAILY CHRONICLE</p>
          <h2>当日新闻</h2>
          <p className="muted">
            粮仓、人群与交涉的每日报道。以日末实况和当日对话为依据，由独立 LLM 编写。
          </p>
        </div>
        {feed && (
          <div className="data-season">
            {feed.generatedDays} / {feed.completedDays} 期
            <small>
              {historical
                ? '所选回放时点'
                : feed.status === 'generating'
                  ? '正在编写下一期'
                  : feed.enabled
                    ? '自动续写中'
                    : '自动续写已暂停'}
            </small>
          </div>
        )}
      </div>
      {!externalName ? (
        <p className="note">请从实验档案打开 MySQL 实验，生成并保存逐日新闻。</p>
      ) : (
        <>
          <div className="panel-toolbar">
            <button disabled={busy || !feed || historical} onClick={() => void toggle()}>
              {busy
                ? '处理中…'
                : feed?.enabled
                  ? '暂停自动续写'
                  : feed?.error
                    ? '重试并继续'
                    : feed?.generatedDays
                      ? '继续自动续写'
                      : '开启新闻流'}
            </button>
            <button
              onClick={() => {
                setBefore(1001);
                setRevision((n) => n + 1);
              }}
            >
              最新一期
            </button>
            <span className="muted">
              从第 1 天起补齐；此后每次日末结算后自动续写。关闭页面也会继续。
            </span>
          </div>
          <p className="note">
            新闻使用独立的模型请求，消耗额外 tokens。暂停会让正在生成的一期完成；新闻不会进入 Agent
            上下文。
          </p>
          {(error || feed?.error) && (
            <p className="alert" role="alert">
              {error || feed?.error}
            </p>
          )}
          {feed && (
            <div className="data-cards">
              <div className="data-card">
                <span>新闻模型调用</span>
                <strong>{feed.calls}</strong>
              </div>
              <div className="data-card">
                <span>输入 tokens</span>
                <strong>{feed.usage.prompt_tokens.toLocaleString()}</strong>
              </div>
              <div className="data-card">
                <span>输出 tokens</span>
                <strong>{feed.usage.completion_tokens.toLocaleString()}</strong>
              </div>
              <div className="data-card">
                <span>输入缓存命中</span>
                <strong>{ratio.toFixed(1)}%</strong>
              </div>
            </div>
          )}
          <div className="news-feed">
            {feed?.rows.map((row) => (
              <article className="news-article" key={row.day}>
                <header>
                  <span className="news-edition">第 {row.day} 天</span>
                  <span className="muted">
                    日末 E{row.boundary} · {row.counts.dialogues} 条对话
                  </span>
                </header>
                <div className="news-vitals">
                  <span>在场存活 {row.counts.alive}</span>
                  <span>累计死亡 {row.counts.dead}</span>
                  <span>离场存活 {row.counts.away}</span>
                  <span>危急 / 低饱食 {row.counts.critical}</span>
                </div>
                <NewsCopy text={row.article} />
                <footer className="muted">
                  {row.mode === 'chunked' ? '当日对话经完整分段取证后汇编' : '包含当日全部对话'} ·
                  上下文自第 {row.epochStart} 天追加 · AI 报道可能有误，请结合世界纪事核对
                </footer>
              </article>
            ))}
          </div>
          {feed && !feed.rows.length && (
            <p className="note">
              {feed.completedDays === 0
                ? '等待第一个日末结算。'
                : feed.enabled
                  ? '后台正在依日期顺序编写新闻。'
                  : '开启新闻流后，将从首日生成并保存报道。'}
            </p>
          )}
          <div className="panel-toolbar">
            <button disabled={!feed?.nextBefore} onClick={() => setBefore(feed!.nextBefore!)}>
              更早十期
            </button>
          </div>
        </>
      )}
    </section>
  );
}
