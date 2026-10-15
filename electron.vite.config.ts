import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * CuePoint build configuration.
 *
 * - main: Electron main process (CommonJS output; externalises runtime dependencies
 *   such as koffi, sql.js and ffmpeg-static so native/wasm assets stay loadable).
 * - preload: sandbox-compatible CommonJS preload exposing a restricted contextBridge API.
 * - renderer: React application.
 *
 * `src/main/ndi/ndiHelperMain.ts` is built as a second main-process entry so the NDI
 * helper can be launched as a standalone Node process (ELECTRON_RUN_AS_NODE).
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'ndi-helper': resolve('src/main/ndi/ndiHelperMain.ts'),
          'ndi-worker': resolve('src/main/ndi/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    }
  }
})
