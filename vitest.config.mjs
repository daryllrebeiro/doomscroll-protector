import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright E2E tests run separately via `npm run test:e2e`.
    exclude: ['node_modules/**', 'tests/e2e/**']
  }
});
