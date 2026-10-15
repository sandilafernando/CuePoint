import type { AppSettings } from './appTypes'
import { LIMITS } from './validation'
import { clamp } from './units'
import { DEFAULT_SHORTCUTS } from './shortcuts'

export const SETTINGS_SCHEMA_VERSION = 1

export function createDefaultSettings(): AppSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    theme: 'dark',
    accent: '#4c8dff',
    reduceMotion: false,
    defaultUnit: 'm',
    autosaveEnabled: true,
    autosaveIntervalMs: 30_000,
    backupRetention: 10,
    projectDirectory: null,
    recentProjectLimit: 12,
    grid: {
      visible: true,
      spacingMm: 500,
      majorEvery: 4,
      subdivisions: 4,
      snapToGrid: true,
      snapToScreens: true,
      snapToStage: true,
      tolerancePx: 8,
      guidesVisible: true,
      rulersVisible: true
    },
    ndi: {
      previewFps: 30,
      colorFormat: 'rgba',
      autoStartHelper: true,
      discoveryTimeoutMs: 5_000,
      bandwidth: 'native',
      autoReconnect: true,
      frameQueueLimit: 2,
      dllPathOverride: null
    },
    recording: {
      target: 'stage',
      screenId: null,
      ndiSourceId: null,
      width: 1920,
      height: 1080,
      fps: 30,
      container: 'webm',
      bitrateMbps: 24,
      captureAudio: false,
      outputDirectory: null,
      fileNameTemplate: 'CuePoint_{project}_{target}_{date}_{time}',
      transcodeToMp4: false
    },
    export: {
      directory: null,
      mapScalePercent: 100,
      includeGrid: true,
      includeLabels: true,
      includeBorders: true,
      csvDelimiter: ',',
      jsonIndent: 2,
      perScreenGuides: true,
      stageLayout: true
    },
    performance: {
      maxPreviewSources: 4,
      frameQueueLimit: 2,
      verboseDiagnostics: false,
      statsWindowMs: 2_000
    },
    advanced: {
      logLevel: 'info',
      keepLogFiles: 10
    },
    shortcuts: { ...DEFAULT_SHORTCUTS }
  }
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback
}

