/**
 * Serve local fixture HTML for real site origins, so the extension's content
 * scripts inject exactly as they do in production.
 *
 * A route handler pattern maps a hostname to a fixture file:
 *
 *   serveFixture(context, 'https://x.com/*', 'window-scroll.html')
 *
 * All other requests on that origin fall through to the network (404s are
 * fine — the fixture page is what matters).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)));

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} urlPattern  e.g. 'https://x.com/**'
 * @param {string} fixture     Filename in tests/e2e/fixtures/
 */
export function serveFixture(context, urlPattern, fixture) {
  const html = readFileSync(join(fixturesDir, fixture), 'utf8');
  context.route(urlPattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: html
    })
  );
}
