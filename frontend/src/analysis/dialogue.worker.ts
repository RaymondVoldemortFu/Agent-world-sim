import { ContinuousSpeechReader } from './continuous-dialogue';
import { db } from '../runtime/store';
import type { WorldEvent } from '../sim/types';
import {
  classify,
  speechEvent,
  filterSpeech,
  summarize,
  SimilarityIndex,
  type Filters,
  type ClassifiedSpeech,
} from './dialogue';
let rows: ClassifiedSpeech[] = [];
let similarity: SimilarityIndex;
let ready = false;
let filters: Filters = { heardOnly: true };
let requestId = 0;
let offset = 0;
function result() {
  if (!ready) return;
  const filtered = filterSpeech(rows, filters);
  postMessage({
    type: 'result',
    requestId,
    corpus: rows.length,
    summary: summarize(filtered),
    rows: [...filtered].reverse().slice(offset, offset + 60),
    offset,
    hasMore: filtered.length > offset + 60,
  });
}
self.onmessage = async ({ data }) => {
  if (data.type === 'query') {
    filters = data.filters;
    requestId = data.requestId;
    offset = data.offset ?? 0;
    result();
    return;
  }
  if (data.type === 'similar') {
    if (ready)
      postMessage({
        type: 'similar',
        requestId: data.requestId,
        seq: data.seq,
        matches: similarity.similar(
          data.seq,
          new Set(filterSpeech(rows, filters).map((r) => r.seq)),
        ),
      });
    return;
  }
  if (data.type !== 'load') return;
  try {
    const events = new Map<number, Omit<WorldEvent, 'patch'>>();
    if (data.continuous) {
      const reader = new ContinuousSpeechReader();
      let after = 0;
      while (true) {
        const params = new URLSearchParams({
          after: String(after),
          through: String(data.through),
          limit: '1000',
        });
        const response = await fetch(
          `/continuous-api/runs/${encodeURIComponent(data.continuous)}/dialogue?${params}`,
        );
        if (!response.ok) throw Error('连续实验对话读取失败，请刷新重试');
        const page = await response.json();
        for (const e of page.events) {
          const speech = reader.read(e);
          if (speech) events.set(speech.seq, speech);
        }
        postMessage({ type: 'progress', count: events.size });
        if (!page.hasMore) break;
        if (!Number.isInteger(page.nextCursor) || page.nextCursor <= after)
          throw Error('对话分页未前进');
        after = page.nextCursor;
      }
    } else if (data.external) {
      await Promise.all(
        ['chat', 'shout', 'public_speak'].map(async (type) => {
          let before: number | undefined;
          while (true) {
            const params = new URLSearchParams({
              event_type: type,
              limit: '200',
              through: String(data.through),
            });
            if (before !== undefined) params.set('before', String(before));
            const response = await fetch(
              `/api/experiments/${encodeURIComponent(data.external)}/events?${params}`,
            );
            if (!response.ok) throw Error('对话读取失败，请刷新重试');
            const page = await response.json();
            for (const e of page.events) events.set(e.seq, e);
            postMessage({ type: 'progress', count: events.size });
            if (!page.hasMore) break;
            const next = page.nextCursor ?? page.events.at(-1)?.seq;
            if (!Number.isInteger(next) || (before !== undefined && next >= before))
              throw Error('对话分页未前进');
            before = next;
          }
        }),
      );
    } else {
      await db.events
        .where('[runId+seq]')
        .between([data.runId, 0], [data.runId, data.through], true, true)
        .each((e) => {
          if (['chat', 'shout', 'public_speak'].includes(e.type)) {
            const { patch, ...metadata } = e;
            events.set(e.seq, metadata);
          }
        });
    }
    rows = [...events.values()]
      .sort((a, b) => a.seq - b.seq)
      .flatMap((e) => {
        const s = speechEvent(e);
        return s ? [classify(s)] : [];
      });
    similarity = new SimilarityIndex(rows);
    ready = true;
    result();
  } catch (error) {
    postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
