/**
 * Debug test to check if the content script is running and the detector is initialized.
 */
import { test } from './fixtures/extension.js';
import { serveFixture } from './fixtures/serve.js';

test('debug: content script is running', async ({ extension, background, page }) => {
  // Check if the extension is loaded
  const extensions = await background.evaluate(async () => {
    const list = (await chrome.runtime.getAllExtensions?.()) || [];
    return list.map((e) => ({ id: e.id, name: e.name, enabled: e.enabled }));
  });
  console.log('Extensions:', JSON.stringify(extensions));

  // Check extension ID
  const extId = await background.evaluate(() => chrome.runtime.id);
  console.log('Extension ID:', extId);

  // Check if content script files are accessible
  const manifest = await background.evaluate(async () => {
    return await chrome.runtime.getManifest();
  });
  console.log('Manifest content_scripts:', JSON.stringify(manifest.content_scripts));

  serveFixture(extension, 'https://x.com/**', 'window-scroll.html');

  // Set settings with await
  await background.evaluate(async () => {
    await chrome.storage.local.set({
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

  // Listen for console and errors before navigation
  page.on('console', (msg) => console.log('PAGE CONSOLE:', msg.text()));
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  page.on('request', (req) => {
    if (req.url().includes('x.com')) console.log('REQUEST:', req.url());
  });

  await page.goto('https://x.com/home');
  await page.waitForSelector('.feed');

  // Check if the content script is running
  const hasMindfulScroll = await page.evaluate(() => {
    return typeof window.MindfulScroll !== 'undefined';
  });
  console.log('window.MindfulScroll defined:', hasMindfulScroll);

  // Check if the content script's init has run
  const siteInfo = await page.evaluate(() => {
    if (!window.MindfulScroll) return { error: 'MindfulScroll not defined' };
    return {
      siteId: window.MindfulScroll.siteIdForHost(location.hostname),
      hasCreateDetector: typeof window.MindfulScroll.createDetector !== 'undefined',
      hasAdapterFor: typeof window.MindfulScroll.sites?.adapterFor !== 'undefined'
    };
  });
  console.log('Site info:', JSON.stringify(siteInfo));

  // Check if the overlay host exists
  const overlayExists = await page.evaluate(() => {
    return document.querySelector('#mindful-scroll-overlay') !== null;
  });
  console.log('Overlay exists:', overlayExists);

  // Try scrolling and see what happens
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(2000);

  const overlayAfterScroll = await page.evaluate(() => {
    return document.querySelector('#mindful-scroll-overlay') !== null;
  });
  console.log('Overlay after scroll:', overlayAfterScroll);
});
