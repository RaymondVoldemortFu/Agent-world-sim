import { preferences } from './personality';
import { navigate } from './navigation';
import { combatPolicy, shouldFlee } from '../ecology/combat-policy';
import type { Decision, Action } from '../sim/types';
import type { Brain, EcoObservation, BrainOutput, Goal } from '../ecology/types';
import { ITEMS, RECIPES, BUILDINGS, CROPS } from '../ecology/catalog';
import { mass, energy, quantity, capacity, capability } from '../ecology/batches';
const dist = (a: [number, number], b: { x: number; y: number }) =>
  Math.max(Math.abs(a[0] - b.x), Math.abs(a[1] - b.y));
export const activityTime = (o: EcoObservation) => (o.day - 1) * o.policy.dailyAP * 120 + o.minute;
export const holdingPosition = (o: EcoObservation, b = o.self.brain) =>
  (b.movement?.holdUntil ?? 0) > activityTime(o);
export function remember(o: EcoObservation): Brain {
  const b = structuredClone(o.self.brain);
  const views = [
    ...(o.lastSurvey?.tiles ?? []).map((t) => ({
      t,
      day: o.lastSurvey!.day,
      people: o.lastSurvey!.people,
    })),
    ...o.tiles.map((t) => ({ t, day: o.day, people: o.people })),
  ];
  for (const { t, day, people } of views) {
    const record = {
      x: t.x,
      y: t.y,
      region: t.eco.region,
      day,
      food: Object.entries(t.eco.biomass).reduce((n, [k, q]) => n + q * (ITEMS[k]?.kcal ?? 0), 0),
      biome: t.eco.biome,
      ...(t.eco.structures.some(
        (s) => s.kind === 'bridge' && s.progress >= BUILDINGS.bridge.minutes && s.condition > 0.4,
      )
        ? { bridge: true }
        : {}),
      resources: {
        ...t.eco.biomass,
        ...Object.fromEntries(t.eco.deposits.map((d) => [d.item, d.kg])),
      },
      people: people.filter((p) => p.x === t.x && p.y === t.y).map((p) => p.id),
    };
    const i = b.places.findIndex((p) => p.x === t.x && p.y === t.y && p.region === t.eco.region);
    if (i >= 0) b.places[i] = record;
    else b.places.push(record);
  }
  b.places = b.places.slice(-100);
  if (b.goal && b.goal.expires < o.day) delete b.goal;
  if (!b.goal) {
    delete b.goalBlocked;
    delete b.procurement;
    delete b.gatherOrigin;
  }
  if (b.movement?.holdUntil !== undefined && !holdingPosition(o, b)) delete b.movement.holdUntil;
  if (
    b.forageTrip &&
    (b.forageTrip.region !== o.self.body.region ||
      (b.forageTrip.returning &&
        dist(o.self.position, { x: b.forageTrip.origin[0], y: b.forageTrip.origin[1] }) === 0))
  )
    delete b.forageTrip;
  return b;
}
function decision(
  b: Brain,
  action: Action,
  intent: string,
  source: Brain['source'] = 'rule',
): Decision {
  b.source = source;
  return { intent, action, brainUpdate: { brain: b } };
}
function move(o: EcoObservation, x: number, y: number): Action | undefined {
  if (holdingPosition(o)) return;
  const [ax, ay] = o.self.position;
  if (ax === x && ay === y) return;
  const size = o.policy.mapSize,
    known = new Map(
      o.self.brain.places
        .filter((p) => p.region === o.self.body.region)
        .map((p) => [`${p.x},${p.y}`, p.biome]),
    );
  for (const t of o.tiles) known.set(`${t.x},${t.y}`, t.eco.biome);
  const hasBoat = capability([o.self.body.stock], 'boat') > 0;
  const queue: { x: number; y: number; first?: [number, number] }[] = [{ x: ax, y: ay }],
    seen = new Set([`${ax},${ay}`]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (p.x === x && p.y === y && p.first) return { type: 'move', dx: p.first[0], dy: p.first[1] };
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const nx = p.x + dx,
        ny = p.y + dy,
        key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size || seen.has(key)) continue;
      const bridge = o.tiles
        .find((t) => t.x === nx && t.y === ny)
        ?.eco.structures.some(
          (s) => s.kind === 'bridge' && s.progress >= BUILDINGS.bridge.minutes && s.condition > 0.4,
        );
      if (known.get(key) === 'water' && !hasBoat && !bridge) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny, first: p.first ?? [dx, dy] });
    }
  }
  return;
}

