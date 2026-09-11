import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/sim/world';
import { MANOR_CONFIG } from '../../src/manor/world';

test('daily news renders safely, pages earlier days and controls persistent generation', async ({
  page,
}) => {
  const name = 'news-ui';
  const world = createWorld(MANOR_CONFIG, name);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/config', (r) =>
    r.fulfill({ json: { configured: true, model: 'test', contextWindow: 100000 } }),
  );
  await page.route(`**/api/experiments/${name}/snapshot*`, (r) =>
    r.fulfill({
      json: {
        world,
        events: [],
        elapsedMs: 0,
        control: { state: 'paused', canResume: true, concurrency: 6, reason: '' },
      },
    }),
  );
  let enabled = false;
  const controls: boolean[] = [];
  await page.route(`**/api/experiments/${name}/news**`, (r) => {
    if (r.request().method() === 'POST') {
      enabled = r.request().postDataJSON().enabled;
      controls.push(enabled);
      return r.fulfill({ json: { enabled } });
    }
    const earlier = new URL(r.request().url()).searchParams.get('before') === '12';
    return r.fulfill({
      json: {
        enabled,
        status: 'idle',
        completedDays: 12,
        generatedDays: 12,
        calls: 12,
        usage: { prompt_tokens: 10000, completion_tokens: 2000, prompt_cache_hit_tokens: 8000 },
        nextBefore: earlier ? null : 12,
        rows: [
          {
            day: earlier ? 2 : 12,
            boundary: 120,
            mode: 'direct',
            epochStart: 1,
            counts: { alive: 30, dead: 1, away: 0, critical: 2, dialogues: 8, stores: 9 },
            article: earlier
              ? '早期新闻：粮食充裕。'
              : '仓储吃紧，村民要求核对账目\n\n领主粮仓剩余3kg。村长表示将于明日交粮（E117），目前尚无实物交付证据。\n<script>这是原文，不执行</script>',
          },
        ],
      },
    });
  });
  await page.goto(`/?experiment=${name}&page=news`);
  const region = page.getByRole('region', { name: '当日新闻' });
  await expect(region.locator('.news-article')).toContainText('仓储吃紧');
  await expect(region).toContainText('80.0%');
  await expect(region.locator('script')).toHaveCount(0);
  await region.getByRole('button', { name: '继续自动续写' }).click();
  await expect(region.getByRole('button', { name: '暂停自动续写' })).toBeEnabled();
  await region.getByRole('button', { name: '暂停自动续写' }).click();
  await expect(region.getByRole('button', { name: '继续自动续写' })).toBeEnabled();
  expect(controls).toEqual([true, false]);
  await region.getByRole('button', { name: '更早十期' }).click();
  await expect(region.locator('.news-article')).toContainText('早期新闻');
  await expect(region.getByRole('button', { name: '更早十期' })).toBeDisabled();
  await region.getByRole('button', { name: '最新一期' }).click();
  await expect(region.locator('.news-article')).toContainText('仓储吃紧');
  await page.screenshot({ path: 'artifacts/news-page-ui.png', fullPage: true });
  expect(errors).toEqual([]);
});
