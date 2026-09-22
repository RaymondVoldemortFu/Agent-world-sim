import { isDeepStrictEqual } from 'node:util';
import type { Event, World } from '../../frontend/src/continuous/types';

export type CommitPayload = { world: World; events: Event[]; expected: number; snapshot: boolean };
type Gateway = (path: string, data?: unknown) => Promise<unknown>;

/** Keep one immutable transaction until its durable outcome is known. */
export class PendingCommit {
  payload?: CommitPayload;

  async save(payload: CommitPayload, api: Gateway): Promise<CommitPayload> {
    this.payload ??= structuredClone(payload);
    const pending = this.payload;
    let error: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await api(`/runs/${pending.world.id}/commit`, pending);
        this.payload = undefined;
        return pending;
      } catch (e) {
        error = e;
        // A timeout does not imply a rollback. Confirm the full state, not only its seq.
        try {
          const durable = await api(`/runs/${pending.world.id}`);
          if (isDeepStrictEqual(durable, pending.world)) {
            this.payload = undefined;
            return pending;
          }
        } catch {
          // Keep the original payload even when verification is unavailable.
        }
      }
    }
    throw error;
  }
}