function explore(o: EcoObservation, b: Brain): Action {
  if (holdingPosition(o, b)) return { type: 'wait' };
  const current = o.self.position;
  const dirs = o.tiles.filter(
    (t) => Math.abs(t.x - current[0]) + Math.abs(t.y - current[1]) === 1 && t.eco.biome !== 'water',
  );
  dirs.sort((a, c) => {
    const seen = (t: typeof a) => {
      const p = b.places.find((p) => p.x === t.x && p.y === t.y && p.region === o.self.body.region);
      return (p?.day ?? -100) + (p?.food ?? 0) > 0 ? (p?.day ?? -100) : 0;
    };
    const score = (t: typeof a) => b.visits?.[`${t.x},${t.y}`] ?? 0;
    return (
      score(a) - score(c) ||
      ((a.x * 13 + a.y * 7 + o.self.id) % 11) - ((c.x * 13 + c.y * 7 + o.self.id) % 11)
    );
  });
  return dirs[0]
    ? { type: 'move', dx: dirs[0].x - current[0], dy: dirs[0].y - current[1] }
    : { type: 'wait' };
}
export function survival(o: EcoObservation, b: Brain): Decision | undefined {
  const self = o.self,
    stock = self.body.stock,
    here = o.tiles.find((t) => dist(self.position, t) === 0)!;
  const make = (action: Action, intent: string) => decision(b, action, intent);
  const forageMove = (action: Action, intent: string) => {
    if (b.movement?.returnAfterGather && !b.forageTrip)
      b.forageTrip = { origin: [...self.position], region: self.body.region, returning: false };
    return make(action, intent);
  };
  const bad = stock.find((b) => ITEMS[b.item].kcal > 0 && b.risk > 0.65);
  if (bad && energy(stock.filter((x) => x !== bad)) > 1000)
    return make(
      { type: 'eco', op: 'discard', item: bad.item, amount: bad.kg },
      '清理背包高风险食物',
    );
  if (self.body.waterL < 3.5) {
    if (here.eco.surfaceWater >= 3 || quantity(stock, 'water') >= 3)
      return make(
        { type: 'eco', op: 'drink', amount: Math.min(3, 6 - self.body.waterL) },
        '补充饮水',
      );
    const water = o.tiles.find((t) => t.eco.surfaceWater > 3);
    if (water) {
      const action = move(o, water.x, water.y);
      if (action) return forageMove(action, '走向观察到的水源');
    }
  }
  if (self.body.foodKcal < 5200) {
    const food = [...stock]
      .filter((b) => ITEMS[b.item].kcal > 0)
      .sort((a, b) => a.risk - b.risk || ITEMS[a.item].life - ITEMS[b.item].life)[0];
    if (food)
      return make(
        {
          type: 'eco',
          op: 'eat',
          item: food.item,
          amount: Math.min(
            food.kg,
            (6500 - self.body.foodKcal) / (ITEMS[food.item].kcal * food.quality),
          ),
        },
        '按身体需求进食',
      );
  }
  const temperament = preferences(o.self.personality);
  const hungry = self.body.foodKcal < 4500 || energy(stock) < temperament.reserveKcal;
  if (hungry) {
    const ground = [
      ...here.eco.ground,
      ...here.eco.structures.filter((s) => s.condition > 0.2).flatMap((s) => s.contents),
    ]
      .filter((b) => ITEMS[b.item].kcal > 0 && b.risk < temperament.foodRisk)
      .sort((a, b) => ITEMS[b.item].kcal - ITEMS[a.item].kcal)[0];
    const free = capacity(stock, o.policy.bagKg) - mass(stock);
    if (free < 0.2) {
      const excess = stock
        .filter((b) => !ITEMS[b.item].kcal && !ITEMS[b.item].capabilities)
        .sort((a, b) => b.kg - a.kg)[0];
      if (excess)
        return make(
          {
            type: 'eco',
            op: 'transfer',
            item: excess.item,
            amount: excess.kg,
            destination: 'ground',
          },
          '腾出负重采食；物料保留在地面',
        );
    }
    if (ground && free > 0.1) {
      const store = here.eco.structures.find((s) => s.contents.some((b) => b.id === ground.id));
      return make(
        {
          type: 'eco',
          op: 'transfer',
          item: ground.item,
          amount: Math.min(ground.kg, free, 3000 / (ITEMS[ground.item].kcal || 1)),
          destination: 'bag',
          ...(store ? { id: store.id } : {}),
        },
        '拿取实际可见的食物',
      );
    }
    const sources = o.tiles
      .filter((t) => !holdingPosition(o, b) || dist(self.position, t) === 0)
      .flatMap((t) =>
        Object.entries(t.eco.biomass)
          .filter(
            ([k, n]) =>
              n > 0.05 &&
              ITEMS[k]?.kcal > 0 &&
              (k !== 'fish' || (t.x === self.position[0] && t.y === self.position[1])),
          )
          .map(([item, n]) => ({
            t,
            item,
            score:
              (Math.min(
                n,
                item === 'berries' ? 4 : item === 'roots' ? 2.5 : item === 'grain' ? 1.6 : 2,
              ) *
                ITEMS[item].kcal) /
              (1 + dist(self.position, t) * 0.12),
          })),
      )
      .sort((a, b) => b.score - a.score);
    const source = sources.find(
      (s) => s.t.eco.biome !== 'water' || capability([stock], 'boat') > 0,
    );
    if (source && free > 0.1) {
      if (dist(self.position, source.t) === 0)
        return make(
          {
            type: 'eco',
            op: 'collect',
            item: source.item,
            amount: Math.min(free, 4000 / ITEMS[source.item].kcal),
          },
          '采集一至两天口粮',
        );
      const action = move(o, source.t.x, source.t.y);
      if (action) return forageMove(action, '前往可见食物斑块');
    }
    const known = b.places
      .filter(
        (p) =>
          p.region === self.body.region &&
          p.food > 1500 &&
          o.day - p.day <= 7 &&
          dist(self.position, p) > 1,
      )
      .sort(
        (a, b) => b.food / (1 + dist(self.position, b)) - a.food / (1 + dist(self.position, a)),
      )[0];
    if (known) {
      const action = move(o, known.x, known.y);
      if (action) return forageMove(action, '复查记忆中的食物位置');
    }
    const step = explore(o, b);
    return step.type === 'move'
      ? forageMove(step, '探索附近可通行地块寻找食物')
      : make(step, '保持原地；本地口粮不足，等待补给或调整移动约束');
  }
}
function acquire(
  o: EcoObservation,
  b: Brain,
  item: string,
  need: number,
  site: [number, number],
  depth = 0,
): Action | undefined {
  if (depth > 8) return;
  const stock = o.self.body.stock,
    here = o.tiles.find((t) => dist(o.self.position, t) === 0)!,
    free = capacity(stock, o.policy.bagKg) - mass(stock);
  const available =
    quantity(stock, item) +
    quantity(here.eco.ground, item) +
    here.eco.structures
      .filter((s) => s.condition > 0.2)
      .reduce((n, s) => n + quantity(s.contents, item), 0);
  if (dist(o.self.position, { x: site[0], y: site[1] }) === 0 && available >= need) {
    delete b.procurement;
    return;
  }
  if (quantity(stock, item) > 0 && dist(o.self.position, { x: site[0], y: site[1] }) > 0)
    return move(o, ...site);
  if (quantity(stock, item) > 0 && free < Math.min(need - available, 3))
    return {
      type: 'eco',
      op: 'transfer',
      item,
      amount: quantity(stock, item),
      destination: 'ground',
    };
  const ground = here.eco.ground.find((x) => x.item === item);
  if (ground && free > 0.05)
    return {
      type: 'eco',
      op: 'transfer',
      item,
      amount: Math.min(ground.kg, free, need),
      destination: 'bag',
    };
  if (free < 0.1) {
    const x = stock.find((x) => !ITEMS[x.item].kcal && !ITEMS[x.item].capabilities);
    if (x)
      return { type: 'eco', op: 'transfer', item: x.item, amount: x.kg, destination: 'ground' };
    return;
  }
  if (['meat', 'bone', 'hide', 'fat', 'feather'].includes(item)) {
    if (!capability([stock, here.eco.ground], 'hunting'))
      return makeRecipe(o, b, 'spear', depth + 1);
    const prey = o.tiles.find((t) => (t.eco.biomass.game ?? 0) > 0.1);
    if (prey) {
      if (dist(o.self.position, prey) > 0) {
        b.procurement = { item, need, site };
        return move(o, prey.x, prey.y);
      }
      return { type: 'eco', op: 'collect', item: 'meat', amount: Math.min(free, 3) };
    }
  }
  const at = o.tiles.find(
    (t) =>
      ((t.eco.biomass[item] ?? 0) > 0.01 ||
        t.eco.deposits.some((d) => d.item === item && d.kg > 0.01)) &&
      t.eco.biome !== 'water',
  );
  if (at) {
    if (dist(o.self.position, at) > 0) {
      b.procurement = { item, need, site };
      return move(o, at.x, at.y);
    }
    return {
      type: 'eco',
      op: item === 'water' ? 'water' : 'collect',
      item,
      amount: Math.min(free, need - available > 0 ? need - available : need, 8),
    };
  }
  if (item === 'water' && here.eco.surfaceWater > 0)
    return { type: 'eco', op: 'water', amount: Math.min(free, need) };
  const r = Object.values(RECIPES).find(
    (r) => r.outputs[item] > 0 && o.self.body.knowledge.includes(r.id),
  );
  if (r) return makeRecipe(o, b, r.id, depth + 1);
  const place = b.places
    .filter((p) => p.region === o.self.body.region && (p.resources?.[item] ?? 0) > 0)
    .sort((a, b) => dist(o.self.position, a) - dist(o.self.position, b))[0];
  if (place) {
    b.procurement = { item, need, site };
    return move(o, place.x, place.y);
  }
  return;
}
function makeRecipe(o: EcoObservation, b: Brain, id: string, depth = 0): Action | undefined {
  if (depth > 8) return;
  const r = RECIPES[id];
  if (!r) return;
  const here = o.tiles.find((t) => dist(o.self.position, t) === 0)!;
  const stock = o.self.body.stock,
    stores = [
      stock,
      here.eco.ground,
      ...here.eco.structures.filter((s) => s.condition > 0.2).map((s) => s.contents),
    ];
  if (!o.self.body.knowledge.includes(id)) {
    const teacher = o.people.find((p) => p.role === 'prophet');
    if (teacher) return { type: 'eco', op: 'study', recipe: id, targetId: teacher.id };
    if (o.messages.some((m) => m.content.includes(id)))
      return { type: 'eco', op: 'study', recipe: id };
    return;
  }
  const j = o.jobs.find(
    (j) =>
      j.recipe === id &&
      j.x === here.x &&
      j.y === here.y &&
      !['complete', 'cancelled'].includes(j.state),
  );
  if (j)
    return j.work >= r.minutes && j.lastTended === o.day
      ? { type: 'wait' }
      : { type: 'eco', op: 'work_job', id: j.id };
  if (r.capability && capability(stores, r.capability) === 0) {
    const tool = Object.entries(ITEMS).find(
      ([k, v]) =>
        (v.capabilities?.[r.capability!] ?? 0) > 0 &&
        RECIPES[k] &&
        o.self.body.knowledge.includes(k),
    );
    if (tool)
      return acquire(o, b, tool[0], RECIPES[tool[0]].outputs[tool[0]], o.self.position, depth + 1);
    return;
  }
  if (
    r.facility &&
    !here.eco.structures.some(
      (s) => s.kind === r.facility && s.progress >= BUILDINGS[s.kind].minutes && s.condition > 0.3,
    )
  )
    return build(o, b, r.facility, depth + 1);
  for (const [item, n] of Object.entries(r.inputs))
    if (stores.reduce((n, s) => n + quantity(s, item), 0) + 1e-7 < n)
      return acquire(o, b, item, n, o.self.position, depth + 1);
  return { type: 'eco', op: 'start_job', recipe: id };
}
function build(o: EcoObservation, b: Brain, id: string, depth = 0): Action | undefined {
  if (depth > 8) return;
  const r = BUILDINGS[id];
  if (!r) return;
  const here = o.tiles.find((t) => dist(o.self.position, t) === 0)!;
  if (!o.self.body.knowledge.includes('build:' + id)) {
    const p = o.people.find((p) => p.role === 'prophet');
    return p ? { type: 'eco', op: 'study', recipe: 'build:' + id, targetId: p.id } : undefined;
  }
  const existing = here.eco.structures.find((s) => s.kind === id && s.progress < r.minutes);
  if (existing) return { type: 'eco', op: 'construct', recipe: id, id: existing.id };
  const stores = [
    o.self.body.stock,
    here.eco.ground,
    ...here.eco.structures.filter((s) => s.condition > 0.2).map((s) => s.contents),
  ];
  for (const [item, n] of Object.entries(r.inputs))
    if (stores.reduce((n, s) => n + quantity(s, item), 0) + 1e-7 < n)
      return acquire(o, b, item, n, o.self.position, depth + 1);
  return { type: 'eco', op: 'construct', recipe: id };
}
export function executeGoal(o: EcoObservation, b: Brain): Decision | undefined {
  const goal = b.goal;
  if (!goal) return;
  delete b.goalBlocked;
  if (goal.skill === 'navigate') {
    const route =
      goal.region !== undefined && goal.region !== o.self.body.region
        ? { status: 'blocked' as const, reason: '坐标导航在当前区域内执行，跨区请另行迁徙' }
        : navigate(o, goal.x!, goal.y!);
    b.navigation = {
      status: route.status,
      ...('steps' in route ? { steps: route.steps } : {}),
      ...('reason' in route ? { reason: route.reason } : {}),
    };
    if (route.status === 'arrived') delete b.goal;
    return decision(
      b,
      'action' in route && route.action ? route.action : { type: 'wait' },
      route.status === 'moving'
        ? `导航至(${goal.x},${goal.y})，当前最短路线剩余${route.steps}步`
        : route.status === 'arrived'
          ? '已到达导航目的地'
          : route.reason!,
      'plan',
    );
  }
  const here = o.tiles.find((t) => dist(o.self.position, t) === 0)!;
  let action: Action | undefined;
  if (
    goal.skill === 'gather' &&
    goal.item &&
    quantity(o.self.body.stock, goal.item) >= (goal.quantity ?? 2)
  ) {
    const origin = b.gatherOrigin;
    if (
      b.movement?.returnAfterGather &&
      origin &&
      (origin.region !== o.self.body.region ||
        dist(o.self.position, { x: origin.position[0], y: origin.position[1] }) > 0)
    ) {
      const edge = origin.region > o.self.body.region ? o.policy.mapSize - 1 : 0;
      const step =
        origin.region === o.self.body.region
          ? move(o, ...origin.position)
          : o.self.position[0] === edge
            ? { type: 'eco' as const, op: 'travel' as const, region: origin.region }
            : move(o, edge, o.self.position[1]);
      return decision(b, step ?? { type: 'wait' }, '采集目标已满足，携带物料返回出发地', 'plan');
    }
    delete b.goal;
    delete b.gatherOrigin;
    return;
  }
  const procurement = b.procurement;
  if (procurement) {
    const step = acquire(o, b, procurement.item, procurement.need, procurement.site);
    if (step) return decision(b, step, '执行物料采办与运输', 'plan');
    delete b.procurement;
  }
  if (goal.region !== undefined && goal.region !== o.self.body.region) {
    const x = goal.region > o.self.body.region ? o.policy.mapSize - 1 : 0;
    action =
      o.self.position[0] === x
        ? { type: 'eco', op: 'travel', region: goal.region }
        : move(o, x, o.self.position[1]);
  } else if (
    goal.x !== undefined &&
    goal.y !== undefined &&
    dist(o.self.position, { x: goal.x, y: goal.y }) > 0
  )
    action = move(o, goal.x, goal.y);
  else
    switch (goal.skill) {
      case 'gather': {
        const item = goal.item;
        if (!item || !ITEMS[item]) break;
        const free = capacity(o.self.body.stock, o.policy.bagKg) - mass(o.self.body.stock);
        const needed = Math.min(free, (goal.quantity ?? 2) - quantity(o.self.body.stock, item));
        if (needed <= 0.01) break;
        const store = here.eco.structures.find(
          (s) => s.condition > 0.2 && quantity(s.contents, item) > 0,
        );
        const stock =
          quantity(here.eco.ground, item) > 0 ? here.eco.ground : (store?.contents ?? []);
        if (quantity(stock, item) > 0) {
          action = {
            type: 'eco',
            op: 'transfer',
            item,
            amount: Math.min(needed, quantity(stock, item)),
            destination: 'bag',
            ...(stock === store?.contents ? { id: store!.id } : {}),
          };
          break;
        }
        const at = o.tiles
          .filter((t) => !holdingPosition(o, b) || dist(o.self.position, t) === 0)
          .filter(
            (t) =>
              (t.eco.biomass[item] ?? 0) > 0.01 ||
              t.eco.deposits.some((d) => d.item === item && d.kg > 0.01),
          )
          .sort((a, c) => dist(o.self.position, a) - dist(o.self.position, c))[0];
        if (item === 'water' && here.eco.surfaceWater > 0)
          action = { type: 'eco', op: 'water', amount: needed };
        else if (at)
          action =
            dist(o.self.position, at) === 0
              ? { type: 'eco', op: 'collect', item, amount: Math.min(needed, 8) }
              : move(o, at.x, at.y);
        else {
          const known = b.places
            .filter(
              (p) =>
                p.region === o.self.body.region &&
                (p.resources?.[item] ?? 0) > 0 &&
                dist(o.self.position, p) > 1,
            )
            .sort((a, c) => dist(o.self.position, a) - dist(o.self.position, c))[0];
          action = known ? move(o, known.x, known.y) : explore(o, b);
        }
        break;
      }
      case 'make': {
        const r = RECIPES[goal.recipe!];
        if (r) {
          const have =
            quantity(o.self.body.stock, goal.recipe!) + quantity(here.eco.ground, goal.recipe!);
          if (have >= (goal.quantity ?? r.outputs[goal.recipe!] ?? 1)) {
            const item = goal.recipe!,
              n = Math.min(quantity(here.eco.ground, item), r.outputs[item] ?? 1);
            if (
              ITEMS[item]?.capabilities &&
              quantity(o.self.body.stock, item) < (r.outputs[item] ?? 1) &&
              n > 0 &&
              mass(o.self.body.stock) + n <=
                capacity(
                  [...o.self.body.stock, ...here.eco.ground.filter((b) => b.item === item)],
                  o.policy.bagKg,
                )
            ) {
              delete b.goal;
              return decision(
                b,
                { type: 'eco', op: 'transfer', item, amount: n, destination: 'bag' },
                '携带已完成工具',
                'plan',
              );
            }
            delete b.goal;
            return;
          }
          action = makeRecipe(o, b, r.id);
        }
        break;
      }
      case 'build': {
        const s = here.eco.structures.find(
          (s) => s.kind === goal.recipe && s.progress >= BUILDINGS[s.kind].minutes,
        );
        if (s) {
          delete b.goal;
          return;
        }
        action = build(o, b, goal.recipe!);
        break;
      }
      case 'meet':
      case 'reproduce': {
        const p = o.people.find((p) => p.id === goal.targetId);
        if (p && dist(o.self.position, p) > 0) action = move(o, p.x, p.y);
        else if (p && goal.skill === 'meet') {
          delete b.goal;
          return;
        } else if (p && goal.skill === 'reproduce') {
          const proposal = o.proposals.find(
            (p) =>
              p.accepted &&
              [p.from, p.to].includes(goal.targetId!) &&
              p.attempts[o.self.id] !== o.day,
          );
          if (proposal) action = { type: 'reproduce', proposalId: proposal.id };
        } else if (!p) {
          const place = [...b.places]
            .reverse()
            .find((p) => p.people?.includes(goal.targetId!) && o.day - p.day <= 3);
          if (place && dist(o.self.position, place) > 0) action = move(o, place.x, place.y);
        }
        break;
      }
      case 'deliver': {
        const n = quantity(o.self.body.stock, goal.item!);
        const person = o.people.find((p) => p.id === goal.targetId);
        if (n > 0 && person) {
          action =
            dist(o.self.position, person) > 0
              ? move(o, person.x, person.y)
              : {
                  type: 'eco',
                  op: 'transfer',
                  destination: 'person',
                  item: goal.item,
                  amount: Math.min(n, goal.quantity ?? n),
                  targetId: goal.targetId,
                };
          if (action?.type === 'eco') delete b.goal;
        } else action = acquire(o, b, goal.item!, goal.quantity ?? 1, o.self.position);
        break;
      }
      case 'farm': {
        if (!o.self.body.knowledge.includes('farming')) {
          const p = o.people.find((p) => p.role === 'prophet');
          if (p) action = { type: 'eco', op: 'study', recipe: 'farming', targetId: p.id };
          break;
        }
        const f = here.eco.fields.find((f) => f.stage !== 'fallow');
        if (!f || f.stage === 'clearing')
          action = capability(
            [
              o.self.body.stock,
              here.eco.ground,
              ...here.eco.structures.filter((s) => s.condition > 0.2).map((s) => s.contents),
            ],
            'digging',
          )
            ? { type: 'eco', op: 'clear', id: f?.id }
            : makeRecipe(o, b, 'digging_stick');
        else if (f.stage === 'prepared') {
          const crop = goal.item && CROPS[goal.item] ? goal.item : 'grain',
            c = CROPS[crop],
            seed =
              crop === 'winter_grain'
                ? 'grain'
                : crop === 'flax'
                  ? 'flax_seed'
                  : crop === 'hay'
                    ? 'grass_seed'
                    : crop;
          if (o.climate.day < c.plant[0] || o.climate.day > c.plant[1]) {
            b.goalBlocked = `当前历日${o.climate.day}不在${crop}播种季节${c.plant[0]}–${c.plant[1]}`;
            break;
          }
          const stores = [
            o.self.body.stock,
            here.eco.ground,
            ...here.eco.structures.filter((s) => s.condition > 0.2).map((s) => s.contents),
          ];
          action =
            f.seededKg ||
            stores.reduce((n, stock) => n + quantity(stock, seed), 0) >= c.seed * f.area
              ? { type: 'eco', op: 'sow', id: f.id, crop }
              : acquire(o, b, seed, c.seed * f.area, o.self.position);
        } else action = { type: 'eco', op: f.stage === 'ripe' ? 'harvest' : 'tend', id: f.id };
        break;
      }
      case 'herd':
        action = here.eco.herds[0]
          ? { type: 'eco', op: 'herd', id: here.eco.herds[0].id, item: goal.item }
          : undefined;
        break;
      case 'improve':
        action = { type: 'eco', op: 'improve', item: goal.item ?? 'road' };
        break;
      case 'explore':
        action = explore(o, b);
        break;
      case 'hunt':
        action = acquire(o, b, goal.item ?? 'meat', goal.quantity ?? 3, o.self.position);
        break;
      case 'survey':
        action = { type: 'survey' };
        delete b.goal;
        break;
      case 'learn':
        action = { type: 'eco', op: 'study', recipe: goal.recipe, targetId: goal.targetId };
        delete b.goal;
        break;
      case 'repair':
        action = { type: 'eco', op: 'repair', id: goal.item };
        delete b.goal;
        break;
      case 'confront': {
        const p = o.people.find((p) => p.id === goal.targetId);
        if (p && dist(o.self.position, p) > 0) action = move(o, p.x, p.y);
        else if (p) {
          action = { type: 'attack', targetId: p.id };
          delete b.goal;
        }
        break;
      }
      case 'inscribe': {
        const item = goal.item === 'stone_tablet' ? 'stone_tablet' : 'wood_tablet';
        const required = item === 'stone_tablet' ? 2 : 1;
        const stores = [
          o.self.body.stock,
          here.eco.ground,
          ...here.eco.structures.filter((s) => s.condition > 0.2).map((s) => s.contents),
        ];
        if (!goal.text) break;
        if (stores.reduce((n, s) => n + quantity(s, item), 0) < required)
          action = makeRecipe(o, b, item);
        else if (capability(stores, 'cutting') <= 0) action = makeRecipe(o, b, 'flake');
        else if (item === 'stone_tablet' && capability(stores, 'hammer') <= 0)
          action = makeRecipe(o, b, 'handaxe');
        else action = { type: 'eco', op: 'inscribe', item, text: goal.text };
        break;
      }
      case 'defend': {
        const beast = (o.beasts ?? []).find((v) => v.id === goal.item) ?? o.beasts?.[0];
        if (beast) action = { type: 'eco', op: 'fight_beast', item: beast.id };
        else if (goal.x !== undefined && goal.y !== undefined) action = move(o, goal.x, goal.y);
        break;
      }
      case 'secure_food':
        return survival(o, b);
    }
  if (!action && b.goal) {
    b.goalBlocked ??= `目标${goal.skill}本轮没有可执行步骤：请检查材料、工具、对象位置及移动约束`;
    return decision(b, { type: 'wait' }, b.goalBlocked, 'plan');
  }
  if (action)
    return decision(
      b,
      action,
      `执行持续计划：${goal.skill} ${goal.recipe ?? goal.item ?? ''}`,
      'plan',
    );
}
export function deepReflectionDue(o: EcoObservation) {
  return Math.floor(o.day / 10) > Math.floor((o.self.brain.lastDeepReflectionDay ?? 0) / 10);
}
export function wantsModel(o: EcoObservation, b: Brain) {
  const temperament = preferences(o.self.personality);
  if (
    !o.policy.budgetAvailable ||
    b.callsDay >= o.policy.llmDailyCalls ||
    (b.tokensDay ?? 0) >= o.policy.llmDailyTokens ||
    o.self.ap < 0.2
  )
    return false;
  const incoming = o.messages.some((m) => !b.handled.includes(m.id) && m.day >= o.day - 1);
  const proposal = o.proposals.some(
    (p) => p.to === o.self.id && !p.accepted && !b.handled.includes(p.id),
  );
  const social =
    o.people.length > 0 && (o.day - b.lastTalk >= temperament.socialDays || o.self.loneliness > 0);
  return (
    (!!b.goalBlocked && b.callsDay === 0) ||
    deepReflectionDue(o) ||
    (!!o.beasts?.length && b.callsDay === 0) ||
    (b.navigation?.status === 'blocked' && b.callsDay === 0) ||
    !!b.recallQuery ||
    !!b.recipeQuery ||
    proposal ||
    (incoming && b.callsDay < 1) ||
    (social && b.callsDay < 1) ||
    (social && b.callsDay < 2 && o.self.depressed) ||
    ((!b.goal || b.failures >= 2 || o.day - b.lastThought >= temperament.reconsiderDays) &&
      b.callsDay === 0)
  );
}
function avoidBeast(o: EcoObservation, b: Brain): Decision | undefined {
  const beasts = o.beasts ?? [];
  if (!beasts.length) return;
  const retreat = shouldFlee(o.self.hp, b);
  if (!retreat && b.goal?.skill === 'defend') return;
  if (!retreat && o.self.adult && o.self.ap >= 1)
    return decision(
      b,
      { type: 'eco', op: 'fight_beast', item: beasts[0].id },
      '与附近成年人共同抵御野兽',
    );
  if (!retreat) return decision(b, { type: 'wait' }, '按战斗策略守在原地');
  const here = { x: o.self.position[0], y: o.self.position[1] };
  const safety = (t: { x: number; y: number }) =>
    Math.min(...beasts.map((v) => Math.max(Math.abs(v.x - t.x), Math.abs(v.y - t.y))));
  const tiles = o.tiles
    .filter((t) => Math.abs(t.x - here.x) + Math.abs(t.y - here.y) === 1 && t.eco.biome !== 'water')
    .sort(
      (a, b) =>
        safety(b) - safety(a) ||
        o.people.filter((p) => Math.max(Math.abs(p.x - b.x), Math.abs(p.y - b.y)) <= 1).length -
          o.people.filter((p) => Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y)) <= 1).length,
    );
  const dst = tiles[0];
  if (dst && safety(dst) >= safety(here)) {
    if (retreat) {
      if (b.movement) delete b.movement.holdUntil;
      if (b.goal?.skill !== 'navigate') delete b.goal;
      delete b.procurement;
      delete b.forageTrip;
      delete b.gatherOrigin;
    }
    return decision(
      b,
      { type: 'move', dx: dst.x - here.x, dy: dst.y - here.y },
      '避开野兽并寻找同伴',
    );
  }
}
function enforceMovement(o: EcoObservation, d: Decision): Decision {
  if (
    holdingPosition(o, d.brainUpdate!.brain) &&
    (d.action.type === 'move' || (d.action.type === 'eco' && d.action.op === 'travel'))
  ) {
    d.action = { type: 'wait' };
    d.intent = '遵守定点停留约束；可原地行动或由本人重新调整';
  }
  return d;
}
function returnFromForaging(o: EcoObservation, b: Brain): Decision | undefined {
  const trip = b.forageTrip;
  if (!trip?.returning) return;
  return decision(b, move(o, ...trip.origin) ?? { type: 'wait' }, '采集结束，返回本次外出的出发地');
}
export function ruleDecision(o: EcoObservation, source: 'rule' | 'fallback' = 'rule'): Decision {
  const b = remember(o);
  o = { ...o, self: { ...o.self, brain: b } };
  b.visits ??= {};
  const key = o.self.position.join(',');
  b.visits[key] = (b.visits[key] ?? 0) + 1;
  let d = b.goal?.skill === 'navigate' ? executeGoal(o, b) : avoidBeast(o, b);
  if (b.goal?.skill === 'navigate') {
    if (b.navigation?.status === 'blocked') d = avoidBeast(o, b) ?? d;
    if (o.self.body.foodKcal < 1500 || o.self.body.waterL < 1) {
      const urgent = survival(o, structuredClone(b));
      if (urgent?.action.type === 'eco' && ['eat', 'drink'].includes(urgent.action.op))
        d = decision(b, urgent.action, '导航途中就地补充危急的饮食需求');
    }
  }
  if (!d && b.forageTrip?.returning) {
    const local = survival(o, b);
    d =
      local?.action.type === 'eco' && ['eat', 'drink', 'discard'].includes(local.action.op)
        ? local
        : returnFromForaging(o, b);
  }
  d ??= survival(o, b);
  if (d?.action.type === 'wait' && holdingPosition(o, b)) d = executeGoal(o, b) ?? d;
  if (!d && o.self.loneliness >= 20 && !o.people.length) {
    const p = [...b.places].reverse().find((p) => p.people?.length && o.day - p.day <= 5);
    const step = p ? move(o, p.x, p.y) : explore(o, b);
    d = decision(b, step ?? { type: 'wait' }, '孤单时寻找可交流的活人');
  }
  d ??= executeGoal(o, b);
  if (!d) {
    const companion = o.people[0];
    if (!companion && o.self.loneliness > 0) {
      const p = [...b.places].reverse().find((p) => p.people?.length && o.day - p.day <= 5);
      const step = p ? move(o, p.x, p.y) : explore(o, b);
      d = decision(b, step ?? { type: 'wait' }, '寻找近期见过的人，等待自主交流');
    } else d = decision(b, { type: 'wait' }, '完成日常需要，保留计划等待机会');
  }
  if (source === 'fallback') {
    d.brainUpdate!.brain.source = 'fallback';
  }
  if (actionMinutes(d.action) > o.self.ap * 120) {
    d.action = { type: 'wait' };
    d.intent = '剩余劳动时间不足，休息';
  }
  return enforceMovement(o, d);
}
const actionMinutes = (a: Action) =>
  a.type === 'eco'
    ? ['eat', 'drink', 'water', 'transfer', 'start_job'].includes(a.op)
      ? 12
      : a.op === 'inscribe'
        ? a.item === 'stone_tablet'
          ? 120
          : 60
        : a.op === 'discard'
          ? 0
          : 120
    : a.type === 'chat' || a.type === 'public_speak'
      ? 24
      : a.type === 'shout' || a.type === 'survey'
        ? 240
        : a.type === 'move'
          ? 12
          : 120;
