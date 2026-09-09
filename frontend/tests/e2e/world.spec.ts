import { test, expect } from '@playwright/test';
import path from 'node:path';
test('configuration page shows the current world rules on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  await page.getByRole('button', { name: '配置', exact: true }).click();
  const config = page.getByRole('region', { name: '世界配置' });
  await expect(config).toBeVisible();
  const setting = (label: string) =>
    config.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) });
  await expect(setting('地图尺寸')).toContainText('15 × 15');
  await expect(setting('先知')).toContainText('1 人');
  await expect(setting('未改造平原食物上限')).toContainText('4 份 / 格');
  await expect(setting('平原采集恢复等待')).toContainText('5 天');
  await expect(setting('采后保鲜期')).toContainText('4 天');
  await expect(setting('成功交配受孕率')).toContainText('100%');
  await expect(setting('妊娠期')).toContainText('5 天');
  await expect(setting('腐败食物影响')).toContainText('饱食度 +20');
  await expect(setting('携带容量')).toContainText('15 单位');
  await expect(setting('每日行动点')).toContainText('5 AP');
  await expect(setting('丢弃物品')).toContainText('销毁背包物品，0 AP');
  await expect(setting('放置物品')).toContainText('1 AP，可被捡起');
  await expect(setting('观察方式')).toContainText('每次决策自动更新，0 AP');
  await expect(setting('大声说话')).toContainText('2 AP，2 格内可听见');
  await expect(setting('孤单条长度')).toContainText('40–100');
  await expect(setting('抑郁状态')).toContainText('每日额外扣 10 血');
  await expect(setting('全力观察')).toContainText('2 AP，3 格内');
  await expect(setting('尸体')).toContainText('死亡后保留在原地');
  await page.screenshot({ path: 'artifacts/ui-config.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ui-config-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '世界', exact: true }).click();
  await expect(page.getByLabel('世界地图，可拖动、缩放和选择地块')).toBeVisible();
});
for (const source of ['local', 'archive']) {
  test(`chronicle searches early conversations across full ${source} history`, async ({ page }) => {
    await page.goto(source === 'archive' ? '/?experiment=e2e-search-fixture' : '/');
    if (source === 'local') {
      await page.getByRole('button', { name: '导入 ↑' }).click();
      await page
        .locator('input[type=file]')
        .setInputFiles(path.resolve('artifacts/e2e-search-fixture/run.json'));
      await expect(page.getByText('实验记录导入成功')).toBeVisible();
    }
    const rows = page.locator('.event-row');
    await expect(rows).toHaveCount(120);
    await expect(rows.filter({ hasText: '一起合作' })).toHaveCount(0);
    await page.getByRole('button', { name: '加载更早记录' }).click();
    await expect(rows).toHaveCount(195);
    await expect(rows.first()).toContainText('#195');
    await expect(page.getByRole('button', { name: '加载更早记录' })).toBeDisabled();
    await page.getByLabel('事件类型').selectOption('chat');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('#2');
    await rows.first().click();
    await expect(page.getByRole('dialog', { name: '决策记录' })).toBeVisible();
    await page.getByRole('dialog', { name: '决策记录' }).getByRole('button', { name: '×' }).click();
    await page.getByLabel('搜索事件').fill('不存在的内容');
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('没有匹配的事件，试试其他关键词或类型。')).toBeVisible();
    await page.getByLabel('搜索事件').fill(' 合作 ');
    await expect(rows).toHaveCount(2);
    await page.getByLabel('事件类型').selectOption('');
    await page.getByLabel('搜索事件').fill(' 对话 ');
    await expect(rows).toHaveCount(2);
    await page.getByLabel('搜索事件').fill('abc');
    await expect(rows).toHaveCount(2);
    if (source === 'local') {
      await page.getByLabel('历史事件序号').fill('1');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('#1');
      await page.getByRole('button', { name: '返回当前' }).click();
      await expect(rows).toHaveCount(2);
    }
    await page.getByLabel('搜索事件').fill('');
    await expect(rows).toHaveCount(120);
  });
}
test('create, inspect, persist, replay, export and import a recorded run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('观察秩序，如何生长')).toBeVisible();
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  await expect(page.getByLabel('世界地图，可拖动、缩放和选择地块')).toBeVisible();
  await expect(page.locator('.agent-list button')).toHaveCount(20);
  await page.locator('.agent-list button').first().click();
  await expect(page.getByText('性格倾向', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ui-world.png', fullPage: true });
  await page.reload();
  await expect(page.getByText('已恢复上次提交的世界')).toBeVisible();
  await page.getByRole('button', { name: '导入 ↑' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('artifacts/e2e-fixture/run.json'));
  await expect(page.getByText('实验记录导入成功')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.event-row').first()).toBeVisible();
  await page.locator('.event-row').filter({ hasText: '采集' }).first().click();
  await expect(page.getByRole('dialog', { name: '决策记录' })).toBeVisible();
  await page.getByRole('dialog', { name: '决策记录' }).getByRole('button', { name: '×' }).click();
  await page.getByLabel('历史事件序号').fill('0');
  await expect(page.getByText('历史回放', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回当前' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出记录 ↓' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.screenshot({ path: 'artifacts/ui-history.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('mobile viewport has usable map and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/ui-mobile.png', fullPage: true });
});

test('a committed Worker decision survives refresh exactly once', async ({ page, context }) => {
  let calls = 0;
  await context.route('**/api/decision', async (route) => {
    calls++;
    await route.fulfill({
      json: {
        content: JSON.stringify({ intent: '观察周围', action: { type: 'wait' } }),
        model: 'test-fixture',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        elapsedMs: 1,
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  await page.getByRole('button', { name: '单步 ▷' }).click();
  await expect(page.locator('.event-row')).toHaveCount(1);
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.getByText('已恢复上次提交的世界')).toBeVisible();
  await expect(page.locator('.event-row')).toHaveCount(1);
  expect(calls).toBe(1);
});
test('real provider can run one browser Worker step', async ({ page }) => {
  test.skip(process.env.LIVE_MODEL_TEST !== '1', 'Opt-in metered provider smoke test');
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  await page.getByRole('button', { name: '单步 ▷' }).click();
  await expect(page.locator('.event-row')).toHaveCount(1, { timeout: 55000 });
  await expect(page.getByRole('button', { name: '▶ 开始演化' })).toBeEnabled();
});

test('budget changes persist and a paused run can continue', async ({ page, context }) => {
  await context.route('**/api/decision', (r) =>
    r.fulfill({
      json: {
        content: JSON.stringify({ intent: '休息', action: { type: 'wait' } }),
        model: 'fixture',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        elapsedMs: 1,
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  await page.getByRole('button', { name: '预算', exact: true }).click();
  await page.getByLabel('调用上限', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存预算' }).click();
  await expect(page.getByText('运行预算已更新', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '单步 ▷' }).click();
  await expect(page.locator('.event-row')).toHaveCount(2);
  await page.getByRole('button', { name: '▶ 开始演化' }).click();
  await expect(page.getByText('已达到模型调用预算')).toBeVisible();
  await page.getByRole('button', { name: '预算', exact: true }).click();
  await page.getByLabel('调用上限', { exact: true }).fill('3');
  await page.getByRole('button', { name: '保存预算' }).click();
  await page.getByRole('button', { name: '单步 ▷' }).click();
  await expect(page.locator('.event-row')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('.event-row')).toHaveCount(4);
});
test('authentication failure can be retried after fixing the provider', async ({
  page,
  context,
}) => {
  let calls = 0;
  await context.route('**/api/decision', async (r) => {
    calls++;
    if (calls === 1) await r.fulfill({ status: 401, json: { detail: 'test failure' } });
    else
      await r.fulfill({
        json: {
          content: JSON.stringify({ intent: '休息', action: { type: 'wait' } }),
          model: 'fixture',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          elapsedMs: 1,
        },
      });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  await page.getByRole('button', { name: '单步 ▷' }).click();
  await expect(page.getByText(/模型配置异常/)).toBeVisible();
  await expect(page.locator('.event-row')).toHaveCount(0);
  await page.getByRole('button', { name: '单步 ▷' }).click();
  await expect(page.locator('.event-row')).toHaveCount(1);
  expect(calls).toBe(2);
});
test('two tabs cannot advance the same world concurrently', async ({ page, context }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await context.route('**/api/decision', async (r) => {
    await gate;
    await r.fulfill({
      json: {
        content: JSON.stringify({ intent: '休息', action: { type: 'wait' } }),
        model: 'fixture',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        elapsedMs: 1,
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByText('已恢复上次提交的世界')).toBeVisible();
  await page.getByRole('button', { name: '单步 ▷' }).click();
  await expect(page.getByText(/正在决策/)).toBeVisible();
  await other.getByRole('button', { name: '单步 ▷' }).click();
  await expect(other.getByText(/另一个标签页正在运行/)).toBeVisible();
  release();
  await expect(page.locator('.event-row')).toHaveCount(1);
});
test('local experiment archive provides a read-only live view', async ({ page }) => {
  await page.goto('/?experiment=e2e-fixture');
  await expect(page.getByText(/外部实验 · e2e-fixture/)).toBeVisible();
  await expect(page.getByRole('button', { name: '▶ 开始演化' })).toBeDisabled();
  await expect(page.locator('.event-row').first()).toBeVisible();
  await page.getByRole('button', { name: '实验档案 ↗' }).click();
  await expect(page.getByRole('dialog', { name: '实验档案' })).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: '实验档案' }).getByText('e2e-fixture', { exact: true }),
  ).toBeVisible();
});

test('a complete 100-day journal imports and replays in the browser', async ({ page }) => {
  test.skip(process.env.FULL_REPLAY_TEST !== '1', 'Opt-in full baseline import');
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByRole('button', { name: '导入 ↑' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('artifacts/scripted-compact/run.json'));
  await expect(page.getByText('实验记录导入成功')).toBeVisible({ timeout: 55000 });
  await page.getByLabel('历史事件序号').fill('3250');
  await expect(page.getByText('历史回放', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回当前' })).toBeEnabled();
  await page.getByRole('button', { name: '返回当前' }).click();
  await page.getByRole('button', { name: '统计详情 ↗' }).click();
  await expect(
    page.getByRole('dialog', { name: '统计详情' }).getByText('100', { exact: true }),
  ).toBeVisible();
});

test('distant agents request concurrently but commit in ID order', async ({ page, context }) => {
  let active = 0,
    peak = 0,
    calls = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await context.route('**/api/decision', async (r) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await gate;
    await r.fulfill({
      json: {
        content: JSON.stringify({ intent: '休息', action: { type: 'wait' } }),
        model: 'fixture',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        elapsedMs: 1,
      },
    });
    active--;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  await page.getByRole('button', { name: '▶ 开始演化' }).click();
  await expect.poll(() => peak).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Ⅱ 暂停' }).click();
  release();
  await expect(page.getByText('已暂停，历史已保存')).toBeVisible();
  expect(calls).toBeGreaterThan(1);
  await expect(page.locator('.event-row')).toHaveCount(calls);
  const ids = await page.evaluate(async () => {
    const modulePath = '/src/runtime/store.ts';
    const { db } = await import(/* @vite-ignore */ modulePath);
    const run = await db.runs.orderBy('updated').last();
    const events = await db.events.where('runId').equals(run.id).toArray();
    return events.map((e: { actorId: number }) => e.actorId);
  });
  expect(ids).toEqual(Array.from({ length: calls }, (_, i) => i + 1));
});
test('a free drop retains five paid actions and reuses prefetched replies', async ({
  page,
  context,
}) => {
  const calls = new Map<string, number>();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await context.route('**/api/decision', async (route) => {
    const req = route.request().postDataJSON();
    calls.set(req.decisionId, (calls.get(req.decisionId) ?? 0) + 1);
    const firstDrop =
      req.context.self.id === 1 && req.context.round === 1 && !req.decisionId.includes(':free-');
    if (firstDrop) await gate;
    await route.fulfill({
      json: {
        content: JSON.stringify({
          action: firstDrop ? { type: 'drop', item: 'food', quantity: 1 } : { type: 'wait' },
        }),
        model: 'fixture',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        elapsedMs: 1,
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '导入 ↑' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('artifacts/free-drop-fixture.json'));
  await expect(page.getByText('实验记录导入成功')).toBeVisible();
  await page.getByRole('button', { name: '▶ 开始演化' }).click();
  await expect.poll(() => calls.size).toBe(2);
  await page.getByRole('button', { name: 'Ⅱ 暂停' }).click();
  release();
  await expect(page.getByText('已暂停，历史已保存', { exact: true })).toBeVisible();
  await expect(page.locator('.event-row')).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('已恢复上次提交的世界')).toBeVisible();
  await page.getByRole('button', { name: '▶ 开始演化' }).click();
  await expect(page.getByText('100% · 实验已完成', { exact: true })).toBeVisible();
  expect(calls.size).toBe(11);
  expect([...calls.values()].every((n) => n === 1)).toBe(true);
  await expect(page.locator('.event-row')).toHaveCount(12);
  await expect(page.locator('.event-row').filter({ hasText: '暂作等待' })).toHaveCount(10);
  await expect(page.locator('.event-row').filter({ hasText: '丢弃并销毁' })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('实验已完成', { exact: true })).toBeVisible();
  await expect(page.locator('.event-row')).toHaveCount(12);
});

test('shouts are importable, searchable and survive refresh', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入 ↑' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('artifacts/shout-fixture.json'));
  await expect(page.getByText('实验记录导入成功')).toBeVisible();
  await page.getByLabel('事件类型').selectOption('shout');
  await page.getByLabel('搜索事件').fill('两格以内的朋友');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await expect(page.locator('.event-row')).toContainText('大声说话');
  await page.getByLabel('搜索事件').fill('');
  await page.getByLabel('事件类型').selectOption('place');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await expect(page.locator('.event-row')).toContainText('在地上放置');
  await page.reload();
  await page.getByLabel('事件类型').selectOption('shout');
  await expect(page.locator('.event-row')).toContainText('一起采集吧');
  await page.locator('.agent-list button').first().click();
  const loneliness = page.locator('.meter').filter({ hasText: '孤单' });
  await expect(loneliness).toContainText('20');
  await expect(
    page.getByText('抑郁 · 每日额外扣 10 血，孤单清零后解除', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/ui-loneliness.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('corpses and survey snapshots persist through browser import and replay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入 ↑' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('artifacts/perception-fixture.json'));
  await expect(page.getByText('实验记录导入成功')).toBeVisible();
  await page.locator('.agent-list button:not(.dead)').first().click();
  await expect(page.getByText('最近全力观察', { exact: true })).toBeVisible();
  await expect(page.getByText('49 个地块 · 0 名活人 · 1 具尸体', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '地块', exact: true }).click();
  await expect(page.locator('.resident-link').filter({ hasText: '尸体' })).toHaveCount(1);
  await page.getByLabel('事件类型').selectOption('survey');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await expect(page.locator('.event-row')).toContainText('全力观察');
  await page.screenshot({ path: 'artifacts/ui-corpse-survey.png', fullPage: true });
  await page.reload();
  await page.getByLabel('历史事件序号').fill('0');
  await expect(page.locator('.agent-list button.dead')).toHaveCount(0);
  await page.getByRole('button', { name: '返回当前' }).click();
  await expect(page.locator('.agent-list button.dead')).toHaveCount(1);
});

test('the initial prophet is visible with all recipes and survives refresh', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '生成世界', exact: false }).click();
  await expect(page.getByText('新世界已生成')).toBeVisible();
  const prophet = page.locator('.agent-list button').filter({ hasText: '先知' });
  await expect(prophet).toHaveCount(1);
  await expect(page.locator('.agent-list button')).toHaveCount(20);
  await prophet.click();
  await expect(page.locator('.agent-heading')).toContainText('先知');
  await expect(page.getByText('基础工具、高级工具、棚屋', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/ui-prophet.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.agent-list button').filter({ hasText: '先知' })).toHaveCount(1);
});