function str<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * Merges persisted settings over the defaults, clamping anything out of range.
 * Never throws: a corrupt settings file degrades to defaults instead of blocking launch.
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const defaults = createDefaultSettings()
  if (!raw || typeof raw !== 'object') return defaults
  const input = raw as Partial<AppSettings>

  const shortcuts: Record<string, string> = { ...DEFAULT_SHORTCUTS }
  if (input.shortcuts && typeof input.shortcuts === 'object') {
    for (const [key, value] of Object.entries(input.shortcuts)) {
      if (typeof value === 'string' && value.trim().length > 0) shortcuts[key] = value.trim()
    }
  }

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    theme: str(input.theme, ['dark', 'light', 'system'] as const, defaults.theme),
    accent: typeof input.accent === 'string' ? input.accent : defaults.accent,
    reduceMotion: bool(input.reduceMotion, defaults.reduceMotion),
    defaultUnit: str(
      input.defaultUnit,
      ['mm', 'cm', 'm', 'in', 'ft'] as const,
      defaults.defaultUnit
    ),
    autosaveEnabled: bool(input.autosaveEnabled, defaults.autosaveEnabled),
    autosaveIntervalMs: num(
      input.autosaveIntervalMs,
      defaults.autosaveIntervalMs,
      LIMITS.minAutosaveMs,
      LIMITS.maxAutosaveMs
    ),
    backupRetention: Math.round(
      num(input.backupRetention, defaults.backupRetention, LIMITS.minBackupRetention, LIMITS.maxBackupRetention)
    ),
    projectDirectory: typeof input.projectDirectory === 'string' ? input.projectDirectory : null,
    recentProjectLimit: Math.round(num(input.recentProjectLimit, defaults.recentProjectLimit, 3, 50)),
    grid: {
      visible: bool(input.grid?.visible, defaults.grid.visible),
      spacingMm: num(input.grid?.spacingMm, defaults.grid.spacingMm, LIMITS.minGridSpacingMm, LIMITS.maxGridSpacingMm),
      majorEvery: Math.round(num(input.grid?.majorEvery, defaults.grid.majorEvery, 1, 20)),
      subdivisions: Math.round(num(input.grid?.subdivisions, defaults.grid.subdivisions, 1, 20)),
      snapToGrid: bool(input.grid?.snapToGrid, defaults.grid.snapToGrid),
      snapToScreens: bool(input.grid?.snapToScreens, defaults.grid.snapToScreens),
      snapToStage: bool(input.grid?.snapToStage, defaults.grid.snapToStage),
      tolerancePx: num(input.grid?.tolerancePx, defaults.grid.tolerancePx, LIMITS.minSnapTolerancePx, LIMITS.maxSnapTolerancePx),
      guidesVisible: bool(input.grid?.guidesVisible, defaults.grid.guidesVisible),
      rulersVisible: bool(input.grid?.rulersVisible, defaults.grid.rulersVisible)
    },
    ndi: {
      previewFps: Math.round(num(input.ndi?.previewFps, defaults.ndi.previewFps, 1, 120)),
      colorFormat: str(input.ndi?.colorFormat, ['rgba', 'bgra', 'uyvy'] as const, defaults.ndi.colorFormat),
      autoStartHelper: bool(input.ndi?.autoStartHelper, defaults.ndi.autoStartHelper),
      discoveryTimeoutMs: Math.round(num(input.ndi?.discoveryTimeoutMs, defaults.ndi.discoveryTimeoutMs, 500, 60_000)),
      bandwidth: str(input.ndi?.bandwidth, ['native', 'throughput'] as const, defaults.ndi.bandwidth),
      autoReconnect: bool(input.ndi?.autoReconnect, defaults.ndi.autoReconnect),
      frameQueueLimit: Math.round(num(input.ndi?.frameQueueLimit, defaults.ndi.frameQueueLimit, 1, 8)),
      dllPathOverride:
        typeof input.ndi?.dllPathOverride === 'string' && input.ndi.dllPathOverride.trim()
          ? input.ndi.dllPathOverride.trim()
          : null
    },
    recording: {
      target: str(input.recording?.target, ['stage', 'screen', 'ndi'] as const, defaults.recording.target),
      screenId: typeof input.recording?.screenId === 'string' ? input.recording.screenId : null,
      ndiSourceId: typeof input.recording?.ndiSourceId === 'string' ? input.recording.ndiSourceId : null,
      width: Math.round(num(input.recording?.width, defaults.recording.width, 64, 8192)),
      height: Math.round(num(input.recording?.height, defaults.recording.height, 64, 8192)),
      fps: Math.round(num(input.recording?.fps, defaults.recording.fps, 1, 120)),
      container: str(input.recording?.container, ['webm', 'mp4'] as const, defaults.recording.container),
      bitrateMbps: num(input.recording?.bitrateMbps, defaults.recording.bitrateMbps, 1, 200),
      captureAudio: bool(input.recording?.captureAudio, defaults.recording.captureAudio),
      outputDirectory:
        typeof input.recording?.outputDirectory === 'string' ? input.recording.outputDirectory : null,
      fileNameTemplate:
        typeof input.recording?.fileNameTemplate === 'string' && input.recording.fileNameTemplate.trim().length > 0
          ? input.recording.fileNameTemplate
          : defaults.recording.fileNameTemplate,
      transcodeToMp4: bool(input.recording?.transcodeToMp4, defaults.recording.transcodeToMp4)
    },
    export: {
      directory: typeof input.export?.directory === 'string' ? input.export.directory : null,
      mapScalePercent: Math.round(num(input.export?.mapScalePercent, defaults.export.mapScalePercent, 5, 400)),
      includeGrid: bool(input.export?.includeGrid, defaults.export.includeGrid),
      includeLabels: bool(input.export?.includeLabels, defaults.export.includeLabels),
      includeBorders: bool(input.export?.includeBorders, defaults.export.includeBorders),
      csvDelimiter: str(input.export?.csvDelimiter, [',', ';', '\t'] as const, defaults.export.csvDelimiter),
      jsonIndent: Math.round(num(input.export?.jsonIndent, defaults.export.jsonIndent, 0, 8)),
      perScreenGuides: bool(input.export?.perScreenGuides, defaults.export.perScreenGuides),
      stageLayout: bool(input.export?.stageLayout, defaults.export.stageLayout)
    },
    performance: {
      maxPreviewSources: Math.round(num(input.performance?.maxPreviewSources, defaults.performance.maxPreviewSources, 1, 16)),
      frameQueueLimit: Math.round(num(input.performance?.frameQueueLimit, defaults.performance.frameQueueLimit, 1, 16)),
      verboseDiagnostics: bool(input.performance?.verboseDiagnostics, defaults.performance.verboseDiagnostics),
      statsWindowMs: Math.round(num(input.performance?.statsWindowMs, defaults.performance.statsWindowMs, 250, 30_000))
    },
    advanced: {
      logLevel: str(input.advanced?.logLevel, ['error', 'warn', 'info', 'debug'] as const, defaults.advanced.logLevel),
      keepLogFiles: Math.round(num(input.advanced?.keepLogFiles, defaults.advanced.keepLogFiles, 1, 90))
    },
    shortcuts
  }
}

/** Validates a candidate autosave interval typed into Settings. */
export function validateAutosaveInterval(ms: number): string | null {
  if (!Number.isFinite(ms)) return 'Autosave interval must be a number of seconds.'
  const seconds = ms / 1000
  if (seconds < LIMITS.minAutosaveMs / 1000) return 'Autosave interval must be at least 5 seconds.'
  if (seconds > LIMITS.maxAutosaveMs / 1000) return 'Autosave interval must be 60 minutes or less.'
  return null
}
