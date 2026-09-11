import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/sim/world';
import path from 'node:path';
test('dialogue analysis runs in a worker, filters evidence and hearing relationships, and retrieves similar text', async ({
  page,
}) => {
  const world = createWorld({ population: 3 }, 'nlp-ui');
  world.seq = 500;
  const conversations = Array.from({ length: 205 }, (_, i) => ({
    seq: i + 1,
    day: Math.floor(i / 10) + 1,
    type: 'chat',
    actorId: 1,
    success: true,
    decisionId: `d${i + 1}`,
    recipients: [1, 2, 2, 3],
    text: `甲 #1 说：“我们一起分工，我负责搬运木头，你负责制作工具。”`,
  }));
  conversations.push({
    seq: 206,
    day: 22,
    type: 'shout',
    actorId: 2,
    success: true,
    decisionId: 'd206',
    recipients: [2],
    text: '乙 #2 大声说：“救命，我缺水！”',
  });
  const requests: URLSearchParams[] = [];
  let llmCalls = 0;
  await page.route('**/api/decision', (route) => {
    llmCalls++;
    return route.abort();
  });
  await page.route('**/api/experiments/nlp-ui/snapshot*', (r) =>
    r.fulfill({ json: { world, elapsedMs: 0, events: [], control: { state: 'paused' } } }),
  );
  await page.route('**/api/experiments/nlp-ui/events?*', (r) => {
    const p = new URL(r.request().url()).searchParams;
    requests.push(p);
    const all = conversations
      .filter(
        (e) =>
          e.type === p.get('event_type') &&
          e.seq <= Number(p.get('through')) &&
          (!p.has('before') || e.seq < Number(p.get('before'))),
      )
      .sort((a, b) => b.seq - a.seq);
    const rows = all.slice(0, Number(p.get('limit')));
    return r.fulfill({
      json: {
        events: rows,
        hasMore: all.length > rows.length,
        nextCursor: all.length > rows.length ? rows.at(-1)!.seq : null,
      },
    });
  });
  await page.goto('/?experiment=nlp-ui&page=dialogue');
  const panel = page.getByRole('region', { name: '对话NLP分析' });
  await expect(panel.getByRole('status')).toContainText('当前筛选 205 条');
  expect(requests.length).toBe(4);
  await expect(panel.locator('.experience-row')).toHaveCount(60);
  await panel.getByRole('button', { name: '下一页对话', exact: true }).click();
  await expect(panel.locator('.experience-row').first()).toContainText('#145');
  await panel.getByRole('button', { name: '分类依据与相似表达', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '分类依据与相似表达' });
  await expect(dialog).toContainText('分工');
  await expect(dialog).toContainText('相似度 1.00');
  await dialog.getByRole('button', { name: '×', exact: true }).click();
  await page.getByLabel('对话意图').selectOption('request');
  await expect(panel.getByRole('status')).toContainText('当前筛选 0 条');
  await expect(panel).toContainText('没有符合条件的对话');
  await page.getByLabel('仅统计有他人听见的发言').uncheck();
  await expect(panel.getByRole('status')).toContainText('当前筛选 1 条');
  await expect(panel.locator('.experience-row')).toContainText('救命');
  await page.getByLabel('对话意图').selectOption('');
  await expect(panel.getByRole('status')).toContainText('当前筛选 206 条');
  const edge = panel.locator('.nlp-matrix rect[role=button]').first();
  await expect(edge).toHaveAttribute('aria-label', /205 次/);
  await edge.click();
  await expect(panel.getByRole('status')).toContainText('当前筛选 205 条');
  expect(requests.length).toBe(4);
  expect(llmCalls).toBe(0);
  await page.getByLabel('分析起始日').fill('99');
  await page.getByLabel('分析结束日').fill('2');
  await expect(page.getByRole('alert')).toContainText('起始日不晚于结束日');
  await page.getByLabel('分析起始日').fill('');
  await page.getByLabel('分析结束日').fill('');
  await expect(panel.getByRole('status')).toContainText('当前筛选 205 条');
  await page.screenshot({ path: 'artifacts/dialogue-analysis.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('local imported dialogues use the same classifier and ignore unrelated events', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入 ↑' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('artifacts/e2e-search-fixture/run.json'));
  await expect(page.getByText('实验记录导入成功')).toBeVisible();
  await page.getByRole('button', { name: '对话分析', exact: true }).click();
  await expect(page.getByRole('region', { name: '对话NLP分析' }).getByRole('status')).toContainText(
    '已载入 2 条成功发言',
  );
  await page.getByLabel('仅统计有他人听见的发言').uncheck();
  await expect(page.locator('.experience-row')).toHaveCount(2);
  await expect(page.locator('.experience-row').first()).toContainText('合作');
});
