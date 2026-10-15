import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** Node/main-process test project: shared domain logic, persistence, NDI protocol, exports. */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main')
    }
  },
  test: {
    name: 'main',
    environment: 'node',
    include: [
      'tests/unit/main/**/*.test.ts',
      'tests/unit/shared/**/*.test.ts',
      'tests/integration/**/*.test.ts'
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
