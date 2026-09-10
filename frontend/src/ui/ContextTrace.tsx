import { useEffect, useState } from 'react';
export default function ContextTrace({ turnId }: { turnId: string }) {
  const [data, setData] = useState<{
    trace: {
      epoch: number;
      reusedMessages: number;
      recalled: number;
      compressed: boolean;
      estimatedTokens: number;
    };
    messages: { role: string; content: string }[];
  }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError('');
    fetch(`/api/context/${turnId}`, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error('无法读取该会话；请确认已导入会话档案。');
        setData(await r.json());
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [turnId]);
  return (
    <section aria-label="实际模型上下文">
      <h3>实际发送的上下文</h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>读取会话中…</p>
      ) : (
        <>
          <p className="note">
            上下文周期 {data.trace.epoch} · 复用 {data.trace.reusedMessages} 条历史消息 · 找回{' '}
            {data.trace.recalled} 条记忆 · 输入估算 {data.trace.estimatedTokens} tokens
            {data.trace.compressed ? ' · 本轮已压缩历史' : ''}
          </p>
          <details>
            <summary>查看固定规则、人格与增量会话</summary>
            {data.messages.map((m, i) => (
              <div key={i}>
                <h4>
                  {m.role} · {i + 1}
                </h4>
                <pre>{m.content}</pre>
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
