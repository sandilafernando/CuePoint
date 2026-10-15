import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * NDI runtime discovery.
 *
 * CuePoint never redistributes the NDI runtime — NewTek/Vizrt licensing places that
 * responsibility on the operator. Instead the installed runtime is located at startup
 * and loaded through FFI, which also means CuePoint works with NDI 5 and NDI 6 without
 * carrying a compile-time SDK dependency.
 *
 * Deliberately free of Electron imports so the helper process and unit tests can use it.
 */

export const NDI_X64_LIBRARY = 'Processing.NDI.Lib.x64.dll'

export interface NdiLibraryInfo {
  path: string | null
  directory: string | null
  /** Where the path came from, for diagnostics. */
  source: 'override' | 'environment' | 'path' | 'known-location' | 'scan' | 'none'
  searched: string[]
}

const KNOWN_DIRECTORIES = [
  'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6',
  'C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime',
  'C:\\Program Files (x86)\\NDI\\NDI 6 Runtime\\v6',
  'C:\\Program Files\\NewTek\\NDI 5 Runtime',
  'C:\\Program Files (x86)\\NewTek\\NDI 5 Runtime',
  'C:\\Program Files\\NewTek\\NDI 4 Runtime',
  'C:\\Program Files (x86)\\NewTek\\NDI 4 Runtime'
]

const ENVIRONMENT_VARIABLES = ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDI_RUNTIME_DIR_V4']

function candidateFrom(directory: string): string {
  return path.join(directory, NDI_X64_LIBRARY)
}

export function readNdiEnvironment(): { variable: string; value: string }[] {
  const found: { variable: string; value: string }[] = []
  for (const name of ENVIRONMENT_VARIABLES) {
    const value = process.env[name]
    if (value && value.trim()) found.push({ variable: name, value: value.trim() })
  }
  return found
}

function scanProgramFiles(searched: string[]): string | null {
  const roots = ['C:\\Program Files\\NDI', 'C:\\Program Files\\NewTek']
  for (const root of roots) {
    if (!existsSync(root)) continue
    searched.push(root)
    let entries: string[] = []
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
    } catch {
      continue
    }
    for (const entry of entries) {
      const candidates = [candidateFrom(entry), candidateFrom(path.join(entry, 'v6')), candidateFrom(path.join(entry, 'Runtime'))]
      for (const candidate of candidates) {
        searched.push(candidate)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

/**
 * Finds the x64 NDI runtime library.
 * Order: explicit override -> NDI_RUNTIME_DIR_* -> PATH -> well known install dirs -> scan.
 */
export function findNdiLibrary(override?: string | null): NdiLibraryInfo {
  const searched: string[] = []

  if (override && override.trim()) {
    const candidate = override.trim()
    searched.push(candidate)
    if (existsSync(candidate)) {
      return { path: candidate, directory: path.dirname(candidate), source: 'override', searched }
    }
  }

  for (const { value } of readNdiEnvironment()) {
    const candidate = candidateFrom(value)
    searched.push(candidate)
    if (existsSync(candidate)) {
      return { path: candidate, directory: path.dirname(candidate), source: 'environment', searched }
    }
  }

  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!entry) continue
    const candidate = candidateFrom(entry)
    searched.push(candidate)
    if (existsSync(candidate)) {
      return { path: candidate, directory: path.dirname(candidate), source: 'path', searched }
    }
  }

  for (const directory of KNOWN_DIRECTORIES) {
    const candidate = candidateFrom(directory)
    searched.push(candidate)
    if (existsSync(candidate)) {
      return { path: candidate, directory: path.dirname(candidate), source: 'known-location', searched }
    }
  }

  const scanned = scanProgramFiles(searched)
  if (scanned) {
    return { path: scanned, directory: path.dirname(scanned), source: 'scan', searched }
  }

  return { path: null, directory: null, source: 'none', searched }
}

export function describeNdiSearch(info: NdiLibraryInfo): string {
  if (info.path) return `${info.path} (found via ${info.source})`
  return [
    `Runtime not found. Checked ${info.searched.length} location(s).`,
    'Install the NDI Runtime (Tools) from https://ndi.video/tools/ and restart CuePoint.'
  ].join(' ')
}
