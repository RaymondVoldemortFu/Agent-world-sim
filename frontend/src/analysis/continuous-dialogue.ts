import type { WorldEvent } from '../sim/types';
import { DAY } from '../continuous/types';

type Channel = 'talk' | 'public_speak' | 'shout';
export type ContinuousDialogueEvent = {
  seq: number;
  time: number;
  type: string;
  actor?: number;
  channel?: Channel;
  text: string;
  listeners?: number[];
};
/** Carry start metadata across forward pages; only finished utterances count. */
export class ContinuousSpeechReader {
  private channels = new Map<number, Channel>();
  read(e: ContinuousDialogueEvent): Omit<WorldEvent, 'patch'> | undefined {
    if (e.actor === undefined) return;
    if (e.type === 'speaking') {
      if (e.channel) this.channels.set(e.actor, e.channel);
      return;
    }
    if (e.type !== 'speech') return;
    const channel = e.channel ?? this.channels.get(e.actor);
    this.channels.delete(e.actor);
    // Unknown historical channels remain visible as ordinary speech, never inferred from words.
    return {
      seq: e.seq,
      day: Math.floor(e.time / DAY) + 1,
      round: 0,
      type: channel === 'shout' || channel === 'public_speak' ? channel : 'chat',
      actorId: e.actor,
      text: e.text,
      recipients: e.listeners ?? [],
      success: true,
      decisionId: `continuous:${e.time}:${e.seq}`,
    };
  }
}
