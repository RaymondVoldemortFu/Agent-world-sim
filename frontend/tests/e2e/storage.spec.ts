import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

test('MySQL archive supports event replay, current return, time statistics and compressed import', async ({
  page,
  request,
}) => {
  const source = 'mysql-storage-smoke';
  if ((await request.get(`/api/experiments/${source}/snapshot`)).status() === 404) {
    execFileSync(process.execPath, [
      '--import',
      'tsx',
      'scripts/simulate.ts',
      '--mode',
      'scripted',
      '--days',
      '2',
      '--population',
      '4',
      '--out',
      `artifacts/${source}`,
    ]);
  }
  const snapshot = await (
    await request.get(`/api/experiments/${source}/snapshot?include_events=false`)
  ).json();
  expect(snapshot.storage).toBe('mysql-delta-v1');
  await page.goto(`/?experiment=${source}`);
  const slider = page.getByRole('slider', { name: '历史事件序号' });
  await expect(slider).toBeEnabled();
  const replay = page.waitForResponse((r) => r.url().includes('/replay?seq=10'));
  await slider.fill('10');
  expect((await (await replay).json()).world.seq).toBe(10);
  await expect(slider).toHaveValue('10');
  await page.getByRole('button', { name: '返回当前', exact: true }).click();
  await expect(slider).toHaveValue(String(snapshot.world.seq));
  await expect(page).toHaveURL(new RegExp(`experiment=${source}`));
  await page.goto(`/?experiment=${source}&page=statistics`);
  await expect(page.getByRole('region', { name: '个体行动时间统计' })).toContainText('分配分钟');
  await expect(
    page.getByRole('region', { name: '个体行动时间统计' }).locator('tbody tr').first(),
  ).toBeVisible();
  const exported = await request.get(`/api/experiments/${source}/download`);
  expect(exported.headers()['content-disposition']).toContain('-delta.json.gz');
  await page.goto(`/?experiment=${source}`);
  await page.locator('input[type=file]').setInputFiles({
    name: 'world-delta.json.gz',
    mimeType: 'application/gzip',
    buffer: await exported.body(),
  });
  await expect(page).toHaveURL(/experiment=import-/, { timeout: 30000 });
  await expect(slider).toBeEnabled();
});
