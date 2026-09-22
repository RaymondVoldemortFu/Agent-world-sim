import { test, expect } from '@playwright/test';

test('continuous scene controls, committed replay and agent history', async ({ page, request }) => {
  const created = await request.post('/continuous-api/runs', {
    data: { mode: 'scripted', config: { scenario: 'elmwick' } },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto(`/?page=continuous&run=${id}`);
    await expect(page.getByText('游戏 1 天 = 现实 2 分钟')).toBeVisible();
    await expect(page.locator('.cv-canvas > canvas')).toBeVisible();
    await expect(page.locator('.cv-roster button')).toHaveCount(5);
    await expect(page.locator('.game-canvas')).toHaveAttribute(
      'data-world-version',
      'continuous-game-2',
    );
    await page.getByRole('button', { name: '跟随居民', exact: true }).click();
    await expect(page.getByRole('button', { name: '跟随居民', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '剖开屋顶', exact: true }).click();
    await expect(page.getByRole('button', { name: '剖开屋顶', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '剖开屋顶', exact: true }).click();
    await page.getByRole('button', { name: '全景', exact: true }).click();
    await expect(page.locator('.cv-person h2')).toContainText('艾琳');
    await page.getByRole('button', { name: 'Ⅱ 暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '▶ 继续', exact: true })).toBeEnabled();
    const before = (await (await request.get(`/continuous-api/runs/${id}`)).json()).world.time;
    // Exercise another operation while frozen, rather than waiting on a timer.
    await page.getByRole('button', { name: '村庄现场', exact: true }).click();
    await page.getByRole('button', { name: '关闭庄园门', exact: true }).click();
    await expect(page.getByRole('button', { name: '打开庄园门', exact: true })).toBeEnabled();
    const after = (await (await request.get(`/continuous-api/runs/${id}`)).json()).world.time;
    expect(after).toBe(before);
    await page.getByRole('button', { name: '居民与决策', exact: true }).click();
    await page.locator('.cv-roster button').nth(1).click();
    await expect(page.locator('.cv-person h2')).toContainText('罗兰');
    await page.getByRole('button', { name: '展开观察者干预', exact: true }).click();
    await page.getByLabel('干预目标').selectOption('plaza');
    await page.getByRole('button', { name: '切换行走目标', exact: true }).click();
    await expect(page.getByLabel('决策历史')).toContainText('前往 plaza');
    const selectedTime = Math.floor(Math.min(before / 2, 1200000) / 1000) * 1000;
    await page.getByLabel('回放时间').fill(String(selectedTime));
    await expect(page.getByLabel('回放时间')).toHaveValue(String(selectedTime));
    await page.getByText('历史回放', { exact: true }).waitFor();
    await expect(page.getByLabel('回放时间')).toHaveValue(String(selectedTime));
    await page.getByLabel('回放时间').fill('0');
    await expect(page.locator('.cv-toolbar')).toContainText('第 1 天 00:00');
    await expect(page.getByText('历史回放', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '切换行走目标', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '回到现场', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换行走目标', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '收起观察者干预', exact: true }).click();
    await page.screenshot({ path: 'artifacts/continuous-world-ui.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await request.post(`/continuous-api/runs/${id}/control`, { data: { paused: true } });
  }
});

test('shared launcher, persisted configuration, dialogue analysis and archive navigation', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let id = '';
  try {
    await page.goto('/?page=config');
    await page.getByRole('button', { name: '开始新实验', exact: true }).click();
    await page.getByLabel('执行模式', { exact: true }).selectOption('continuous');
    await page.getByLabel('运行模式', { exact: true }).selectOption('scripted');
    await page.getByLabel('实验场景').selectOption('elmwick');
    await page.getByLabel('实验天数', { exact: true }).fill('7');
    await page.getByLabel('背包容量（kg）', { exact: true }).fill('9');
    await page.getByLabel('上下文窗口（token）', { exact: true }).fill('64000');
    await page.getByLabel('连续模式并发上限', { exact: true }).fill('2');
    await page.getByLabel('规划请求上限', { exact: true }).fill('12');
    await page.getByRole('button', { name: '启动后台实验 ↗', exact: true }).click();
    await expect(page).toHaveURL(/engine=continuous&run=continuous-/);
    id = new URL(page.url()).searchParams.get('run')!;
    await expect(page.locator('.cv-canvas > canvas')).toBeVisible();
    const plan = await request.post(`/continuous-api/runs/${id}/plan`, {
      data: {
        actor: 1,
        plan: {
          intent: '提醒邻居清点存粮',
          speech: { mode: 'shout', text: '小心断粮！请核对家庭储备，清点账目。' },
        },
      },
    });
    expect(plan.ok()).toBe(true);
    await expect
      .poll(async () => {
        const response = await request.get(`/continuous-api/runs/${id}/dialogue`);
        const body = await response.json();
        return body.events.some(
          (e: { type: string; text: string }) =>
            e.type === 'speech' && e.text.includes('核对家庭储备'),
        );
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Ⅱ 暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '▶ 继续', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '配置', exact: true }).click();
    const config = page.getByRole('region', { name: '连续世界配置' });
    await expect(config).toContainText('64,000 tokens');
    await expect(config).toContainText('9 kg');
    await expect(config).toContainText('7天');
    await page.reload();
    await expect(config).toContainText('12次');
    const w = (await (await request.get(`/continuous-api/runs/${id}`)).json()).world;
    expect(w.settings).toMatchObject({
      days: 7,
      maxCalls: 12,
      concurrency: 2,
      contextWindow: 64000,
      inventoryCapacity: 9,
    });
    expect(w.agents.every((a: { capacity: number }) => a.capacity === 9)).toBe(true);
    await page.getByRole('button', { name: '统计数据', exact: true }).click();
    await expect(page.getByRole('heading', { name: '连续村庄统计' })).toBeVisible();
    await page.getByRole('button', { name: '对话分析', exact: true }).click();
    const panel = page.getByRole('region', { name: '对话NLP分析' });
    await expect(panel.getByRole('status')).toContainText('已载入');
    await page.getByLabel('仅统计有他人听见的发言').uncheck();
    await page.getByLabel('对话意图').selectOption('accounting');
    await expect(panel.locator('.experience-row')).toContainText('核对家庭储备');
    await expect(panel.locator('.experience-row')).toContainText('喊话');
    await page.screenshot({ path: 'artifacts/continuous-dialogue-ui.png', fullPage: true });
    await panel.getByRole('button', { name: '回放发言现场' }).click();
    await expect(page.getByText('历史回放', { exact: true })).toBeVisible();
    await expect(page.locator('.cv-canvas > canvas')).toBeVisible();
    await page.getByRole('button', { name: '回到现场', exact: true }).click();
    await page.getByRole('button', { name: '实验档案 ↗', exact: true }).click();
    const archive = page.getByRole('dialog', { name: '实验档案' });
    await expect(archive.getByRole('button').filter({ hasText: id })).toBeVisible();
    await archive.getByRole('button').filter({ hasText: id }).click();
    await expect(page.locator('.cv-canvas > canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: '▶ 继续', exact: true })).toBeEnabled();
    await page.screenshot({ path: 'artifacts/continuous-integrated-ui.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    if (id) await request.post(`/continuous-api/runs/${id}/control`, { data: { paused: true } });
  }
});

test('manor scene exposes 32 residents, dedicated royal grain, fiscal statistics and ledgers', async ({
  page,
  request,
}) => {
  const response = await request.post('/continuous-api/runs', {
    data: { mode: 'scripted', config: { scenario: 'manor', days: 2, maxCalls: 0 } },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto(`/?engine=continuous&run=${id}`);
    await expect(page.locator('.cv-map-heading h1')).toHaveText('鸦溪领地');
    await expect(page.locator('.cv-roster button')).toHaveCount(32);
    await expect(page.locator('.cv-canvas > canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Ⅱ 暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '▶ 继续', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '统计数据', exact: true }).click();
    await expect(page.getByText('领地财政 · 引擎准确账目')).toBeVisible();
    await expect(page.getByText('王税粮仓：', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '铭文', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ledger-32 · 持有人 #32' })).toBeVisible();
    await page.getByRole('button', { name: '世界', exact: true }).click();
    await page.locator('.cv-roster button').filter({ hasText: '财政官西蒙' }).click();
    await expect(page.locator('.cv-person h2')).toContainText('西蒙');
    await page.getByRole('button', { name: '全景', exact: true }).click();
    await page.screenshot({ path: 'artifacts/continuous-manor.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await request.post(`/continuous-api/runs/${id}/control`, { data: { paused: true } });
  }
});

test('continuous personal experiences and newspaper are reachable with archive data', async ({
  page,
  request,
}) => {
  const created = await request.post('/continuous-api/runs', {
    data: { mode: 'scripted', config: { scenario: 'elmwick', days: 2, maxCalls: 0 } },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  try {
    await request.post(`/continuous-api/runs/${id}/plan`, {
      data: {
        actor: 1,
        plan: {
          intent: '核对家庭储粮后前往广场',
          task: { kind: 'navigate', target: 'plaza', amount: 1 },
        },
      },
    });
    await request.post(`/continuous-api/runs/${id}/control`, { data: { paused: true } });
    await page.goto(`/?engine=continuous&run=${id}`);
    await page.getByRole('button', { name: 'Agent 经历', exact: true }).click();
    const experiences = page.getByRole('region', { name: 'Agent经历查询' });
    await expect(experiences).toBeVisible();
    await expect(experiences).toContainText('核对家庭储粮后前往广场');
    await page.getByLabel('经历关键词').fill('完全不存在的关键词');
    await expect(experiences).toContainText('暂无符合条件的经历');
    await page.getByLabel('经历关键词').fill('核对家庭');
    await expect(experiences).toContainText('核对家庭储粮后前往广场');
    await experiences.getByRole('button', { name: '回到此刻', exact: true }).first().click();
    await expect(page.getByText('历史回放', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '回到现场', exact: true }).click();
    await page.getByRole('button', { name: '当日新闻', exact: true }).click();
    const news = page.getByRole('region', { name: '当日新闻' });
    await expect(news).toBeVisible();
    await expect(news.getByRole('button', { name: '开启新闻流', exact: true })).toBeEnabled();
    await expect(news).toContainText('等待第一个日末结算');
    await news.getByRole('button', { name: '开启新闻流', exact: true }).click();
    await expect(news.getByRole('button', { name: '暂停自动续写', exact: true })).toBeVisible();
    await news.getByRole('button', { name: '暂停自动续写', exact: true }).click();
    await expect(news.getByRole('button', { name: '开启新闻流', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: '当日新闻' })).toBeVisible();
    await page.screenshot({ path: 'artifacts/continuous-news-page.png', fullPage: true });
  } finally {
    await request.post(`/continuous-api/runs/${id}/news`, { data: { enabled: false } });
    await request.post(`/continuous-api/runs/${id}/control`, { data: { paused: true } });
  }
});
