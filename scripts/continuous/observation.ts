import {
  manorObservation,
  manorAtlas,
  homeStorageObservation,
} from '../../frontend/src/continuous/manor/observation';
import { visibleStore, carryingCapacity } from '../../frontend/src/continuous/manor/rules';
import {
  body,
  position,
  clockLabel,
  type Event,
  type World,
} from '../../frontend/src/continuous/types';
export function observation(w: World, actorId: number, events: Event[], after: number) {
  const a = w.agents.find((a) => a.id === actorId)!,
    p = position(a, w.time),
    b = body(a, w.time);
  const near = (v: { x: number; y: number }) => Math.hypot(v.x - p.x, v.y - p.y) <= 30;
  const people = w.agents
    .filter((v) => v.id !== a.id && near(position(v, w.time)))
    .map(
      (v) =>
        `${v.name}#${v.id} ${v.sex} ${v.dead ? '尸体' : '活着'} @${position(v, w.time).x.toFixed(1)},${position(v, w.time).y.toFixed(1)}`,
    );
  const stores = w.stores
    .filter((v) => visibleStore(w, a, v))
    .map(
      (v) =>
        `${v.id} 当前谷物${v.grain.toFixed(2)}kg，可领取${(v.grain - v.reserved).toFixed(2)}kg`,
    );
  const heard = events.filter(
    (e) => e.seq > after && (e.actor === a.id || e.listeners?.includes(a.id)) && e.text,
  );
  const text =
    `${clockLabel(w.time)}，观察边界E${w.seq}。你在(${p.x.toFixed(1)},${p.y.toFixed(1)})米，生命${b.hp.toFixed(1)}，饱食度${(b.food / 50).toFixed(1)}，随身口粮${a.grain.toFixed(2)}kg，运输总负重上限${carryingCapacity(a)}kg。\n` +
    `当前意图：${a.intent}；当前任务：${a.task ? `${a.task.kind} ${a.task.target} ${a.task.amount.toFixed(2)}kg` : '无'}；实际动作：${a.action?.kind ?? '空闲'}。${a.blocked ? `受阻：${a.blocked.reason}` : ''}\n` +
    `导航控制：navigate会关闭自动补粮、农活、存粮和闲暇返回，保留eat设置；同一导航计划附带routine也不会恢复这些任务。抵达后留在原地，恢复需在后续计划显式设置routine。\n` +
    `当前自动日程：eat=${a.routine.eat}, fetch=${a.routine.fetch}, reserveDays=${a.routine.reserveDays}, work=${a.routine.work}；${homeStorageObservation(w, a)}。\n` +
    `当前可听见talk/public_speak（12米）的活人：${
      w.agents
        .filter(
          (v) =>
            v.id !== a.id &&
            !v.dead &&
            !v.away &&
            Math.hypot(position(v, w.time).x - p.x, position(v, w.time).y - p.y) <= 12,
        )
        .map((v) => `#${v.id}`)
        .join(',') || '无'
    }；shout（75米）的活人：${
      w.agents
        .filter(
          (v) =>
            v.id !== a.id &&
            !v.dead &&
            !v.away &&
            Math.hypot(position(v, w.time).x - p.x, position(v, w.time).y - p.y) <= 75,
        )
        .map((v) => `#${v.id}`)
        .join(',') || '无'
    }。声音只在发言结束时覆盖范围内的人，远方写信。\n` +
    `可见居民：${people.join('；') || '无'}。现场储藏：${stores.join('；') || '无法看到当前库存，请去粮箱现场查看'}。\n` +
    `附近农田：${w.fields
      .filter(near)
      .map(
        (f) =>
          `${f.id}劳动${Math.round(f.work / 60000)}/${Math.round(f.required / 60000)}分钟，待收谷物${f.harvest.toFixed(2)}kg`,
      )
      .join('；')}\n` +
    `自上次思考后经历：\n${heard.map((e) => `E${e.seq} ${clockLabel(e.time)} #${e.actor ?? '世界'} ${e.type}: ${e.text}${e.type === 'speech' && e.actor === a.id ? `（实际听众：${e.listeners?.map((id) => `#${id}`).join(',') || '无人听到'}）` : ''}`).join('\n') || '无新事件'}`;
  return {
    actor: a.id,
    person: {
      id: a.id,
      name: a.name,
      sex: a.sex,
      personality: a.personality,
      biography: a.biography,
    },
    atlas: w.sites.map((s) => `${s.id}=${s.label} @(${s.x},${s.y})米`).join('\n') + manorAtlas(w),
    observation: text + '\n' + manorObservation(w, a),
  };
}
