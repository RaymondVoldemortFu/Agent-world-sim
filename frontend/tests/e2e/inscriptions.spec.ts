import { test, expect, type Page } from '@playwright/test';
import { createWorld } from '../../src/sim/world';
import { batch } from '../../src/ecology/batches';
import { ecoAt } from '../../src/ecology/world';
import { BUILDINGS } from '../../src/ecology/catalog';
import type { World } from '../../src/sim/types';

async function serve(page: Page, world: World, name = 'inscriptions-ui') {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { configured: true, model: 'test', contextWindow: 65536 } }),
  );
  await page.route(`**/api/experiments/${name}/snapshot*`, (route) =>
    route.fulfill({
      json: {
        world,
        events: [],
        elapsedMs: 0,
        control: { state: 'paused', canResume: true, concurrency: 6, reason: '' },
      },
    }),
  );
  await page.route(`**/api/experiments/${name}/events?*`, (route) =>
    route.fulfill({ json: { events: [], hasMore: false } }),
  );
}

test('inscriptions expose text, original author, carrier and filters without replay-log queries', async ({
  page,
}) => {
  const w = createWorld({ worldModel: 'ecology', population: 2, regions: 1 }, 'inscriptions-ui');
  const carved = (id: string, item: string, text: string, day: number, authorId: number) => ({
    ...batch(item, item === 'inscribed_stone' ? 2 : 1, day, id, 'test'),
    inscription: {
      id,
      authorId,
      authorName: authorId === 1 ? '舟' : '禾',
      day,
      eventSeq: day,
      text,
    },
  });
  const t = ecoAt(w, 5, 5).eco!;
  t.ground.push(
    carved('text-1', 'inscribed_wood', '轮流守夜，天黑归村。<script>原文</script>', 1, 1),
  );
  w.agents[1].eco!.stock.push(carved('text-2', 'inscribed_stone', '播种之前保留种粮。', 2, 1));
  t.structures.push({
    id: 'archive',
    kind: 'granary',
    condition: 1,
    progress: BUILDINGS.granary.minutes,
    contents: [carved('text-3', 'inscribed_wood', '交换工具须双方确认。', 3, 2)],
  });
  await serve(page, w);
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => requests.push(req.url()));
  await page.goto('/?experiment=inscriptions-ui&page=inscriptions');
  const region = page.getByRole('region', { name: '铭文档案' });
  await expect(region.locator('.inscription-card')).toHaveCount(3);
  await expect(region.locator('.inscription-card').first()).toContainText('交换工具');
  await expect(region).toContainText(`${w.agents[1].name} #2 的背包`);
  await expect(region).toContainText('小粮仓 · archive');
  await region.getByRole('combobox', { name: '载体', exact: true }).selectOption('inscribed_stone');
  await expect(region.locator('.inscription-card')).toHaveCount(1);
  await expect(region.locator('.inscription-card')).toContainText('舟 #1 刻写');
  await region.getByRole('button', { name: '重置筛选' }).click();
  await region.getByLabel('搜索铭文').fill('守夜');
  await expect(region.locator('.inscription-card')).toHaveCount(1);
  await expect(region.locator('.inscription-text')).toContainText('<script>原文</script>');
  await expect(region.locator('script')).toHaveCount(0);
  await region.getByRole('button', { name: '重置筛选' }).click();
  await region.getByRole('combobox', { name: '书写者', exact: true }).selectOption('2');
  await expect(region.locator('.inscription-card')).toHaveCount(1);
  await region.getByLabel('刻写结束日').fill('1');
  await expect(region).toContainText('没有匹配的铭文');
  await region.getByRole('button', { name: '重置筛选' }).click();
  await page.screenshot({ path: 'artifacts/inscriptions-page-ui.png', fullPage: true });
  expect(requests.some((r) => /\/events\?|\/journal\?|\/experiences\?/.test(r))).toBe(false);
  expect(errors).toEqual([]);
});

test('next experiment saves its own window and leaves the current experiment unchanged', async ({
  page,
}) => {
  const w = createWorld(
    { worldModel: 'ecology', population: 2, contextWindow: 32768 },
    'window-ui',
  );
  await serve(page, w, 'window-ui');
  let submitted: any;
  await page.route('**/api/experiments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = route.request().postDataJSON();
    const next = createWorld(submitted.config, 'next-window-ui');
    await serve(page, next, 'next-window-ui');
    await route.fulfill({
      json: {
        name: 'next-window-ui',
        control: { state: 'paused', canResume: true, concurrency: 6, reason: '' },
      },
    });
  });
  await page.goto('/?experiment=window-ui&page=config');
  await expect(page.locator('main')).toContainText('本实验上下文窗口 32,768 tokens');
  await page.getByRole('button', { name: '配置新实验' }).click();
  const dialog = page.getByRole('dialog', { name: '实验设置' });
  await dialog.getByLabel('下次实验上下文窗口（tokens）', { exact: true }).fill('8192');
  await expect(page.locator('main')).toContainText('本实验上下文窗口 32,768 tokens');
  await dialog.getByRole('button', { name: '启动后台实验 ↗' }).click();
  await expect(page).toHaveURL(/experiment=next-window-ui/);
  expect(submitted.config.contextWindow).toBe(8192);
  expect(w.config.contextWindow).toBe(32768);
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.locator('main')).toContainText('本实验上下文窗口 8,192 tokens');
});
