/**
 * Playwright E2E configuration.
 *
 * The extension is loaded unpacked into a persistent context. Tests run against
 * local fixture HTML served for real site origins (hostnames matched by the
 * manifest), so the content scripts inject exactly as they do in production.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one extension context at a time
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // Extensions require a persistent, non-headless context on most platforms;
    // CI runs this under xvfb-run so a visible browser is available.
    headless: false,
    trace: 'on-first-retry'
  }
});
