import { DAY, type World, type Agent, type Task } from '../types';
export const letterTask = (t: Task) =>
  ['write_letter', 'forward_letter', 'reject_letter'].includes(t.kind);
export function validateLetter(w: World, a: Agent, t: Task): string | undefined {
  if (t.kind === 'write_letter') {
    const b = w.agents.find((b) => `agent:${b.id}` === t.target);
    if (!b || b.dead || b.away || b.id === a.id)
      return '写信需用 target=agent:ID 指定另一名在世居民';
    if (!t.text?.trim()) return '写信需要 text 正文';
  } else {
    const letter = w.manor?.letters?.find((l) => l.id === t.target);
    if (!letter || letter.status !== 'held' || letter.holder !== a.id)
      return '只能处理你持有的待审信件，target 必须是信件ID';
    if (t.kind === 'reject_letter' && !t.text?.trim()) return '扣下信件需要 text 说明理由';
  }
}
export function settleLetter(w: World, a: Agent, t: Task) {
  const letters = (w.manor!.letters ??= []);
  if (t.kind === 'write_letter') {
    const id = `letter-${a.id}-${w.seq}-${letters.length + 1}`;
    const to = Number(t.target.slice(6));
    const direct = a.id === w.manor!.stewardAgent && w.manor!.household?.includes(to);
    letters.push({
      id,
      from: a.id,
      to,
      text: t.text!,
      sentAt: w.time,
      dueAt: w.time + (direct ? DAY / 24 : DAY),
      status: direct ? 'forwarding' : 'transit',
    });
    return direct
      ? `信件 ${id} 已寄出，管家直送庄园成员，写完1游戏小时后直接抵达，不再自审`
      : `信件 ${id} 已寄出，写完1天后投递；寄给庄园成员的信先交管家审阅`;
  }
  const letter = letters.find((l) => l.id === t.target)!;
  if (t.kind === 'forward_letter') {
    letter.status = 'forwarding';
    letter.dueAt = w.time + DAY;
    return `已转寄 ${letter.id} 给原收件人 #${letter.to}，1天后到达`;
  }
  letter.status = 'rejected';
  letter.note = t.text;
  return `已扣下 ${letter.id}：${t.text}`;
}
export function nextLetterTime(w: World) {
  return Math.min(
    Infinity,
    ...(w.manor?.letters ?? [])
      .filter((l) => l.status === 'transit' || l.status === 'forwarding')
      .map((l) => l.dueAt),
  );
}
export function deliverLetters(w: World): { text: string; actor: number; listeners: number[] }[] {
  const notices: { text: string; actor: number; listeners: number[] }[] = [];
  for (const letter of w.manor?.letters ?? []) {
    if (!['transit', 'forwarding'].includes(letter.status) || letter.dueAt > w.time) continue;
    const intercepted = letter.status === 'transit' && w.manor!.household?.includes(letter.to);
    const recipient = w.agents.find(
      (a) => a.id === (intercepted ? w.manor!.stewardAgent : letter.to),
    );
    const target = w.agents.find((a) => a.id === letter.to);
    if (!recipient || recipient.dead || recipient.away || !target || target.dead || target.away) {
      letter.status = 'undeliverable';
      letter.note = '收件人或负责审信的管家已死亡、离场或不存在';
      notices.push({
        text: `${letter.id} 无法投递：${letter.note}`,
        actor: letter.from,
        listeners: [],
      });
      continue;
    }
    letter.holder = recipient.id;
    letter.receivedAt = w.time;
    letter.status = intercepted && recipient.id !== letter.to ? 'held' : 'delivered';
    recipient.nextThink = Math.min(recipient.nextThink, w.time);
    notices.push({
      text: `${letter.id} 来信已${letter.status === 'held' ? '交管家待审' : '送达'}；请查看私人信箱`,
      actor: letter.from,
      listeners: [recipient.id],
    });
  }
  return notices;
}
export function mailbox(w: World, a: Agent) {
  return (w.manor?.letters ?? [])
    .filter(
      (l) => l.from === a.id || l.holder === a.id || (l.status === 'delivered' && l.to === a.id),
    )
    .map(
      (l) =>
        `${l.id} #${l.from}→#${l.to} ${l.status}${['transit', 'forwarding'].includes(l.status) ? `，距投递${Math.max(0, l.dueAt - w.time) / DAY}天` : ''}：${l.text}${l.note ? `（${l.note}）` : ''}`,
    )
    .join('\n');
}
