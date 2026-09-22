import { test, expect } from '@playwright/test';
import { createManorWorld } from '../../src/continuous/manor/world';

test('frozen running worlds and hidden tabs stop rendering while live worlds have a frame budget', async ({ page }) => {
  const world = createManorWorld('render-budget', 'llm');
  world.status = 'running';
  await page.addInitScript((world) => {
    const native = window.EventSource;
    (window as any).EventSource = class {
      onopen?: () => void;
      onmessage?: (e: {data: string}) => void;
      timer?: ReturnType<typeof setInterval>;
      constructor(url: string) {
        if (!url.includes('/render-budget/stream')) return new native(url) as any;
        const push = () => this.onmessage?.({data: JSON.stringify({type: 'snapshot', world})});
        setTimeout(() => { this.onopen?.(); push(); }, 20);
        this.timer = setInterval(() => {
          if (!(window as any).advanceRenderFixture) return;
          world.time += 72000;
          push();
        }, 100);
      }
      close() { clearInterval(this.timer); }
    };
  }, world);
  await page.route('**/continuous-api/runs/render-budget/events?*', route => route.fulfill({json: []}));
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?engine=continuous&run=render-budget');
  const canvas = page.locator('.game-canvas');
  await expect(canvas).toHaveAttribute('data-rendered-frames', /\d+/);
  const count = async () => Number(await canvas.getAttribute('data-rendered-frames'));
  // Let OrbitControls damping settle. status deliberately remains running throughout.
  await page.waitForTimeout(1800);
  const frozen = await count();
  await page.waitForTimeout(1000);
  expect(await count()).toBe(frozen);
  await page.evaluate(() => { (window as any).advanceRenderFixture = true; });
  const start = await count();
  await page.waitForTimeout(2000);
  const frames = await count() - start;
  expect(frames).toBeGreaterThan(0);
  expect(frames).toBeLessThanOrEqual(65);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await count();
  await page.waitForTimeout(1000);
  expect(await count()).toBe(hidden);
  await page.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(count).toBeGreaterThan(hidden);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({frozenFramesPerSecond: 0, liveFramesInTwoSeconds: frames, hiddenFramesPerSecond: 0}));
});
