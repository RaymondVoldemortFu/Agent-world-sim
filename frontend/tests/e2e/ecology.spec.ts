import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/sim/world';
import { ecoAt } from '../../src/ecology/world';
import { BUILDINGS } from '../../src/ecology/catalog';
import { batch } from '../../src/ecology/batches';

test('village preset and movement controls are visible with the live context window', async ({
  page,
}) => {
  const w = createWorld(
    { worldModel: 'ecology', ecoPreset: 'village', population: 20 },
    'village-ui',
  );
  w.agents[0].brain!.movement = { holdUntil: 600, returnAfterGather: true };
  w.agents[0].brain!.combatPolicy = { mode: 'low_hp', retreatHp: 75 };
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: true, model: 'test', contextWindow: 65536 } }),
  );
  await page.route('**/api/experiments/village-ui/snapshot*', (route) =>
    route.fulfill({
      json: {
        world: w,
        events: [],
        elapsedMs: 0,
        control: { state: 'paused', canResume: true, reason: '', concurrency: 8 },
      },
    }),
  );
  await page.route('**/api/experiments/village-ui/events?*', (route) =>
    route.fulfill({ json: { events: [], hasMore: false } }),
  );
  await page.goto('/?experiment=village-ui');
  await expect(page.locator('.eco-stats')).toContainText('初始村落');
  await expect(page.locator('.eco-detail')).toContainText('原地停留剩余 600 劳动分钟');
  await expect(page.locator('.eco-detail')).toContainText('采集后返回出发地');
  await expect(page.locator('.eco-detail')).toContainText('战斗策略：低血量撤退（生命 ≤ 75）');
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.locator('main')).toContainText('65,536 tokens');
  await expect(page.locator('main')).toContainText('农田 7.00 ha');
  await page.getByRole('button', { name: '配置新实验', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '实验设置' });
  await dialog.getByLabel('生态开局', { exact: true }).selectOption('village');
  await expect(dialog.getByLabel('出生分布', { exact: true })).toHaveValue('compact');
  await expect(dialog.getByLabel('出生分布', { exact: true })).toBeDisabled();
  await page.screenshot({ path: 'artifacts/village-settings-ui.png', fullPage: true });
});
test('ecology UI shows regions, body stocks, industry, settings and preserved experiment controls', async ({
  page,
}) => {
  const w = createWorld(
    { worldModel: 'ecology', population: 20, days: 100, startDay: 180 },
    'eco-ui',
  );
  let state = 'paused';
  const control = () => ({ state, canResume: state === 'paused', reason: '', concurrency: 8 });
  await page.route('**/api/experiments/eco-ui/snapshot*', (route) =>
    route.fulfill({ json: { world: w, events: [], elapsedMs: 0, control: control() } }),
  );
  await page.route('**/api/experiments/eco-ui/events?*', (route) =>
    route.fulfill({ json: { events: [], hasMore: false } }),
  );
  await page.route('**/api/experiments/eco-ui/resume', (route) => {
    state = 'running';
    return route.fulfill({ json: control() });
  });
  await page.goto('/?experiment=eco-ui');
  await expect(page.getByText('生态与产业 · 第 1 年 · 夏 · 年内第 180 天')).toBeVisible();
  await expect(page.locator('.eco-map [role=button]')).toHaveCount(225);
  await page.getByRole('button', { name: '铜山', exact: true }).click();
  await expect(page.locator('.eco-detail')).toContainText('铜山');
  const map = page.getByRole('group', { name: '生态地形地图' });
  const initialView = await map.getAttribute('viewBox');
  await page.getByRole('button', { name: '放大地图', exact: true }).click();
  await expect(map).not.toHaveAttribute('viewBox', initialView!);
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await expect(page.getByRole('button', { name: '网格', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const selectedTile = await page.locator('.eco-detail h3').first().textContent();
  const bounds = (await map.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.4, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.locator('.eco-detail h3').first()).toHaveText(selectedTile!);
  await page.getByRole('button', { name: '复位', exact: true }).click();
  await expect(map).toHaveAttribute('viewBox', initialView!);
  await page.getByRole('button', { name: '网格', exact: true }).click();
  await page.getByLabel('生态居民').selectOption('1');
  await expect(page.locator('.eco-detail')).toContainText('先知');
  await page.getByRole('button', { name: '资源 / 合成 / 建筑目录 展开' }).click();
  await expect(page.locator('.eco-table').last()).toContainText('海绵铁');
  await page.getByRole('button', { name: '继续实验', exact: true }).click();
  await expect(page.getByRole('button', { name: '中断实验', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '河谷', exact: true }).click();
  await page.locator('.eco-map-shell').screenshot({ path: 'artifacts/ecology-map-detail.png' });
  await page.screenshot({ path: 'artifacts/eco-ui.png', fullPage: true });
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.locator('main')).toContainText('生态与混合决策配置');
  await expect(page.locator('main')).toContainText('280 天');
});

test('map and details expose beasts, wall durability and attributed tablet text', async ({
  page,
}) => {
  const w = createWorld({ worldModel: 'ecology', population: 8, regions: 1 }, 'fort-ui');
  const t = ecoAt(w, 0, 0).eco!;
  t.structures.push({
    id: 'wall-ui',
    kind: 'stone_wall',
    condition: 0.5,
    progress: BUILDINGS.stone_wall.minutes,
    contents: [],
  });
  const inscription = {
    id: 'writing-ui',
    authorId: 1,
    authorName: w.agents[0].name,
    day: 1,
    eventSeq: 1,
    text: '守夜约定：每晚两人轮班。<script>这是刻字原文</script>',
  };
  t.ground.push({ ...batch('inscribed_stone', 2, 1, 'tablet-ui', 'test'), inscription });
  w.ecology!.beasts = [
    {
      id: 'beast-ui',
      species: 'bear',
      region: 0,
      x: 0,
      y: 0,
      hp: 180,
      maxHp: 200,
      attack: 24,
      born: 0,
      mode: 'raiding',
    },
  ];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/experiments/fort-ui/snapshot*', (route) =>
    route.fulfill({
      json: {
        world: w,
        events: [],
        elapsedMs: 0,
        control: { state: 'paused', canResume: true, reason: '', concurrency: 8 },
      },
    }),
  );
  await page.route('**/api/experiments/fort-ui/events?*', (route) =>
    route.fulfill({ json: { events: [], hasMore: false } }),
  );
  await page.goto('/?experiment=fort-ui');
  await expect(page.locator('.eco-detail')).toContainText('生命 180/200 · 攻击 24');
  await expect(page.locator('.eco-detail')).toContainText('城墙耐久 425/850');
  await expect(page.locator('.eco-detail .memory')).toContainText(inscription.text);
  await expect(page.locator('.eco-detail .memory')).toContainText(
    `${inscription.authorName} #1 刻写`,
  );
  await expect(page.locator('.eco-detail script')).toHaveCount(0);
  await expect(page.locator('[aria-label="野兽位置"] > g')).toHaveCount(1);
  await expect(page.locator('[aria-label="城墙与铭文"] text')).toHaveText('墙3');
  await page.screenshot({ path: 'artifacts/wildlife-fortifications-ui.png', fullPage: true });
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.locator('main')).toContainText('城墙四级');
  await expect(page.locator('main')).toContainText('野兽：开启');
  expect(errors).toEqual([]);
});