export function shouldThink(o: EcoObservation) {
  const b = remember(o);
  return (
    (deepReflectionDue(o) ||
      !survival(o, b) ||
      holdingPosition(o, b) ||
      !!o.beasts?.length ||
      b.navigation?.status === 'blocked' ||
      !!b.goalBlocked) &&
    wantsModel(o, b)
  );
}
export function interpret(o: EcoObservation, out: BrainOutput, attempts = 1, tokens = 0): Decision {
  const reflecting = deepReflectionDue(o);
  const b = remember(o);
  b.source = 'llm';
  b.callsDay += attempts;
  b.calls += attempts;
  b.tokensDay = (b.tokensDay ?? 0) + tokens;
  b.lastThought = o.day;
  b.thought = out.intent;
  if (reflecting && out.reflection) {
    b.lastDeepReflectionDay = o.day;
    b.deepReflection = { day: o.day, ...out.reflection };
  }
  if (out.combatPolicy) b.combatPolicy = { ...out.combatPolicy };
  delete b.recallQuery;
  delete b.recipeQuery;
  if (out.recall) b.recallQuery = out.recall;
  if (out.inspectRecipe) b.recipeQuery = out.inspectRecipe;
  b.handled = [
    ...new Set([...b.handled, ...o.messages.map((m) => m.id), ...o.proposals.map((p) => p.id)]),
  ].slice(-60);
  if (out.movement) {
    b.movement ??= {};
    if (out.movement.stayMinutes !== undefined) {
      if (out.movement.stayMinutes > 0)
        b.movement.holdUntil = activityTime(o) + out.movement.stayMinutes;
      else delete b.movement.holdUntil;
    }
    if (out.movement.returnAfterGather !== undefined) {
      b.movement.returnAfterGather = out.movement.returnAfterGather;
      if (!out.movement.returnAfterGather) delete b.forageTrip;
    }
  }
  if (out.goal) {
    delete b.navigation;
    delete b.goalBlocked;
    if (out.goal.skill === 'navigate' && b.movement) delete b.movement.holdUntil;
    delete b.procurement;
    delete b.forageTrip;
    delete b.gatherOrigin;
    if (out.goal.skill === 'gather')
      b.gatherOrigin = { position: [...o.self.position], region: o.self.body.region };
    b.goal = {
      ...out.goal,
      expires: Math.min(out.goal.expires, o.day + 30),
      ...(out.goal.skill === 'build' || out.goal.skill === 'farm' || out.goal.skill === 'inscribe'
        ? { x: out.goal.x ?? o.self.position[0], y: out.goal.y ?? o.self.position[1] }
        : {}),
    };
  }
  o = { ...o, self: { ...o.self, brain: b } };
  let action: Action | undefined;
  if (out.agreement) {
    const ag = out.agreement;
    action = {
      type: 'chat',
      text: out.speech?.text ?? out.intent,
      ...(ag.operation === 'propose'
        ? { proposal: { kind: 'reproduce' as const, targetId: ag.targetId } }
        : ag.operation === 'accept'
          ? { acceptProposalId: ag.proposalId }
          : { revokeProposalId: ag.proposalId }),
    };
    if (ag.operation === 'accept') {
      const p = o.proposals.find((p) => p.id === ag.proposalId);
      if (p) b.goal = { skill: 'reproduce', targetId: p.from, expires: o.day + 2 };
    }
  } else if (out.speech)
    action =
      out.speech.channel === 'shout' || out.speech.channel === 'public_speak'
        ? { type: out.speech.channel, text: out.speech.text }
        : { type: 'chat', text: out.speech.text, targetId: out.speech.targetId };
  if (!action) {
    const next =
      b.goal?.skill === 'navigate'
        ? executeGoal(o, b)
        : shouldFlee(o.self.hp, b)
          ? (avoidBeast(o, b) ?? executeGoal(o, b))
          : executeGoal(o, b);
    action = next?.action ?? { type: 'wait' };
  }
  if (actionMinutes(action) > o.self.ap * 120) action = { type: 'wait' };
  return enforceMovement(o, {
    ...decision(b, action, out.intent, 'llm'),
    memory_note:
      reflecting && out.reflection
        ? `深度反思：${out.reflection.summary}；未来规划：${out.reflection.plan}`
        : out.note,
  });
}
/** A small context of facts the actor can observe, never a global world summary. */
export function compactContext(o: EcoObservation) {
  const b = o.self.body,
    here = o.tiles.find((t) => dist(o.self.position, t) === 0)!;
  const known = o.self.body.knowledge;
  const relevant = [
    ...new Set([
      o.self.brain.goal?.recipe,
      ...known.filter((k) =>
        k.startsWith('build:')
          ? false
          : [
              'flake',
              'digging_stick',
              'cord',
              'basket',
              'sickle',
              'hoe',
              'pot',
              'charcoal',
              'flour',
            ].includes(k),
      ),
    ]),
  ]
    .filter((k): k is string => !!k)
    .slice(0, 12);
  return {
    protocol: 'context-1',
    seq: o.seq,
    minute: o.minute,
    contextHead: o.self.brain.contextHead,
    recallQuery: o.self.brain.recallQuery,
    recipeQuery: o.self.brain.recipeQuery,
    knowledgeLibrary: Object.fromEntries(
      known
        .map((id) => [
          id,
          id === 'farming'
            ? { name: '农耕', steps: '备地→适季播种→照管→成熟收割', crops: CROPS }
            : id.startsWith('build:')
              ? BUILDINGS[id.slice(6)]
              : RECIPES[id],
        ])
        .filter(([, v]) => v),
    ),
    additionalGoals: {
      hunt: '获取肉/骨/皮/脂/羽毛，item指定产物',
      survey: '全力观察，240分钟',
      learn: 'recipe指定知识、targetId指定老师',
      repair: 'item填写自己物品或本地设施的id',
      confront: '明确选择攻击targetId，一次；引擎要求同格',
    },
    day: o.day,
    calendar: o.climate,
    deepReflection: deepReflectionDue(o),
    self: {
      id: o.self.id,
      name: o.self.name,
      role: o.self.role,
      personality: o.self.personality,
      combat: o.self.combat,
      combatPolicy: combatPolicy(o.self.brain),
      callsDay: o.self.brain.callsDay,
      tokensDay: o.self.brain.tokensDay ?? 0,
      sex: o.self.sex,
      adult: o.self.adult,
      hp: o.self.hp,
      hunger: o.self.hunger,
      water: b.waterL,
      ap: o.self.ap,
      position: o.self.position,
      region: b.region,
      loneliness: o.self.loneliness,
      lonelinessCapacity: o.self.lonelinessCapacity,
      depressed: o.self.depressed,
      pregnancy: o.self.pregnancy,
      bag: b.stock.map((x) => ({
        id: x.id,
        item: x.item,
        kg: +x.kg.toFixed(2),
        risk: +x.risk.toFixed(2),
        wear: x.wear,
      })),
      skills: b.skills,
      goal: o.self.brain.goal,
      navigation: o.self.brain.navigation,
      goalBlocked: o.self.brain.goalBlocked,
      movement: {
        ...o.self.brain.movement,
        stayMinutesLeft: Math.max(0, (o.self.brain.movement?.holdUntil ?? 0) - activityTime(o)),
      },
      forageTrip: o.self.brain.forageTrip,
      gatherOrigin: o.self.brain.gatherOrigin,
      lastThought: o.self.brain.thought,
      lastFailure: o.self.brain.lastFailure,
      knowledge: known,
    },
    people: o.people,
    corpses: o.corpses,
    inscriptions: (o.inscriptions ?? []).slice(-12),
    beasts: o.beasts ?? [],
    settlements: o.settlements ?? [],
    lastSurvey: o.lastSurvey
      ? {
          day: o.lastSurvey.day,
          people: o.lastSurvey.people,
          corpses: o.lastSurvey.corpses,
          beasts: o.lastSurvey.beasts ?? [],
          tiles: o.lastSurvey.tiles.map((t) => ({
            x: t.x,
            y: t.y,
            biome: t.eco.biome,
            water: +t.eco.surfaceWater.toFixed(1),
            resources: Object.fromEntries(
              [
                ...Object.entries(t.eco.biomass),
                ...t.eco.deposits.map((d) => [d.item, d.kg] as [string, number]),
              ]
                .filter(([, q]) => q > 0.1)
                .map(([id, q]) => [id, +q.toFixed(1)]),
            ),
            fields: t.eco.fields.map((f) => ({ id: f.id, stage: f.stage })),
            structures: t.eco.structures.map((b) => ({ id: b.id, kind: b.kind })),
          })),
        }
      : undefined,
    memoryCandidates: [...o.messages, ...o.memories],
    messages: o.messages
      .filter((m) => m.day >= o.day - 2)
      .slice(-5)
      .map((m) => ({ id: m.id, from: m.speakerId, day: m.day, text: m.content.slice(0, 260) })),
    memories: o.memories.slice(-3).map((m) => ({
      id: m.id,
      day: m.day,
      text: m.content.slice(0, 220),
      source: m.source,
      eventIds: m.eventIds,
      importance: m.importance,
    })),
    proposals: o.proposals,
    ground: here.eco.ground.map((b) => ({ item: b.item, kg: +b.kg.toFixed(2) })),
    nearby: o.tiles.map((t) => ({
      x: t.x,
      y: t.y,
      biome: t.eco.biome,
      water: +t.eco.surfaceWater.toFixed(1),
      materials: Object.fromEntries(
        [
          ...Object.entries(t.eco.biomass).filter(([id]) => !ITEMS[id]?.kcal),
          ...t.eco.deposits.map((d) => [d.item, d.kg] as [string, number]),
        ]
          .filter(([, q]) => q > 0.1)
          .map(([id, q]) => [id, +q.toFixed(1)]),
      ),
      food: Object.fromEntries(
        Object.entries(t.eco.biomass)
          .filter(([id, n]) => ITEMS[id]?.kcal && n > 0.1)
          .map(([id, n]) => [id, +n.toFixed(1)]),
      ),
      fields: t.eco.fields.map((f) => ({
        id: f.id,
        crop: f.crop,
        stage: f.stage,
        area: f.area,
        seededKg: f.seededKg,
        sowingWork: f.sowingWork ?? 0,
        sowingRequired: 15 * f.area * 120,
        work: f.work,
        harvestWork: f.harvestWork,
      })),
      structures: t.eco.structures.map((s) => ({
        id: s.id,
        kind: s.kind,
        progress: s.progress,
        condition: s.condition,
      })),
    })),
    jobs: o.jobs
      .filter((j) => j.state !== 'complete')
      .map((j) => ({ id: j.id, recipe: j.recipe, work: j.work, readyDay: j.readyDay })),
    recipes: relevant.map((id) => RECIPES[id]).filter(Boolean),
    buildingOptions: known
      .filter((k) => k.startsWith('build:'))
      .map((k) => ({ id: k.slice(6), ...BUILDINGS[k.slice(6)] }))
      .slice(0, 4),
    policy: { ...o.policy, minutesPerAP: 120 },
  };
}
