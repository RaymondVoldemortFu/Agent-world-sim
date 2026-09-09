import { test, expect } from '@playwright/test';
import path from 'node:path';
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
    await expect(rows).toHaveCount(150);
    await expect(rows.first()).toContainText('#150');
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
