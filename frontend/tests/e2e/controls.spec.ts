import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/sim/world';

test('backend experiment controls reflect saving, resume errors and completion', async ({
  page,
}) => {
  const world = createWorld({ population: 2 });
  let state = 'running';
  let resumeFails = true;
  const control = () => ({ state, reason: '', canResume: state === 'paused', concurrency: 6 });
  await page.route('**/api/experiments/ui-controls/snapshot', (route) =>
    route.fulfill({ json: { world, elapsedMs: 0, events: [], control: control() } }),
  );
  await page.route('**/api/experiments/ui-controls/events?*', (route) =>
    route.fulfill({ json: { events: [], hasMore: false } }),
  );
  await page.route('**/api/experiments/ui-controls/pause', async (route) => {
    expect(route.request().method()).toBe('POST');
    state = 'stopping';
    await route.fulfill({ json: control() });
  });
  await page.route('**/api/experiments/ui-controls/resume', async (route) => {
    if (resumeFails) return route.fulfill({ status: 409, json: { detail: '实验仍在保存中' } });
    state = 'running';
    await route.fulfill({ json: control() });
  });
  await page.goto('/?experiment=ui-controls');
  await page.getByRole('button', { name: '中断实验', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  state = 'paused';
  await page.getByRole('button', { name: '继续实验', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('实验仍在保存中');
  resumeFails = false;
  await page.getByRole('button', { name: '继续实验', exact: true }).click();
  await expect(page.getByRole('button', { name: '中断实验', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/ui-experiment-controls.png', fullPage: true });
  state = 'completed';
  world.cursor.phase = 'complete';
  await expect(page.getByRole('button', { name: '继续实验', exact: true })).toBeDisabled();
});

test('starts an independent scripted backend experiment from the settings form', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始新实验', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '实验设置' });
  await dialog.getByLabel('运行模式', { exact: true }).selectOption('scripted');
  await dialog.getByLabel('地图边长', { exact: true }).fill('10');
  await dialog.getByLabel('初始居民', { exact: true }).fill('1');
  await dialog.getByLabel('实验天数', { exact: true }).fill('1');
  await dialog.getByLabel('背包容量', { exact: true }).fill('16');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/experiments') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '启动后台实验 ↗' }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const { name } = await response.json();
  await expect(page).toHaveURL(new RegExp(`experiment=${name}`));
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.run-status')).toContainText('已完成');
  await page.reload();
  await expect(page.locator('.run-status')).toContainText(name);
  await page.getByRole('button', { name: '配置', exact: true }).click();
  await expect(page.locator('main')).toContainText('10 × 10');
});
