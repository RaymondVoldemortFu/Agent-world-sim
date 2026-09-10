import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../runtime/store';
import { matchesEvent } from '../runtime/event-search';
import type { World, WorldEvent } from '../sim/types';

const PAGE_SIZE = 120;

export function useChronicle(
  world: World | undefined,
  historySeq: number | undefined,
  externalName: string | undefined,
  query: string,
  eventType: string,
  enabled = true,
) {
  const [needle, setNeedle] = useState(query);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ key: symbol | null; before?: number; through?: number }>({
    key: null,
  });
  const [result, setResult] = useState<{
    key: symbol | null;
    events: WorldEvent[];
    cursor?: number;
    through?: number;
  }>({ key: null, events: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const currentWorld = useRef(world);
  currentWorld.current = world;
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query), 350);
    return () => clearTimeout(timer);
  }, [query]);
  // A new search scope stays distinct even when returning to a previous query.
  const key = useMemo(
    () => Symbol('chronicle'),
    [world?.id, externalName, historySeq, needle, eventType, revision],
  );
  const before = page.key === key ? page.before : undefined;
  const through = page.key === key ? page.through : undefined;
  // Live updates refresh only the unfiltered first page. Search/pagination retain
  // their checkpoint boundary until the reader explicitly refreshes.
  const liveSeq =
    enabled && historySeq === undefined && !needle.trim() && !eventType && before === undefined
      ? world?.seq
      : undefined;
  useEffect(() => {
    const w = currentWorld.current;
    if (!w || !enabled || query !== needle) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const run = async () => {
      try {
        const boundary = through ?? historySeq ?? w.seq;
        let rows: WorldEvent[],
          cursor: number | undefined,
          committed = boundary;
        if (externalName) {
          const params = new URLSearchParams({
            q: needle,
            event_type: eventType,
            limit: String(PAGE_SIZE),
            through: String(boundary),
          });
          if (before !== undefined) params.set('before', String(before));
          const res = await fetch(
            `/api/experiments/${encodeURIComponent(externalName)}/events?${params}`,
            { signal: controller.signal },
          );
          if (!res.ok) throw new Error('无法检索实验事件');
          const data = await res.json();
          rows = data.events;
          cursor = data.hasMore ? (data.nextCursor ?? rows.at(-1)?.seq) : undefined;
          committed = data.through ?? boundary;
        } else {
          const found = await db.events
            .where('[runId+seq]')
            .between([w.id, 0], [w.id, Math.min(boundary, (before ?? Infinity) - 1)], true, true)
            .reverse()
            .filter((e) => matchesEvent(e, needle, eventType))
            .limit(PAGE_SIZE + 1)
            .toArray();
          rows = found.slice(0, PAGE_SIZE);
          cursor = found.length > PAGE_SIZE ? rows.at(-1)?.seq : undefined;
        }
        if (active)
          setResult((old) => ({
            key,
            cursor,
            through: committed,
            events:
              before !== undefined && old.key === key
                ? [...old.events.filter((e) => e.seq >= before), ...rows]
                : rows,
          }));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, liveSeq, before, through, externalName, historySeq, needle, eventType, enabled, query]);
  return {
    events: result.key === key ? result.events : [],
    eventsLoading: loading || query !== needle,
    eventsError: error,
    hasMoreEvents: result.key === key && result.cursor !== undefined,
    loadMoreEvents: () => {
      if (!loading && result.key === key && result.cursor !== undefined)
        setPage({ key, before: result.cursor, through: result.through });
    },
    refreshEvents: () => setRevision((r) => r + 1),
  };
}
