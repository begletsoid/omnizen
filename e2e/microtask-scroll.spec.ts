import { test, expect } from '@playwright/test';

/**
 * Bug F regression: completing the bottom-most micro-task in a long,
 * scrolled-down list must NOT make the page jump. The completed task
 * floats to the top of the list (off-screen); without the scroll-pin the
 * browser scrolls the page up to chase it.
 *
 * Runs in the app's `#e2e-many` hash mode: MicroTasksWidget rendered
 * standalone with 40 seeded tasks, no auth / no network.
 */
test('completing the bottom task keeps the page scroll position', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto('/#e2e-many');

  const rows = page.locator('[data-task-id]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(15);

  // The app sets overflow-x:hidden on html/body, so the real vertical
  // scroller is <body> (overflow-y computes to auto), not the window.
  // Resolve it the same way the fix does, and use it for scroll + reads.
  const readScroll = () =>
    page.evaluate(() => {
      const b = document.body;
      const scroller =
        b.scrollHeight > b.clientHeight + 1
          ? b
          : (document.scrollingElement as HTMLElement) ?? document.documentElement;
      return scroller.scrollTop;
    });

  // Scroll to the very bottom so the top of the list is off-screen.
  await page.evaluate(() => {
    const b = document.body;
    const scroller =
      b.scrollHeight > b.clientHeight + 1
        ? b
        : (document.scrollingElement as HTMLElement) ?? document.documentElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(150);
  const beforeScroll = await readScroll();
  expect(beforeScroll).toBeGreaterThan(50); // we actually scrolled down

  // Identify and complete the bottom-most task.
  const lastRow = rows.nth(count - 1);
  const lastTaskId = await lastRow.getAttribute('data-task-id');
  // The done checkbox is the first <button> inside the row.
  await lastRow.locator('button').first().click();

  // The completed task floats to the top of the list — wait for the
  // reorder to land before measuring scroll.
  await expect(async () => {
    const firstId = await rows.first().getAttribute('data-task-id');
    expect(firstId).toBe(lastTaskId);
  }).toPass({ timeout: 5_000 });

  // Let the scroll-pin settle.
  await page.waitForTimeout(400);
  const afterScroll = await readScroll();

  // The page must not have jumped.
  expect(Math.abs(afterScroll - beforeScroll)).toBeLessThan(8);
});
