import { existsSync } from 'node:fs'
import path from 'node:path'
import type { App } from 'electron'

export interface AppPaths {
  /** Electron userData root — user projects, settings and the library live here. */
  userData: string
  logs: string
  library: string
  projects: string
  exports: string
  recordings: string
  assets: string
  tmp: string
  crashDumps: string
  /** Read-only shipped documentation. */
  docs: string
  /** Application root (project folder in dev, app.asar root when packaged). */
  appRoot: string
  /** Resources directory (contains the unpacked native modules when packaged). */
  resources: string
}

/**
 * Central path resolution.
 *
 * Development and packaged layouts differ, so every path is derived here rather than
 * being reconstructed at each call site. User projects always live under userData,
 * which is what lets the uninstaller remove the application without touching them.
 */
export function resolveAppPaths(app: App): AppPaths {
  const userData = app.getPath('userData')
  const appRoot = app.getAppPath()
  const packaged = app.isPackaged

  const docs = packaged
    ? firstExisting([path.join(process.resourcesPath, 'docs'), path.join(appRoot, 'docs')])
    : path.join(appRoot, 'docs')

  return {
    userData,
    logs: path.join(userData, 'logs'),
    library: path.join(userData, 'library.sqlite'),
    projects: path.join(userData, 'projects'),
    exports: path.join(userData, 'exports'),
    recordings: path.join(userData, 'recordings'),
    assets: path.join(userData, 'assets'),
    tmp: path.join(userData, 'tmp'),
    crashDumps: app.getPath('crashDumps'),
    docs,
    appRoot,
    resources: packaged ? process.resourcesPath : appRoot
  }
}

function firstExisting(candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[candidates.length - 1]
}

/**
 * Resolves sql.js's WebAssembly payload.
 *
 * `require.resolve` is avoided on purpose: the main bundle is produced by Rollup and a
 * literal `require.resolve('sql.js/...')` would be rewritten at build time. Reading
 * inside app.asar works normally, so no unpacked copy is required.
 */
export function resolveSqlJsWasm(paths: AppPaths): string {
  const candidates = [
    path.join(paths.appRoot, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(paths.resources, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ]
  return firstExisting(candidates)
}

/**
 * Resolves a runtime dependency that must be unpacked from the asar archive
 * (native addons and executables cannot be loaded from inside app.asar).
 */
export function resolveUnpackedModule(paths: AppPaths, relative: string): string {
  const candidates = [
    path.join(paths.resources, 'app.asar.unpacked', 'node_modules', relative),
    path.join(paths.appRoot, 'node_modules', relative),
    path.join(process.cwd(), 'node_modules', relative)
  ]
  return firstExisting(candidates)
}
