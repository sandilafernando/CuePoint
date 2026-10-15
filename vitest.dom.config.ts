import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/** Renderer test project: React components, stores, canvas-adjacent logic (jsdom). */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    name: 'renderer',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup/renderer.ts'],
    include: ['tests/unit/renderer/**/*.test.ts', 'tests/unit/renderer/**/*.test.tsx']
  }
})
