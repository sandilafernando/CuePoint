import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests launch the real packaged-style Electron build through
 * Playwright's `_electron` API. Tests run serially because each one drives a
 * desktop window and shared user-data directory.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results'
})
