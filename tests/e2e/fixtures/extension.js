/**
 * Playwright fixture that loads the unpacked extension in a persistent context.
 *
 * MV3 extensions require a persistent context. The fixture exposes:
 *  - `extension`  — the BrowserContext with the extension loaded
 *  - `background` — the service worker page-like handle
 *  - `page`       — a fresh page in the extension context
 */
import { test as base, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const userDataDir = join(root, '.e2e-profile');

/**
 * Launch a persistent context with the extension loaded.
 * @returns {Promise<{ context: import('@playwright/test').BrowserContext, serviceWorker: import('@playwright/test').Worker }>}
 */
async function launchExtension() {
  // Start from a clean profile so a crashed previous run can't lock it.
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Profile may be locked by a lingering process; launchPersistentContext
    // will fail loudly if it truly can't be used.
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox']
  });

  let serviceWorker = null;
  for (const worker of context.serviceWorkers()) {
    if (worker.url().includes('service_worker.js')) {
      serviceWorker = worker;
      break;
    }
  }
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }

  return { context, serviceWorker };
}

export const test = base.extend({
  /** The extension's browser context. */
  // eslint-disable-next-line no-empty-pattern
  extension: async ({}, use) => {
    const { context } = await launchExtension();
    await use(context);
    await context.close();
  },

  /** The extension's service worker. */
  background: async ({ extension }, use) => {
    let worker = extension.serviceWorkers().find((w) => w.url().includes('service_worker.js'));
    if (!worker) {
      worker = await extension.waitForEvent('serviceworker', { timeout: 30_000 });
    }
    await use(worker);
  },

  /** A fresh page in the extension context. */
  page: async ({ extension }, use) => {
    const page = await extension.newPage();
    await use(page);
    await page.close();
  }
});

export { expect } from '@playwright/test';
