/**
 * E2E tests: nudge detection on window scroll, inner container, and virtual feeds.
 *
 * These run against local fixture HTML served for real site origins, so the
 * content scripts inject exactly as in production.
 */
import { test, expect } from './fixtures/extension.js';
import { serveFixture } from './fixtures/serve.js';

/**
 * Set the scroll threshold so tests fire within a reasonable time.
 * The minimum threshold floor in the detector is 20s; scrolling a few hundred
 * px per tick accumulates that in about 20–30s of wall time.
 * @param {import('@playwright/test').BrowserContext} extension
 * @param {import('@playwright/test').Worker} background
 */
async function setMinThreshold(background) {
  await background.evaluate(() => {
    chrome.storage.local.set({
      settings: {
        schemaVersion: 1,
        enabled: true,
        scrollThresholdSeconds: 20,
        snoozeMinutes: 1,
        cooldownSeconds: 10,
        breakSeconds: 5,
        maxInterruptionsPerHour: 50,
        minSecondsBetweenInterruptions: 1,
        strictMode: false,
        adaptiveThreshold: false,
        scheduleEnabled: false,
        sites: { twitter: true, reddit: true, youtube: true, instagram: true }
      }
    });
  });
}

/**
 * Keep scrolling until the overlay is visible or the timeout is hit.
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<void>} signal  — repeated real activity on the page
 */
async function scrollUntilNudge(page, signal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await page.locator('#mindful-scroll-overlay').count()) return;
    await signal();
    await page.waitForTimeout(200);
  }
  throw new Error('Overlay never appeared within 60s');
}

test.describe('detection', () => {
  test('window scroll fires a nudge on Twitter/X', async ({ extension, background, page }) => {
    serveFixture(extension, 'https://x.com/**', 'window-scroll.html');
    await setMinThreshold(background);

    await page.goto('https://x.com/home');
    await page.waitForSelector('.feed');
    await scrollUntilNudge(page, () => page.mouse.wheel(0, 2000));

    const overlay = page.locator('#mindful-scroll-overlay');
    await expect(overlay).toBeVisible();
  });

  test('inner container scroll fires a nudge on Reddit', async ({
    extension,
    background,
    page
  }) => {
    serveFixture(extension, 'https://www.reddit.com/**', 'inner-scroll.html');
    await setMinThreshold(background);

    await page.goto('https://www.reddit.com/r/test');
    await page.waitForSelector('#main');
    await scrollUntilNudge(page, () =>
      page.evaluate(() => {
        const main = document.querySelector('#main');
        if (main) main.scrollTop += 500;
      })
    );

    const overlay = page.locator('#mindful-scroll-overlay');
    await expect(overlay).toBeVisible();
  });

  test('virtual feed arrow advances fire a nudge on YouTube Shorts', async ({
    extension,
    background,
    page
  }) => {
    serveFixture(extension, 'https://youtube.com/**', 'virtual-feed.html');
    await setMinThreshold(background);

    await page.goto('https://youtube.com/shorts/abc');
    await page.waitForSelector('#shorts');
    await scrollUntilNudge(page, () => page.keyboard.press('ArrowDown'));

    const overlay = page.locator('#mindful-scroll-overlay');
    await expect(overlay).toBeVisible();
  });

  test('cooldown persists across a page reload', async ({ extension, background, page }) => {
    serveFixture(extension, 'https://x.com/**', 'window-scroll.html');
    await setMinThreshold(background);

    // Fire a nudge, dismiss with Continue, then reload — the cooldown must hold.
    await page.goto('https://x.com/home');
    await page.waitForSelector('.feed');
    await scrollUntilNudge(page, () => page.mouse.wheel(0, 2000));

    const overlay = page.locator('#mindful-scroll-overlay');
    await overlay.waitFor({ state: 'visible' });
    // Click "Continue" inside the shadow root.
    await page.evaluate(() => {
      const host = document.querySelector('#mindful-scroll-overlay');
      const shadow = host && host.shadowRoot;
      const buttons = shadow && shadow.querySelectorAll('button');
      // Find the Continue button (not "Take a break", not "Remind me later").
      if (buttons) {
        for (const button of buttons) {
          if (button.textContent === 'Continue') button.click();
        }
      }
    });
    await expect(overlay).toBeHidden();

    // Reload — the cooldown written to storage.session must survive.
    await page.reload();
    await page.waitForSelector('.feed');
    await page.waitForTimeout(2000); // a moment without scrolling

    // Continue scrolling past the original threshold: cooldown holds, no nudge yet.
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(15_000);
    await expect(page.locator('#mindful-scroll-overlay')).toHaveCount(0);
  });
});
