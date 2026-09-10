import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/sim/world';
import { metrics } from '../../src/sim/engine';
import path from 'node:path';

test('statistics show ecological state, link to an agent, and fit mobile', async ({ page }) => {
  const w = createWorld({ worldModel: 'ecology', population: 20 }, 'stats-ui');
  w.metrics = [
    { ...metrics(w), day: 1 },
    { ...metrics(w), day: 2 },
  ];
  w.tick = 3;
  await page.route('**/api/experiments/stats-ui/snapshot*', (r) =>
    r.fulfill({
      json: { world: w, elapsedMs: 0, events: [], control: { state: 'paused', canResume: true } },
    }),
  );
  await page.route('**/api/experiments/stats-ui/events?*', (r) =>
    r.fulfill({ json: { events: [], hasMore: false } }),
  );
  await page.route('**/api/experiments/stats-ui/experiences?*', (r) =>
    r.fulfill({ json: { experiences: [], hasMore: false, through: 0 } }),
  );
  await page.goto('/?experiment=stats-ui');
  await page.getByRole('button', { name: '统计数据', exact: true }).click();
  const stats = page.getByRole('region', { name: '世界统计数据' });
  await expect(stats.getByText('存活人口', { exact: true })).toBeVisible();
  await expect(stats.locator('.data-card').first()).toContainText('20 人');
  await expect(stats).toContainText('资源库存');
  await expect(stats).toContainText('在制投入');
  await expect(stats).toContainText('平均孤单');
  await page.screenshot({ path: 'artifacts/statistics-page.png', fullPage: true });
  const person = w.agents[1];
  await stats.getByRole('button', { name: `${person.name} #${person.id}`, exact: true }).click();
  await expect(page.getByLabel('经历查询居民')).toHaveValue(String(person.id));
  await expect(page.getByRole('region', { name: 'Agent经历查询' })).toContainText(
    '没有符合筛选条件',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '统计数据', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/statistics-mobile.png', fullPage: true });
});
for (const source of ['archive', 'local'])
  test(`individual experiences search ${source} history and show provenance`, async ({ page }) => {
    await page.goto(source === 'archive' ? '/?experiment=e2e-search-fixture' : '/');
    if (source === 'local') {
      await page.getByRole('button', { name: '导入 ↑' }).click();
      await page
        .locator('input[type=file]')
        .setInputFiles(path.resolve('artifacts/e2e-search-fixture/run.json'));
      await expect(page.getByText('实验记录导入成功')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Agent 经历', exact: true }).click();
    const rows = page.locator('.experience-row');
    await expect(rows).toHaveCount(38);
    await expect(page.getByRole('button', { name: '加载更早经历', exact: true })).toBeDisabled();
    await page.getByLabel('经历关键词').fill('合作');
    await expect(rows.first()).toContainText('合作');
    await page.getByLabel('经历来源').selectOption('heard');
    await expect(rows.first().locator('.memory-source')).toHaveText(/听闻|本人发言/);
    await rows.first().getByRole('button', { name: '来源详情 展开' }).click();
    await expect(rows.first()).toContainText('讲述者');
    await rows.first().getByRole('button', { name: '查看关联行动的决策' }).click();
    await expect(page.getByRole('dialog', { name: '决策记录' })).toBeVisible();
    await page.getByRole('dialog', { name: '决策记录' }).getByRole('button', { name: '×' }).click();
    await page.screenshot({ path: `artifacts/agent-experiences-${source}.png`, fullPage: true });
    await page.getByLabel('经历起始日').fill('50');
    await page.getByLabel('经历结束日').fill('1');
    await expect(page.getByRole('alert')).toContainText('起始日不能晚于结束日');
    await page.getByLabel('经历起始日').fill('1');
    await expect(rows.first()).toContainText('合作');
    await page.getByLabel('经历关键词').fill('不存在的经历');
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('没有符合筛选条件的已记录经历。')).toBeVisible();
  });

test('experiences cursor pagination and deceased agent selection survive reload', async ({
  page,
}) => {
  const w = createWorld({ population: 2 }, 'experience-pages');
  w.seq = 100;
  w.agents[1].death = { day: 2, cause: '测试死亡' };
  const requests: URLSearchParams[] = [];
  await page.route('**/api/experiments/experience-pages/snapshot*', (r) =>
    r.fulfill({ json: { world: w, elapsedMs: 0, events: [], control: { state: 'paused' } } }),
  );
  await page.route('**/api/experiments/experience-pages/experiences?*', (r) => {
    const p = new URL(r.request().url()).searchParams;
    requests.push(p);
    const end = Number(p.get('before') ?? 91) - 1;
    const experiences = Array.from({ length: Math.min(60, end) }, (_, i) => ({
      id: `m${end - i}`,
      cursor: end - i,
      seq: end - i,
      day: 1,
      source: 'observed',
      agentId: Number(p.get('agent_id')),
      content: `居民${p.get('agent_id')}的经历 ${end - i}`,
      eventIds: [end - i],
      importance: 2,
      eventType: 'wait',
    }));
    return r.fulfill({
      json: {
        experiences,
        through: Number(p.get('through')),
        nextCursor: end > 60 ? end - 59 : null,
      },
    });
  });
  await page.goto('/?experiment=experience-pages&page=experiences&agent=2');
  await expect(page.locator('.experience-row')).toHaveCount(60);
  await expect(page.locator('.agent-summary')).toContainText('第 2 天死亡');
  await page.getByRole('button', { name: '加载更早经历', exact: true }).click();
  await expect(page.locator('.experience-row')).toHaveCount(90);
  expect(requests.at(-1)!.get('before')).toBe('31');
  expect(requests.at(-1)!.get('through')).toBe(requests[0].get('through'));
  await page.getByLabel('经历查询居民').selectOption('1');
  await expect(page.locator('.experience-row')).toHaveCount(60);
  await expect(page.locator('.experience-row').first()).toContainText('居民1的经历');
  expect(requests.at(-1)!.has('before')).toBe(false);
  await page.reload();
  await expect(page.getByLabel('经历查询居民')).toHaveValue('1');
  await expect(page.locator('.experience-row')).toHaveCount(60);
});
