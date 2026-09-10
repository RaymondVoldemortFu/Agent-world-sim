import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/sim/world';

test('chronicle debounces search, freezes pages across snapshots and uses cursors', async ({
  page,
}) => {
  const world = createWorld({ population: 2 }, 'chronicle-ui');
  world.seq = 400;
  const requests: URLSearchParams[] = [];
  let snapshots = 0;
  await page.route('**/api/experiments/chronicle-ui/snapshot*', (route) => {
    snapshots++;
    world.seq++;
    return route.fulfill({
      json: { world, elapsedMs: 0, control: { state: 'paused', canResume: true }, events: [] },
    });
  });
  await page.route('**/api/experiments/chronicle-ui/events?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('q')) requests.push(params);
    const end = Number(params.get('before') ?? 361) - 1;
    const events = Array.from({ length: 120 }, (_, i) => ({
      seq: end - i,
      day: 1,
      type: 'chat',
      text: `${params.get('q') || '历史'} 对话 ${end - i}`,
      success: true,
    }));
    return route.fulfill({
      json: {
        events,
        hasMore: end > 120,
        nextCursor: end > 120 ? end - 119 : null,
        through: Number(params.get('through')),
      },
    });
  });
  await page.goto('/?experiment=chronicle-ui');
  await expect(page.locator('.event-row')).toHaveCount(120);
  requests.length = 0;
  await page.getByLabel('搜索事件').pressSequentially('合作', { delay: 30 });
  await expect(page.locator('.event-row').first()).toContainText('合作');
  expect(requests).toHaveLength(1);
  const boundary = requests[0].get('through');
  const previousSnapshots = snapshots;
  await expect.poll(() => snapshots).toBeGreaterThan(previousSnapshots);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '加载更早记录' }).click();
  await expect(page.locator('.event-row')).toHaveCount(240);
  expect(requests[1].get('before')).toBe('241');
  expect(requests[1].get('limit')).toBe('120');
  expect(requests[1].get('through')).toBe(boundary);
  await page.getByRole('button', { name: '加载更早记录' }).click();
  await expect(page.locator('.event-row')).toHaveCount(360);
  await expect(page.getByRole('button', { name: '加载更早记录' })).toBeDisabled();
  await page.getByLabel('事件类型').selectOption('chat');
  await expect(page.locator('.event-row')).toHaveCount(120);
  expect(requests.at(-1)!.has('before')).toBe(false);
  await page.getByRole('button', { name: '刷新纪事' }).click();
  await expect.poll(() => requests.length).toBe(5);
  expect(requests.at(-1)!.has('before')).toBe(false);
  await expect(page.locator('.timeline-bottom')).not.toContainText('正在检索');
});
