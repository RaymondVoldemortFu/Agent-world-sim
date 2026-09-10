import type { World, DecisionRecord } from '../sim/types';

export function contextHeads(world: World, records: DecisionRecord[]) {
  return [
    ...new Set([
      ...world.agents.flatMap((a) => (a.brain?.contextHead ? [a.brain.contextHead] : [])),
      ...records.flatMap((r) =>
        r.attempts.flatMap((a) => (a.contextTrace ? [a.contextTrace.turnId] : [])),
      ),
    ]),
  ];
}

export async function transferContexts(
  operation: 'export' | 'import',
  runId: string,
  heads: string[],
  nodes?: unknown[],
  base = '',
): Promise<unknown[]> {
  if (!heads.length && !nodes?.length) return [];
  const response = await fetch(`${base}/api/context-archive/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, heads, nodes }),
  });
  if (!response.ok) throw Error('会话档案传输失败；请确认后端可用并导入完整上下文。');
  return (await response.json()).nodes ?? [];
}
