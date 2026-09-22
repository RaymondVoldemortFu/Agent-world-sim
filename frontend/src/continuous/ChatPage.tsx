import { useEffect, useRef, useState } from 'react';
import { clockLabel, type World } from './types';
import './chat.css';
type Session = {
  id: string;
  actor: number;
  title: string;
  revision: number;
  busy?: string;
  created: string;
  updated: string;
};
type Turn = {
  id: string;
  user_text: string;
  reasoning: boolean;
  status: string;
  answer?: string;
  summary?: string;
  reasoning_content?: string;
  error?: string;
  usage_json?: { total_tokens?: number };
};
type Detail = Session & {
  metadata: {
    name: string;
    dead: boolean;
    source: string;
    seq: number;
    time: number;
    estimatedTokens: number;
    lastObservation?: string;
  };
  turns: Turn[];
};
async function api<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch('/chat-api' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  });
  const value = await r.json();
  if (!r.ok)
    throw Error(typeof value.detail === 'string' ? value.detail : `请求失败 (${r.status})`);
  return value;
}
export default function ChatPage({
  world,
  agentId,
  onAgent,
}: {
  world?: World;
  agentId: number;
  onAgent: (id: number) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [sid, setSid] = useState(''),
    [detail, setDetail] = useState<Detail>();
  const [draft, setDraft] = useState(''),
    [editing, setEditing] = useState<string>(),
    [reasoning, setReasoning] = useState(false);
  const [error, setError] = useState(''),
    [posting, setPosting] = useState(false),
    [refresh, setRefresh] = useState(0),
    [listRevision, setListRevision] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [connection, setConnection] = useState('');
  const run = world?.id,
    base = run ? `/runs/${encodeURIComponent(run)}/chats` : '';
  const storageKey = `agent-chat:${run}:${agentId}`;
  useEffect(() => {
    setSid('');
    setDetail(undefined);
    setDraft('');
    setEditing(undefined);
    setError('');
    setSessions([]);
    if (!run) return;
    const abort = new AbortController();
    api<Session[]>(`${base}?actor=${agentId}`, undefined, abort.signal)
      .then((rows) => {
        setSessions(rows);
        const saved = localStorage.getItem(storageKey);
        setSid(rows.some((s) => s.id === saved) ? saved! : (rows[0]?.id ?? ''));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [run, agentId]);
  useEffect(() => {
    if (!run) return;
    const abort = new AbortController();
    api<Session[]>(`${base}?actor=${agentId}`, undefined, abort.signal)
      .then(setSessions)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [run, agentId, listRevision]);
  useEffect(() => {
    setDetail(undefined);
    setEditing(undefined);
    setDraft('');
    if (!sid) return;
    localStorage.setItem(storageKey, sid);
    const abort = new AbortController();
    let stream: EventSource | undefined;
    follow.current = true;
    setConnection('');
    const load = async () => {
      try {
        const data = await api<Detail>(`${base}/${sid}`, undefined, abort.signal);
        if (abort.signal.aborted) return;
        setDetail(data);
        if (!data.busy) {
          setListRevision((n) => n + 1);
          return;
        }
        stream = new EventSource(`/chat-api${base}/${sid}/stream`);
        stream.onopen = () => setConnection('实时连接');
        stream.onerror = () => setConnection('连接中断，正在自动重连…');
        stream.addEventListener('snapshot', (e) => {
          if (abort.signal.aborted) return;
          setDetail(JSON.parse((e as MessageEvent).data));
        });
        stream.addEventListener('delta', (e) => {
          if (abort.signal.aborted) return;
          const delta = JSON.parse((e as MessageEvent).data) as {
            id: string;
            answerOffset: number;
            answer: string;
            reasoningOffset: number;
            reasoning_content: string;
          };
          setDetail(
            (previous) =>
              previous && {
                ...previous,
                turns: previous.turns.map((turn) =>
                  turn.id !== delta.id
                    ? turn
                    : {
                        ...turn,
                        answer: (turn.answer ?? '').slice(0, delta.answerOffset) + delta.answer,
                        reasoning_content:
                          (turn.reasoning_content ?? '').slice(0, delta.reasoningOffset) +
                          delta.reasoning_content,
                      },
                ),
              },
          );
        });
        stream.addEventListener('done', () => {
          stream?.close();
          setConnection('');
          setListRevision((n) => n + 1);
        });
        stream.addEventListener('deleted', () => {
          stream?.close();
          setConnection('');
          setSid('');
          setDetail(undefined);
          setListRevision((n) => n + 1);
        });
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      }
    };
    void load();
    return () => {
      abort.abort();
      stream?.close();
    };
  }, [sid, base, refresh]);
  useEffect(() => {
    if (box.current && follow.current) box.current.scrollTop = box.current.scrollHeight;
  }, [detail]);
  async function create() {
    setPosting(true);
    setError('');
    try {
      const data = await api<{ id: string }>(base, { actor: agentId });
      setSid(data.id);
      setListRevision((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  }
  async function send(content = draft, fromTurn = editing) {
    if (!detail || !content.trim() || detail.busy || posting) return;
    setPosting(true);
    setError('');
    try {
      await api(`${base}/${sid}/messages`, {
        content,
        fromTurn,
        reasoning,
        revision: detail.revision,
        requestId: crypto.randomUUID(),
      });
      setDraft('');
      setEditing(undefined);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  }
  async function remove(entire: boolean) {
    if (!detail) return;
    setPosting(true);
    setError('');
    try {
      await api(`${base}/${sid}/delete`, { session: entire, revision: detail.revision });
      if (entire) {
        localStorage.removeItem(storageKey);
        setSid('');
        setDetail(undefined);
      } else setRefresh((n) => n + 1);
      setListRevision((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  }
  const actor = world?.agents.find((a) => a.id === agentId);
  return (
    <section className="agent-chat" aria-label="Agent访谈">
      <aside className="chat-sidebar">
        <div className="chat-kicker">PRIVATE INTERVIEWS</div>
        <h2>Agent 访谈</h2>
        <label>
          访谈对象
          <select
            aria-label="访谈对象"
            value={agentId}
            disabled={posting}
            onChange={(e) => onAgent(Number(e.target.value))}
          >
            {world?.agents.map((a) => (
              <option value={a.id} key={a.id}>
                #{a.id} {a.name} · {a.dead ? '已死亡' : a.away ? '已离场' : '存活'}
              </option>
            ))}
          </select>
        </label>
        <button className="chat-primary" disabled={!world || posting} onClick={() => void create()}>
          ＋ 新建独立会话
        </button>
        <div className="chat-session-heading">
          会话历史 <span>{sessions.length}</span>
        </div>
        <div className="chat-sessions" aria-label="会话历史">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={sid === s.id ? 'selected' : ''}
              disabled={posting}
              onClick={() => {
                setSid(s.id);
                setError('');
              }}
            >
              <strong>{s.title}</strong>
              <small>
                {s.busy ? '正在回答 · ' : ''}
                {s.updated.replace('T', ' ').slice(0, 16)}
              </small>
            </button>
          ))}
          {!sessions.length && <p className="chat-muted">这个角色还没有访谈会话。</p>}
        </div>
        <p className="chat-muted">
          每个会话保留独立的认知快照与聊天记录。访谈不进入实验，也不会复活角色。
        </p>
      </aside>
      <div className="chat-main">
        <header className="chat-header">
          <div>
            <div className="chat-kicker">
              #{agentId} · {actor?.dead ? '已死亡角色' : '角色访谈'}
            </div>
            <h2>{actor?.name ?? '选择一名角色'}</h2>
            {detail && (
              <>
                <p>
                  冻结于{clockLabel(detail.metadata.time)} · E{detail.metadata.seq} · 估算
                  {(detail.metadata.estimatedTokens / 1000).toFixed(1)}k tokens
                </p>
                <p>末次保留观察：{detail.metadata.lastObservation ?? '无逐次观察记录'}</p>
              </>
            )}
          </div>
          <div className="chat-tools">
            <button disabled={!detail || posting} onClick={() => void remove(false)}>
              清空记录
            </button>
            <button disabled={!detail || posting} onClick={() => void remove(true)}>
              删除会话
            </button>
          </div>
        </header>
        {error && (
          <div className="chat-error" role="alert">
            {error}
            <button
              onClick={() => {
                setRefresh((n) => n + 1);
                setError('');
              }}
            >
              重新加载
            </button>
          </div>
        )}
        {detail?.metadata.source === 'biography_only' && (
          <div className="chat-notice">
            此角色没有历史 LLM 上下文；本会话仅依据初始个人背景，不代表真实保留的决策记忆。
          </div>
        )}
        <div
          className="chat-messages"
          role="log"
          aria-label="聊天记录"
          ref={box}
          onScroll={() => {
            const el = box.current;
            if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {!sid ? (
            <div className="chat-empty">
              <span>问一问，当时的他在想什么。</span>
              <p>选择角色并新建会话，可以围绕认知、记忆与决策依据提问。</p>
              <button disabled={!world || posting} onClick={() => void create()}>
                开始访谈 {actor?.name}
              </button>
            </div>
          ) : !detail ? (
            <p className="chat-muted">加载会话…</p>
          ) : !detail.turns.length ? (
            <div className="chat-empty">
              <span>会话已准备好</span>
              <p>例如：你最后记得的粮仓库存是多少？你为什么没有去领取粮食？</p>
            </div>
          ) : (
            detail.turns.map((t, i) => (
              <div key={t.id} className="chat-turn">
                <article className="chat-message user">
                  <div className="chat-message-label">
                    你 <span>#{i + 1}</span>
                  </div>
                  <div className="chat-text">{t.user_text}</div>
                  <button
                    disabled={!!detail.busy || posting}
                    onClick={() => {
                      setEditing(t.id);
                      setDraft(t.user_text);
                      setReasoning(t.reasoning);
                    }}
                  >
                    修改输入
                  </button>
                </article>
                <article className="chat-message assistant">
                  <div className="chat-message-label">
                    {detail.metadata.name}
                    <span>{t.reasoning ? 'Reasoning 开启' : 'Reasoning 关闭'}</span>
                  </div>
                  <>
                    {t.reasoning_content ? (
                      <details className="chat-reasoning" open>
                        <summary>思考过程</summary>
                        <div className="chat-reasoning-text">{t.reasoning_content}</div>
                      </details>
                    ) : t.reasoning && t.status === 'done' ? (
                      <p className="chat-muted">
                        {t.summary
                          ? '这条旧回答未保存思考原文；开启 Reasoning 后重试可重新生成。'
                          : '模型未返回思考过程。'}
                      </p>
                    ) : null}
                    {t.answer && <div className="chat-text">{t.answer}</div>}
                    {t.status === 'pending' && (
                      <p className="chat-pending" role="status">
                        {connection.startsWith('连接中断')
                          ? connection
                          : t.answer
                            ? '正在回答…'
                            : t.reasoning_content
                              ? '正在思考…'
                              : '等待模型响应…'}
                      </p>
                    )}
                    {t.status === 'error' && <p className="chat-error">{t.error}</p>}
                  </>
                  {t.status !== 'pending' && (
                    <div className="chat-message-actions">
                      <button
                        disabled={!!detail.busy || posting}
                        title="使用当前Reasoning设置，替换此轮及其后续消息"
                        onClick={() => void send(t.user_text, t.id)}
                      >
                        重试回答
                      </button>
                      <small>
                        {t.usage_json?.total_tokens
                          ? `${t.usage_json.total_tokens.toLocaleString()} tokens`
                          : ''}
                      </small>
                    </div>
                  )}
                </article>
              </div>
            ))
          )}
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {editing && (
            <div className="chat-editing">
              正在修改历史输入；发送后替换该轮及后续消息。
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setDraft('');
                }}
              >
                取消修改
              </button>
            </div>
          )}
          <textarea
            aria-label="访谈输入"
            value={draft}
            maxLength={12000}
            disabled={!detail || !!detail.busy || posting}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="向这个角色提问…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="chat-compose-actions">
            <label>
              <input
                type="checkbox"
                checked={reasoning}
                onChange={(e) => setReasoning(e.target.checked)}
              />
              开启 Reasoning
            </label>
            <span>Enter 发送 · Shift+Enter 换行</span>
            <button
              className="chat-primary"
              disabled={!detail || !!detail.busy || posting || !draft.trim()}
            >
              {posting ? '提交中…' : detail?.busy ? '回答中…' : editing ? '保存并重新回答' : '发送'}
            </button>
          </div>
          <p className="chat-footnote">
            开启 Reasoning
            后，回答上方展示模型返回的完整思考过程，可展开或收起。编辑或重试将替换该轮及后续消息。
          </p>
        </form>
      </div>
    </section>
  );
}
