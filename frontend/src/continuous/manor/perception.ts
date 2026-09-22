import { position, type Agent, type Point, type World } from '../types';

export const DOOR_NOISE_RADIUS = 150;
export const DOOR_ALARM_WAKE_INTERVAL = 3_600_000;
export type DoorAlarm = {
  door: string;
  attacker: number;
  at: Point;
  time: number;
  stage: 'start' | 'hit' | 'broken';
  lastWakeAt: number;
};
/** Sound crosses walls; only living, present agents in range receive this event. */
export function hearDoorNoise(
  w: World,
  attacker: Agent,
  door: string,
  at: Point,
  stage: DoorAlarm['stage'],
) {
  const listeners: number[] = [];
  for (const a of w.agents) {
    if (a.id === attacker.id || a.dead || a.away) continue;
    const p = position(a, w.time);
    if (Math.hypot(p.x - at.x, p.y - at.y) > DOOR_NOISE_RADIUS) continue;
    listeners.push(a.id);
    const prior = a.doorAlarm;
    const wake =
      !prior ||
      prior.door !== door ||
      prior.attacker !== attacker.id ||
      stage === 'broken' ||
      w.time - prior.lastWakeAt >= DOOR_ALARM_WAKE_INTERVAL;
    a.doorAlarm = {
      door,
      attacker: attacker.id,
      at: { ...at },
      time: w.time,
      stage,
      lastWakeAt: wake ? w.time : prior.lastWakeAt,
    };
    if (wake) {
      a.nextThink = Math.min(a.nextThink, w.time);
      if (a.thinking) {
        // The old request did not see this alarm; it must not overwrite the eventual response.
        a.planVersion++;
        a.replanAfterAlarm = true;
      }
    }
  }
  return listeners;
}
export function doorAlarmObservation(w: World, a: Agent) {
  const alarm = a.doorAlarm;
  if (!alarm) return '';
  return `破门警报（${((w.time - alarm.time) / 3_600_000).toFixed(2)}游戏小时前听到）：#${alarm.attacker}在${alarm.door} @(${alarm.at.x.toFixed(1)},${alarm.at.y.toFixed(1)})米${alarm.stage === 'start' ? '开始砸门' : alarm.stage === 'broken' ? '已经打破门锁' : '砸击门锁'}。这是当时声音，不保证对方现在仍在原地。你可选择attack,target=agent:${alarm.attacker}出战阻止，也可求援、协商或撤离；不是强制战斗。`;
}
