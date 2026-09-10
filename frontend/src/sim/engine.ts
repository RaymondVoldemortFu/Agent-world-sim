import { nextEco, startEco, stepEco, observeEco, metricsEco, ecoId } from '../ecology/engine';
import { Tx } from './transaction';
import {
  ActionSchema,
  ConfigSchema,
  type Action,
  type Agent,
  type Decision,
  type Reflection,
  type World,
  type WorldEvent,
  type Patch,
  type Memory,
  type Inventory,
  type Item,
  type Metrics,
  type FoodBatch,
} from './types';
import {
  add,
  count,
  tileAt,
  weight,
  living,
  adult,
  visible,
  makeAgent,
  SHOUT_AP,
  SHOUT_RADIUS,
} from './world';
import { foodSummary, mergeFood, splitFood, validateFood } from './food';
import { SURVEY_AP, SURVEY_RADIUS, visibleCorpses, surveyArea } from './perception';
import { SOCIAL_RULES, lonelinessCapacity, recordSpeaking } from './social';
import { RECIPES } from './recipes';
export { RECIPES } from './recipes';
export function decisionIdFor(w: World, agentId: number) {
  if (w.ecology)
    return ecoId(
      w,
      w.agents.find((a) => a.id === agentId)!,
    );
  const c = w.cursor;
  const free = c.ids[c.index] === agentId ? (c.freeActions ?? 0) : 0;
  return `${w.id}:${w.tick}:${c.phase}:${c.round}:${agentId}${free ? `:free-${free}` : ''}`;
}
export function nextTask(
  w: World,
): { kind: 'action' | 'reflection'; agent: Agent; id: string } | null {
  if (w.ecology) return nextEco(w);
  const c = w.cursor;
  if (c.phase === 'complete' || c.phase === 'end') return null;
  while (c.index < c.ids.length) {
    const a = w.agents.find((a) => a.id === c.ids[c.index]);
    if (a && !a.death && (c.phase === 'reflections' || a.ap > 0))
      return {
        kind: c.phase === 'actions' ? 'action' : 'reflection',
        agent: a,
        id: decisionIdFor(w, a.id),
      };
    c.index++;
    if (c.freeActions) c.freeActions = 0;
  }
  if (c.phase === 'actions' && c.round < (w.config.dailyAP ?? 3) - 1) {
    c.round++;
    c.index = 0;
    return nextTask(w);
  }
  if (c.phase === 'actions' && w.tick % 5 === 0) {
    c.phase = 'reflections';
    c.index = 0;
    return nextTask(w);
  }
  c.phase = 'end';
  return null;
}
const brief = (a: Agent) => `${a.name} #${a.id}`;
const inventoryNames: Record<Item, string> = {
  food: '食物',
  wood: '木材',
  stone: '石材',
  ore: '矿石',
  basic_tool: '基础工具',
  advanced_tool: '高级工具',
};

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
function requireMaterials(inv: Inventory, m: Inventory) {
  for (const [k, v] of Object.entries(m))
    assert(count(inv, k as Item) >= v!, `缺少${inventoryNames[k as Item]}`);
}
function consume(inv: Inventory, m: Inventory) {
  for (const [k, v] of Object.entries(m)) add(inv, k as Item, -v!);
}
function sameMaterials(a: Inventory, b: Inventory) {
  return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
}
const allowedChild = new Set([
  'move',
  'shout',
  'public_speak',
  'survey',
  'eat',
  'take',
  'drop',
  'place',
  'give',
  'feed',
  'chat',
  'wait',
]);
export function act(w: World, agentId: number, decision: Decision, decisionId: string): WorldEvent {
  if (w.ecology) return startEco(w, agentId, decision, decisionId);
  const a = w.agents.find((a) => a.id === agentId);
  if (!a || a.death) throw new Error('Cannot schedule a dead or missing agent');
  const tx = new Tx(w);
  tx.a(a);
  assert(a.ap > 0, 'No action points');
  a.ap--;
  a.intent = decision.intent.slice(0, 200);
  let action = decision.action,
    text = '',
    success = true,
    targetId: number | undefined;
  let type: string = action.type;
  const origin = { x: a.x, y: a.y };
  try {
    ActionSchema.parse(action);
    assert(adult(w, a) || allowedChild.has(action.type), '幼年角色不能执行此动作');
    const t = tileAt(w, a.x, a.y);
    const target = (id: number, near = false) => {
      const b = w.agents.find((b) => b.id === id && !b.death);
      assert(b && b.id !== a.id, '目标不存在、已死亡或是自己');
      assert(
        near ? visible(a, b!) : a.x === b!.x && a.y === b!.y,
        near ? '目标不在听闻范围' : '目标必须在同格',
      );
      targetId = id;
      return b!;
    };
    const transfer = (
      from: Inventory,
      to: Inventory,
      item: Item,
      n: number,
      capacity: boolean,
      fromFood?: FoodBatch[],
      toFood?: FoodBatch[],
    ) => {
      assert(count(from, item) >= n, '物品不足');
      assert(
        !capacity ||
          weight(to) + (item.endsWith('tool') ? 2 : 1) * n <= (w.config.inventoryCapacity ?? 12),
        '携带空间不足',
      );
      let food: [FoodBatch[], FoodBatch[]] | undefined;
      if (item === 'food') {
        validateFood(from, fromFood);
        validateFood(to, toFood);
        const { taken, remaining } = splitFood(fromFood, n);
        food = [remaining, mergeFood(toFood, taken)];
      }
      add(from, item, -n);
      add(to, item, n);
      return food;
    };
    const eatFood = (source: Agent, recipient: Agent, quantity: number) => {
      assert(count(source.inventory, 'food') >= quantity, '食物不足');
      validateFood(source.inventory, source.foodBatches);
      const { taken, remaining } = splitFood(source.foodBatches, quantity, w.tick);
      const { fresh, spoiled } = foodSummary(taken, w.tick);
      source.foodBatches = remaining;
      add(source.inventory, 'food', -quantity);
      const restored = 20 * fresh + spoiled * (w.config.spoiledFoodHungerGain ?? 0);
      tx.a(recipient).hunger = Math.min(100, recipient.hunger + restored);
      const damage = spoiled * w.config.spoiledFoodDamage;
      recipient.hp = Math.max(0, recipient.hp - damage);
      if (recipient.hp === 0) tx.die(recipient, '食物腐败');
      return spoiled
        ? `，其中 ${spoiled} 份已腐败，恢复 ${restored} 点饱食度，损失 ${damage} 点生命${recipient.death ? '并死亡' : ''}`
        : '';
    };
    switch (action.type) {
      case 'move': {
        assert(Math.abs(action.dx) + Math.abs(action.dy) === 1, '移动须为上下左右一步');
        const x = a.x + action.dx,
          y = a.y + action.dy;
        assert(x >= 0 && y >= 0 && x < w.config.size && y < w.config.size, '不能越过世界边界');
        a.x = x;
        a.y = y;
        text = `${brief(a)} 移动到 (${x}, ${y})`;
        break;
      }
      case 'survey': {
        assert(a.ap >= SURVEY_AP - 1, `全力观察需要 ${SURVEY_AP} AP`);
        a.ap -= SURVEY_AP - 1;
        a.survey = surveyArea(w, a);
        text = `${brief(a)} 全力观察三格内环境：${a.survey.tiles.length} 个地块、${a.survey.people.length} 名活人、${a.survey.corpses.length} 具尸体`;
        break;
      }
      case 'wait':
        text = `${brief(a)} 暂作等待`;
        break;
      case 'gather':
      case 'harvest': {
        const resource = action.type === 'gather' ? action.resource : 'food';
        const farm = resource === 'food' && t.farm >= 3;
        assert(action.type !== 'harvest' || farm, '脚下没有成熟农田');
        assert(
          resource !== 'stone' ||
            count(a.inventory, 'basic_tool') > 0 ||
            count(a.inventory, 'advanced_tool') > 0,
          '采石需要工具',
        );
        assert(resource !== 'ore' || count(a.inventory, 'advanced_tool') > 0, '采矿需要高级工具');
        const available = farm ? t.farmFood : count(t.resources, resource);
        const n = Math.min(
          available,
          farm ? 4 : 2,
          (w.config.inventoryCapacity ?? 12) - weight(a.inventory),
        );
        assert(n > 0, available <= 0 ? '这里的资源已耗尽' : '携带空间不足');
        if (resource === 'food') {
          validateFood(a.inventory, a.foodBatches);
          a.foodBatches = mergeFood(a.foodBatches, [
            { quantity: n, expiresOnDay: w.tick + w.config.foodShelfLifeDays },
          ]);
        }
        tx.t(a.x, a.y);
        add(a.inventory, resource, n);
        if (farm) t.farmFood -= n;
        else add(t.resources, resource, -n);
        if (resource === 'food' && !farm) t.lastGather = w.tick;
        text = `${brief(a)} ${farm ? '收获' : '采集'}了 ${n} 份${inventoryNames[resource]}`;
        break;
      }
      case 'eat':
        text = `${brief(a)} 吃了 ${action.quantity} 份食物${eatFood(a, a, action.quantity)}`;
        break;
      case 'take': {
        tx.t(a.x, a.y);
        const food = transfer(
          t.ground,
          a.inventory,
          action.item,
          action.quantity,
          true,
          t.groundFoodBatches,
          a.foodBatches,
        );
        if (food) [t.groundFoodBatches, a.foodBatches] = food;
        text = `${brief(a)} 从地面拿取 ${action.quantity} 份${inventoryNames[action.item]}`;
        break;
      }
      case 'drop': {
        assert(
          count(a.inventory, action.item) >= action.quantity,
          '背包物品不足；丢弃只能销毁手上物品',
        );
        if (action.item === 'food') {
          validateFood(a.inventory, a.foodBatches);
          a.foodBatches = splitFood(a.foodBatches, action.quantity).remaining;
        }
        add(a.inventory, action.item, -action.quantity);
        text = `${brief(a)} 丢弃并销毁 ${action.quantity} 份${inventoryNames[action.item]}`;
        break;
      }
      case 'place': {
        tx.t(a.x, a.y);
        const food = transfer(
          a.inventory,
          t.ground,
          action.item,
          action.quantity,
          false,
          a.foodBatches,
          t.groundFoodBatches,
        );
        if (food) [a.foodBatches, t.groundFoodBatches] = food;
        text = `${brief(a)} 在地上放置 ${action.quantity} 份${inventoryNames[action.item]}`;
        break;
      }
      case 'give': {
        const b = target(action.targetId);
        tx.a(b);
        const food = transfer(
          a.inventory,
          b.inventory,
          action.item,
          action.quantity,
          true,
          a.foodBatches,
          b.foodBatches,
        );
        if (food) [a.foodBatches, b.foodBatches] = food;
        tx.a(b);
        w.counters.gifts++;
        text = `${brief(a)} 向 ${brief(b)} 给予 ${action.quantity} 份${inventoryNames[action.item]}`;
        break;
      }
      case 'feed': {
        const b = target(action.targetId);
        const result = eatFood(a, b, 1);
        w.counters.gifts++;
        text = `${brief(a)} 用食物照料 ${brief(b)}${result}`;
        break;
      }
      case 'attack': {
        const b = target(action.targetId);
        tx.a(b).hp = Math.max(0, b.hp - 20);
        w.counters.attacks++;
        text = `${brief(a)} 攻击 ${brief(b)}，造成 20 点伤害`;
        if (b.hp <= 0) {
          tx.die(b, '攻击');
          text += '，对方死亡并掉落物品';
        }
        break;
      }
      case 'public_speak': {
        w.counters.chats++;
        text = `${brief(a)} 公开说：“${action.text}”`;
        break;
      }
      case 'shout': {
        assert(a.ap >= SHOUT_AP - 1, `大声说话需要 ${SHOUT_AP} AP`);
        a.ap -= SHOUT_AP - 1;
        w.counters.chats++;
        text = `${brief(a)} 大声说：“${action.text}”`;
        break;
      }
      case 'chat': {
        if (action.targetId !== undefined) target(action.targetId, true);
        assert(
          [!!action.proposal, !!action.acceptProposalId, !!action.revokeProposalId].filter(Boolean)
            .length <= 1,
          '一次消息只能处理一个协商动作',
        );
        if (action.proposal) {
          const b = target(action.proposal.targetId, true);
          assert(adult(w, a) && adult(w, b), '只有成年人能协商繁衍');
          assert(a.sex !== b.sex, '繁衍提议双方必须为异性');
          const existing = w.proposals.find(
            (p) =>
              !p.revoked &&
              !p.completed &&
              w.tick < p.day + 3 &&
              ((p.from === a.id && p.to === b.id) || (p.from === b.id && p.to === a.id)),
          );
          assert(
            !existing,
            existing?.accepted
              ? `已有接受的提议 ${existing.id}，满足条件后双方使用 reproduce{proposalId:"${existing.id}"}`
              : existing?.to === a.id
                ? `已有对方向你发出的提议 ${existing.id}；愿意接受请使用 chat{acceptProposalId:"${existing.id}",text:"我接受"}`
                : `你已发出提议 ${existing?.id}，等待对方用 acceptProposalId 接受；不要重复提议`,
          );
          w.proposals.push({
            id: `p-${w.seq + 1}`,
            from: a.id,
            to: b.id,
            day: w.tick,
            accepted: false,
            revoked: false,
            attempts: {},
            completed: false,
          });
        }
        if (action.acceptProposalId) {
          const p = w.proposals.find((p) => p.id === action.acceptProposalId);
          assert(
            p && p.to === a.id && !p.revoked && !p.completed && w.tick < p.day + 3,
            '提议不存在、过期或不属于你',
          );
          const b = target(p!.from, true);
          assert(adult(w, a) && adult(w, b), '只有成年人能协商繁衍');
          assert(a.sex !== b.sex, '繁衍提议双方必须为异性');
          assert(
            !p!.accepted,
            `提议 ${p!.id} 已接受，满足条件后使用 reproduce{proposalId:"${p!.id}"}`,
          );
          p!.accepted = true;
        }
        if (action.revokeProposalId) {
          const p = w.proposals.find((p) => p.id === action.revokeProposalId);
          assert(p && (p.from === a.id || p.to === a.id) && !p.completed, '不能撤回这个提议');
          p!.revoked = true;
        }
        w.counters.chats++;
        text = `${brief(a)}${action.targetId ? ` 对 #${action.targetId}` : ''} 说：“${action.text}”${action.proposal ? ` [繁衍提议 p-${w.seq + 1}]` : action.acceptProposalId ? ` [接受 ${action.acceptProposalId}]` : action.revokeProposalId ? ` [撤回 ${action.revokeProposalId}]` : ''}`;
        break;
      }
      case 'experiment': {
        requireMaterials(a.inventory, action.materials);
        assert(Object.keys(action.materials).length > 0, '请指定实验材料');
        const r = RECIPES.find(
          (r) =>
            r.method === action.method &&
            sameMaterials(r.materials, action.materials) &&
            (!r.tool || count(a.inventory, r.tool) > 0),
        );
        if (r?.product)
          assert(
            weight(a.inventory) - weight(r.materials) + 2 <= (w.config.inventoryCapacity ?? 12),
            '成品超出携带容量',
          );
        w.counters.experiments++;
        if (!r) {
          text = `${brief(a)} 的材料实验未产生结果`;
          break;
        }
        if (r.product) {
          consume(a.inventory, r.materials);
          add(a.inventory, r.product, 1);
        }
        if (!a.recipes.includes(r.id)) {
          a.recipes.push(r.id);
          w.counters.discoveries++;
        }
        text = `${brief(a)} 验证了配方 ${r.id}${r.product ? ' 并制成工具' : ''}`;
        break;
      }
      case 'craft': {
        const r = RECIPES.find((r) => r.id === action.recipeId);
        assert(r?.product && a.recipes.includes(r.id), '你尚未掌握该物品配方');
        requireMaterials(a.inventory, r!.materials);
        assert(!r!.tool || count(a.inventory, r!.tool) > 0, '缺少工具');
        assert(
          weight(a.inventory) - weight(r!.materials) + 2 <= (w.config.inventoryCapacity ?? 12),
          '成品超出携带容量',
        );
        consume(a.inventory, r!.materials);
        add(a.inventory, r!.product!, 1);
        text = `${brief(a)} 制作了${inventoryNames[r!.product!]}`;
        break;
      }
      case 'terraform':
        assert(t.terrain === 'plain' && t.farm < 3, '只能开垦尚未完工的平原');
        assert(
          count(a.inventory, 'basic_tool') > 0 || count(a.inventory, 'advanced_tool') > 0,
          '开垦需要工具',
        );
        tx.t(a.x, a.y);
        t.farm++;
        if (t.farm === 3) {
          t.resources.food = 0;
          t.farmFood = 0;
        }
        text = `${brief(a)} 开垦农田 (${t.farm}/3)`;
        break;
      case 'build': {
        assert(
          action.recipeId === 'shelter' && a.recipes.includes('shelter'),
          '你尚未掌握棚屋配方',
        );
        assert(!t.shelter?.complete, '这里已有棚屋');
        const progress = t.shelter ?? { materials: {}, labor: 0, complete: false };
        const need = RECIPES[2].materials;
        if (action.materials && Object.keys(action.materials).length) {
          requireMaterials(a.inventory, action.materials);
          for (const [k, v] of Object.entries(action.materials))
            assert(
              v! <= count(need, k as Item) - count(progress.materials, k as Item),
              '材料超出工程所需',
            );
          consume(a.inventory, action.materials);
          for (const [k, v] of Object.entries(action.materials))
            add(progress.materials, k as Item, v!);
        } else {
          assert(progress.labor < 4, '劳动已完成，请提供材料');
          progress.labor++;
        }
        tx.t(a.x, a.y);
        progress.complete =
          progress.labor >= 4 &&
          Object.entries(need).every(([k, v]) => count(progress.materials, k as Item) >= v!);
        t.shelter = progress;
        text = `${brief(a)} 参与棚屋施工${progress.complete ? '，棚屋落成' : ` (${progress.labor}/4 劳动)`}`;
        break;
      }
      case 'reproduce': {
        const p = w.proposals.find((p) => p.id === action.proposalId);
        assert(
          p && (p.from === a.id || p.to === a.id),
          '提议不存在或你不是参与者，请查看 proposals 中的有效 ID',
        );
        assert(
          !p!.revoked && !p!.completed && w.tick < p!.day + 3,
          '提议已撤回、完成或过期，请查看 proposals 中的有效 ID',
        );
        assert(
          p!.accepted,
          `提议 ${p!.id} 尚未接受，须由 #${p!.to} 使用 chat{acceptProposalId:"${p!.id}",text:"我接受"}，文本中说接受不会更新提议`,
        );
        const b = target(p!.from === a.id ? p!.to : p!.from);
        assert(adult(w, a) && adult(w, b) && a.sex !== b.sex, '双方必须为成年异性');
        const female = a.sex === 'F' ? a : b;
        assert(!female.pregnancy && w.tick >= female.cooldownUntil, '妊娠或冷却中');
        assert(a.hunger >= 60 && b.hunger >= 60, '双方饱食度须至少60');
        assert(p!.attempts[a.id] !== w.tick, '今天已经表达了配合意愿');
        p!.attempts[a.id] = w.tick;
        text = `${brief(a)} 等待 ${brief(b)} 共同执行繁衍`;
        if (p!.attempts[b.id] === w.tick) {
          p!.completed = true;
          tx.a(b);
          a.hunger -= 20;
          b.hunger -= 20;
          female.pregnancy = {
            father: a.sex === 'M' ? a.id : b.id,
            due: w.tick + w.config.gestation,
          };
          text = `${brief(a)} 与 ${brief(b)} 完成共同繁衍，妊娠开始`;
        }
        break;
      }
    }
  } catch (error) {
    success = false;
    type = 'action_failed';
    w.counters.failures++;
    text = `${brief(a)} 的 ${action.type} 失败：${error instanceof Error ? error.message : '动作无效'}`;
  }
  if (
    success &&
    action.type !== 'eat' &&
    action.type !== 'wait' &&
    action.type !== 'survey' &&
    action.type !== 'experiment'
  ) {
    for (const b of living(w))
      if (
        action.type === 'shout'
          ? Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) <= SHOUT_RADIUS
          : visible(b, origin) || visible(b, a)
      )
        tx.tell(
          b,
          text,
          action.type === 'chat' || action.type === 'shout' || action.type === 'public_speak'
            ? 'heard'
            : 'observed',
          action.type === 'chat' || action.type === 'shout' || action.type === 'public_speak'
            ? a.id
            : undefined,
          action.type === 'attack' ? 8 : 2,
        );
    if (targetId) {
      const b = w.agents.find((b) => b.id === targetId);
      if (b?.death) tx.tell(b, text, 'observed', undefined, 8);
    }
  } else {
    tx.tell(a, text, 'observed', undefined, success ? 2 : 5);
    if (success && action.type === 'experiment')
      for (const b of living(w))
        if (b.id !== a.id && visible(a, b))
          tx.tell(b, `${brief(a)} 尝试加工材料，进行了制造实验`, 'observed');
  }
  if (decision.memory_note) {
    const m: Memory = {
      id: `note-${w.seq + 1}-${a.id}`,
      day: w.tick,
      content: decision.memory_note,
      source: 'inferred',
      eventIds: [w.seq + 1],
      importance: 3,
    };
    a.memories.push(m);
    a.memories = a.memories.slice(-200);
  }
  if (
    success &&
    (action.type === 'chat' || action.type === 'shout' || action.type === 'public_speak') &&
    tx.recipients.some((id) => id !== a.id)
  ) {
    const wasDepressed = a.social?.depressed;
    recordSpeaking(a, w.tick);
    if (wasDepressed && !a.social?.depressed)
      tx.tell(a, `${brief(a)} 的孤单已清空，抑郁状态解除`, 'observed', undefined, 6);
  }
  if (success && action.type === 'drop' && w.config.freeDrop) {
    a.ap++;
    w.cursor.freeActions = (w.cursor.freeActions ?? 0) + 1;
  } else {
    w.cursor.index++;
    if (w.cursor.freeActions) w.cursor.freeActions = 0;
  }
  return tx.finish(type, text, decisionId, success, a, targetId);
}
export function reflect(w: World, agentId: number, r: Reflection, decisionId: string) {
  const a = w.agents.find((a) => a.id === agentId)!;
  const tx = new Tx(w);
  tx.a(a);
  const allowed = new Set(a.memories.flatMap((m) => m.eventIds));
  const summary: Memory = {
    id: `reflection-${w.seq + 1}`,
    day: w.tick,
    content: r.summary,
    source: 'inferred',
    eventIds: [...allowed].slice(-20),
    importance: 6,
  };
  a.memories.push(summary);
  for (const c of r.claims) {
    const ids = c.sourceEventIds.filter((id) => allowed.has(id));
    if (ids.length)
      a.claims.push({
        id: `claim-${w.seq + 1}-${a.claims.length}`,
        day: w.tick,
        content: c.content,
        source: 'inferred',
        eventIds: ids,
        importance: 7,
      });
  }
  a.memories = a.memories.slice(-200);
  a.claims = a.claims.slice(-40);
  w.cursor.index++;
  return tx.finish('reflection', `${brief(a)} 整理了近期经历`, decisionId, true, a);
}
export function metrics(w: World): Metrics {
  if (w.ecology) return metricsEco(w);
  const alive = living(w);
  const dated = w.rulesVersion !== 'mvp-1.0.0';
  const stores = [...alive.map((a) => a.foodBatches), ...w.tiles.map((t) => t.groundFoodBatches)];
  return {
    day: w.tick,
    alive: alive.length,
    ...w.counters,
    food:
      alive.reduce((n, a) => n + count(a.inventory, 'food'), 0) +
      w.tiles.reduce((n, t) => n + count(t.ground, 'food') + t.farmFood, 0),
    ...(dated
      ? {
          freshFood:
            stores.reduce((n, batches) => n + foodSummary(batches, w.tick).fresh, 0) +
            w.tiles.reduce((n, t) => n + t.farmFood, 0),
          spoiledFood: stores.reduce((n, batches) => n + foodSummary(batches, w.tick).spoiled, 0),
        }
      : {}),
    wildFood: w.tiles.reduce((n, t) => n + count(t.resources, 'food'), 0),
    farms: w.tiles.filter((t) => t.farm >= 3).length,
    avgHunger: alive.length ? alive.reduce((n, a) => n + a.hunger, 0) / alive.length : 0,
    ...(['mvp-1.4.0', 'mvp-1.5.0', 'mvp-1.6.0', 'mvp-1.7.0'].includes(w.rulesVersion)
      ? {
          avgLoneliness: alive.length
            ? alive.reduce((n, a) => n + (a.social?.loneliness ?? 0), 0) / alive.length
            : 0,
          depressed: alive.filter((a) => a.social?.depressed).length,
        }
      : {}),
    calls: w.usage.calls,
    inputTokens: w.usage.inputTokens,
    outputTokens: w.usage.outputTokens,
  };
}
export function endDay(w: World): WorldEvent {
  if (w.ecology) return stepEco(w);
  const tx = new Tx(w);
  const day = w.tick;
  let born = 0,
    dead = 0;
  const deaths = w.counters.deaths;
  for (const t of w.tiles) {
    if (t.farm >= 3) {
      if (t.farmFood < 12) tx.t(t.x, t.y).farmFood = Math.min(12, t.farmFood + 3);
    } else {
      const max = t.terrain === 'plain' ? w.config.plainFoodCapacity : t.terrain === 'hill' ? 3 : 0;
      const recovered =
        t.terrain === 'plain'
          ? w.tick + 1 - t.lastGather >= w.config.plainRecoveryDays
          : w.tick - t.lastGather >= 2;
      if (recovered && count(t.resources, 'food') < max) add(tx.t(t.x, t.y).resources, 'food', 1);
    }
  }
  for (const a of living(w)) {
    tx.a(a);
    a.hunger = Math.max(0, a.hunger - (adult(w, a) ? 20 : 10));
    if (a.hunger === 0) a.hp = Math.max(0, a.hp - 20);
    if (a.hp <= 0) {
      tx.die(a, '饥饿');
      tx.tell(a, `${brief(a)} 因饥饿死亡`, 'observed', undefined, 10);
      for (const b of living(w))
        if (visible(a, b)) tx.tell(b, `${brief(a)} 因饥饿死亡`, 'observed', undefined, 10);
      continue;
    }
    const shelter = tileAt(w, a.x, a.y).shelter?.complete;
    if (shelter && a.hunger >= 40) a.hp = Math.min(100, a.hp + 8);
    else if (a.hunger >= 60) a.hp = Math.min(100, a.hp + 5);
    if (a.social) {
      if (day - a.social.lastSpokeDay >= SOCIAL_RULES.silentDaysBeforeIncrease)
        a.social.loneliness = Math.min(
          lonelinessCapacity(a),
          a.social.loneliness + SOCIAL_RULES.lonelinessPerDay,
        );
      if (a.social.loneliness >= lonelinessCapacity(a)) a.social.depressed = true;
      if (a.social.depressed) {
        a.hp = Math.max(0, a.hp - SOCIAL_RULES.depressionDamagePerDay);
        tx.tell(
          a,
          `${brief(a)} 处于抑郁状态，生命损失 ${SOCIAL_RULES.depressionDamagePerDay}；孤单 ${a.social.loneliness}/${lonelinessCapacity(a)}，清空后解除`,
          'observed',
          undefined,
          6,
        );
        if (a.hp === 0) {
          tx.die(a, '抑郁');
          tx.tell(a, `${brief(a)} 因抑郁死亡`, 'observed', undefined, 10);
          for (const b of living(w))
            if (visible(a, b)) tx.tell(b, `${brief(a)} 因抑郁死亡`, 'observed', undefined, 10);
          continue;
        }
      }
    }
    a.age++;
  }
  for (const a of [...living(w)])
    if (a.pregnancy && a.pregnancy.due <= w.tick) {
      const child = makeAgent(w, a.x, a.y, [a.id, a.pregnancy.father]);
      w.agents.push(child);
      tx.a(child);
      a.pregnancy = undefined;
      a.cooldownUntil = w.tick + 10;
      w.counters.births++;
      born++;
      for (const b of living(w))
        if (visible(a, b))
          tx.tell(b, `${brief(a)} 生下 ${brief(child)}`, 'observed', undefined, 10);
    }
  dead = w.counters.deaths - deaths;
  w.metrics.push(metrics(w));
  if (day >= w.config.days) w.cursor = { phase: 'complete', round: 0, index: 0, ids: [] };
  else {
    w.tick++;
    const alive = living(w);
    for (const a of alive) tx.a(a).ap = w.config.dailyAP;
    w.cursor = { phase: 'actions', round: 0, index: 0, ids: alive.map((a) => a.id) };
  }
  const e = tx.finish(
    'day_end',
    `第 ${day} 天结束 · ${living(w).length} 人存活${born ? ` · ${born} 人出生` : ''}${dead ? ` · ${dead} 人死亡` : ''}`,
    `${w.id}:${day}:end`,
    true,
    undefined,
    undefined,
    true,
  );
  e.day = day;
  return e;
}
export function applyEvent(w: World, e: WorldEvent): World {
  if (e.seq !== w.seq + 1) throw new Error(`事件序号不连续：${w.seq} → ${e.seq}`);
  const p = structuredClone(e.patch);
  Object.assign(w, p.meta);
  for (const a of p.agents) {
    const i = w.agents.findIndex((v) => v.id === a.id);
    if (i < 0) w.agents.push(a);
    else w.agents[i] = a;
  }
  for (const c of p.agentChanges ?? []) {
    const i = w.agents.findIndex((a) => a.id === c.state.id);
    if (i < 0) throw new Error('变更引用了不存在的角色');
    const a = w.agents[i];
    Object.assign(a, c.state);
    if (!('pregnancy' in c.state)) delete a.pregnancy;
    if (!('death' in c.state)) delete a.death;
    for (const key of ['memories', 'inbox', 'claims'] as const)
      a[key] = [...a[key].slice(c[key].drop), ...c[key].append];
  }
  for (const t of p.tiles)
    w.tiles[(t.eco?.region ?? 0) * w.config.size * w.config.size + t.y * w.config.size + t.x] = t;
  w.proposals = p.proposals;
  if (p.metrics) w.metrics = p.metrics;
  return w;
}
export function observe(w: World, a: Agent) {
  const dated = w.rulesVersion !== 'mvp-1.0.0';
  const tiles = w.tiles.filter((t) => visible(a, t));
  const ids = new Set(
    living(w)
      .filter((b) => visible(a, b))
      .map((b) => b.id),
  );
  const relevant = [...a.memories].sort((x, y) => score(y) - score(x)).slice(0, 8);
  function score(m: Memory) {
    return (
      m.importance / (1 + (w.tick - m.day) * 0.12) +
      ([...ids].some((id) => m.content.includes(`#${id}`)) ? 3 : 0)
    );
  }
  const here = tileAt(w, a.x, a.y);
  const view = {
    day: w.tick,
    round: w.cursor.round + 1,
    ...(dated
      ? {
          physicalRules: {
            ...(['mvp-1.3.0', 'mvp-1.4.0', 'mvp-1.5.0', 'mvp-1.6.0', 'mvp-1.7.0'].includes(
              w.rulesVersion,
            )
              ? { automaticObservation: true, shoutAP: SHOUT_AP, shoutRadius: SHOUT_RADIUS }
              : {}),
            ...(a.social ? { social: SOCIAL_RULES } : {}),
            ...(['mvp-1.5.0', 'mvp-1.6.0', 'mvp-1.7.0'].includes(w.rulesVersion)
              ? { dropDeletesItem: true, placeAP: 1 }
              : {}),
            ...(['mvp-1.6.0', 'mvp-1.7.0'].includes(w.rulesVersion)
              ? { corpsesPersist: true, surveyAP: SURVEY_AP, surveyRadius: SURVEY_RADIUS }
              : {}),
            plainFoodCapacity: w.config.plainFoodCapacity,
            plainRecoveryDays: w.config.plainRecoveryDays,
            foodShelfLifeDays: w.config.foodShelfLifeDays,
            ...(w.config.inventoryCapacity !== undefined
              ? { inventoryCapacity: w.config.inventoryCapacity }
              : {}),
            spoiledFoodDamage: w.config.spoiledFoodDamage,
            ...(w.config.spoiledFoodHungerGain !== undefined
              ? { spoiledFoodHungerGain: w.config.spoiledFoodHungerGain }
              : {}),
            ...(w.config.dailyAP !== undefined
              ? { dailyAP: w.config.dailyAP, freeDrop: w.config.freeDrop }
              : {}),
            reproductionSuccessRate: w.config.reproductionSuccessRate,
            gestationDays: w.config.gestation,
          },
        }
      : {}),
    ...(['mvp-1.6.0', 'mvp-1.7.0'].includes(w.rulesVersion)
      ? { corpses: visibleCorpses(w, a), lastSurvey: a.survey }
      : {}),
    currentTile: {
      x: a.x,
      y: a.y,
      resources: here.resources,
      farmProgress: here.farm,
      farmFood: here.farmFood,
      ground: here.ground,
      ...(dated
        ? {
            groundFood: {
              ...foodSummary(here.groundFoodBatches, w.tick),
              batches: here.groundFoodBatches,
            },
            foodRecoveryBeginsOnDay:
              here.terrain === 'plain' && here.farm < 3 && here.lastGather > 0
                ? here.lastGather + w.config.plainRecoveryDays
                : undefined,
          }
        : {}),
    },
    physicalOptions: {
      freeCapacity: (w.config.inventoryCapacity ?? 12) - weight(a.inventory),
      validMoves: [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
        .filter(
          ([dx, dy]) =>
            a.x + dx >= 0 && a.y + dy >= 0 && a.x + dx < w.config.size && a.y + dy < w.config.size,
        )
        .map(([dx, dy]) => ({ dx, dy })),
    },
    self: {
      id: a.id,
      name: a.name,
      ...(a.role ? { role: a.role } : {}),
      sex: a.sex,
      ageStage: adult(w, a) ? 'adult' : 'child',
      parents: a.parents,
      hp: a.hp,
      hunger: a.hunger,
      ap: a.ap,
      position: [a.x, a.y],
      inventory: a.inventory,
      ...(a.social ? { social: { ...a.social, capacity: lonelinessCapacity(a) } } : {}),
      ...(dated ? { food: { ...foodSummary(a.foodBatches, w.tick), batches: a.foodBatches } } : {}),
      personality: {
        openness: a.personality[0],
        conscientiousness: a.personality[1],
        extraversion: a.personality[2],
        agreeableness: a.personality[3],
        neuroticism: a.personality[4],
      },
      intent: a.intent,
      pregnancy: a.pregnancy ? { due: a.pregnancy.due } : undefined,
    },
    tiles: tiles.map((t) => ({
      x: t.x,
      y: t.y,
      terrain: t.terrain,
      resources: t.resources,
      ground: t.ground,
      ...(dated
        ? {
            groundFood: foodSummary(t.groundFoodBatches, w.tick),
            foodRecoveryBeginsOnDay:
              t.terrain === 'plain' && t.farm < 3 && t.lastGather > 0
                ? t.lastGather + w.config.plainRecoveryDays
                : undefined,
          }
        : {}),
      farmProgress: t.farm,
      farmFood: t.farmFood,
      shelter: t.shelter,
    })),
    people: living(w)
      .filter((b) => b.id !== a.id && visible(a, b))
      .map((b) => ({
        id: b.id,
        name: b.name,
        ...(b.role ? { role: b.role } : {}),
        sex: b.sex,
        ageStage: adult(w, b) ? 'adult' : 'child',
        x: b.x,
        y: b.y,
        health: b.hp > 60 ? '正常' : b.hp > 20 ? '受伤' : '濒危',
        hunger: b.hunger > 40 ? '正常' : '饥饿',
        equipment: Object.keys(b.inventory).filter((k) => k.endsWith('tool')),
      })),
    recentEvents: a.inbox,
    memories: relevant,
    claims: a.claims.slice(-8),
    knownRecipes: RECIPES.filter((r) => a.recipes.includes(r.id)),
    proposals: w.proposals.filter(
      (p) => (p.from === a.id || p.to === a.id) && !p.completed && !p.revoked && w.tick < p.day + 3,
    ),
  };
  // Keep a bounded working context; full memories remain in historical patches.
  while (
    JSON.stringify(view).length > 10500 &&
    (view.memories.length > 0 || view.claims.length > 0 || view.recentEvents.length > 4)
  ) {
    if (view.memories.length) view.memories.pop();
    else if (view.claims.length) view.claims.shift();
    else view.recentEvents = view.recentEvents.slice(1);
  }
  return view;
}

export const BUDGET_KEYS = [
  'populationLimit',
  'maxCalls',
  'maxTokens',
  'maxMinutes',
  'maxCost',
  'inputPrice',
  'outputPrice',
  'cachePrice',
] as const;
export function changeBudget(w: World, patch: Record<string, unknown>) {
  assert(
    Object.keys(patch).every((key) => (BUDGET_KEYS as readonly string[]).includes(key)),
    '只能修改运行预算',
  );
  const config = ConfigSchema.parse({
    ...w.config,
    inventoryCapacity: w.config.inventoryCapacity ?? 12,
    ...patch,
  });
  const tx = new Tx(w);
  w.config = config;
  return tx.finish('config_changed', '运行预算已更新', `${w.id}:budget:${w.seq + 1}`, true);
}
export function resetFailureStreak(w: World) {
  const tx = new Tx(w);
  w.usage.consecutiveErrors = 0;
  return tx.finish('recovery', '用户请求恢复模型连接', `${w.id}:recovery:${w.seq + 1}`, true);
}
