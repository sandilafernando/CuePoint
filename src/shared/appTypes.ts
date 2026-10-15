import type { LengthUnit, Screen } from './types'

/** Every IPC call returns this discriminated result: renderer never sees a raw throw. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError }

export interface IpcError {
  code: IpcErrorCode
  message: string
  /** Safe, operator-facing next step. */
  hint?: string
  /** Technical detail, shown only in Diagnostics. */
  detail?: string
}

export type IpcErrorCode =
  | 'E_INVALID_INPUT'
  | 'E_NOT_FOUND'
  | 'E_PERMISSION'
  | 'E_DISK_FULL'
  | 'E_IO'
  | 'E_DB'
  | 'E_NDI_UNAVAILABLE'
  | 'E_NDI_HELPER'
  | 'E_RECORDING'
  | 'E_ENCODER'
  | 'E_UNSUPPORTED'
  | 'E_INTERNAL'

// ---------------------------------------------------------------------------
// Application settings
// ---------------------------------------------------------------------------

export type ThemeMode = 'dark' | 'light' | 'system'

export interface GridSettings {
  visible: boolean
  spacingMm: number
  majorEvery: number
  subdivisions: number
  snapToGrid: boolean
  snapToScreens: boolean
  snapToStage: boolean
  tolerancePx: number
  guidesVisible: boolean
  rulersVisible: boolean
}

export interface NdiSettings {
  /** Preview frames forwarded to the UI per second (reception is never throttled). */
  previewFps: number
  /** Requested output colour format for received frames. */
  colorFormat: 'rgba' | 'bgra' | 'uyvy'
  /** Start the native helper as soon as the app launches. */
  autoStartHelper: boolean
  discoveryTimeoutMs: number
  /**
   * 'native'     — request native resolution continuously (NDI receive bandwidth enum 1).
   * 'throughput' — favour maximum frame rate; measured to reduce resolution to half
   *                (NDI receive bandwidth enum 0). See docs/TESTING.md.
   */
  bandwidth: 'native' | 'throughput'
  /** Reconnect automatically when a source disappears. */
  autoReconnect: boolean
  /** Frames buffered per source before the oldest are discarded. */
  frameQueueLimit: number
  /** Optional explicit path to Processing.NDI.Lib.x64.dll. */
  dllPathOverride: string | null
}

export type RecordingContainer = 'webm' | 'mp4'
export type RecordingTarget = 'stage' | 'screen' | 'ndi'

export interface RecordingConfig {
  target: RecordingTarget
  /** Target screen when `target === 'screen'`. */
  screenId: string | null
  /** Target NDI source when `target === 'ndi'`. */
  ndiSourceId: string | null
  width: number
  height: number
  fps: number
  container: RecordingContainer
  /** Video bitrate in megabits per second. */
  bitrateMbps: number
  /** Capture the combined rendered stage (true) or the raw screen output. */
  captureAudio: boolean
  outputDirectory: string | null
  fileNameTemplate: string
  /** Transcode the WebM capture to MP4 with FFmpeg after finalisation. */
  transcodeToMp4: boolean
}

export interface ExportSettings {
  directory: string | null
  mapScalePercent: number
  includeGrid: boolean
  includeLabels: boolean
  includeBorders: boolean
  csvDelimiter: ',' | ';' | '\t'
  jsonIndent: number
  /** Also write per-screen guide PNGs. */
  perScreenGuides: boolean
  /** Also write the physical stage layout PNG. */
  stageLayout: boolean
}

export interface PerformanceSettings {
  maxPreviewSources: number
  frameQueueLimit: number
  verboseDiagnostics: boolean
  /** Timed (ms) quantisation of received frame ages shown in NDI Studio. */
  statsWindowMs: number
}

export interface AdvancedSettings {
  logLevel: 'error' | 'warn' | 'info' | 'debug'
  keepLogFiles: number
}

export interface AppSettings {
  schemaVersion: number
  theme: ThemeMode
  accent: string
  reduceMotion: boolean
  defaultUnit: LengthUnit
  autosaveEnabled: boolean
  autosaveIntervalMs: number
  backupRetention: number
  projectDirectory: string | null
  recentProjectLimit: number
  grid: GridSettings
  ndi: NdiSettings
  recording: RecordingConfig
  export: ExportSettings
  performance: PerformanceSettings
  advanced: AdvancedSettings
  /** actionId -> accelerator override. */
  shortcuts: Record<string, string>
}

// ---------------------------------------------------------------------------
// NDI
// ---------------------------------------------------------------------------

export interface NdiSourceInfo {
  id: string
  /** NDI source name, e.g. "STUDIO-PC (Program)". */
  name: string
  /** NDI URL address (IP:port) when published by the runtime. */
  urlAddress: string
  groups: string
  discoveredAt: string
}

export interface NdiRuntimeStatus {
  available: boolean
  dllPath: string | null
  runtimeVersion: string | null
  /** Human readable reason when `available` is false. */
  reason: string | null
  helperRunning: boolean
  helperPid: number | null
  helperStartedAt: string | null
  lastError: string | null
  restartCount: number
}

export interface NdiSourceStats {
  sourceId: string
  name: string
  connected: boolean
  paused: boolean
  width: number
  height: number
  frameRateNumerator: number
  frameRateDenominator: number
  fourCC: number
  /** Measured received frames per second over the rolling window. */
  receivedFps: number
  /** Measured frames drawn by the UI per second. */
  renderedFps: number
  /** Age of the most recent frame when it reached the renderer, in ms. */
  frameAgeMs: number
  /** Average frame age over the rolling window. */
  averageFrameAgeMs: number
  receivedFrames: number
  droppedFrames: number
  /** Frames the helper produced but did not forward (throttled or queue overflow). */
  skippedFrames: number
  reconnects: number
  lastFrameAt: string | null
  error: string | null
}

export interface NdiFrameMeta {
  sourceId: string
  width: number
  height: number
  /** Stride of the delivered buffer, in bytes. */
  lineStrideInBytes: number
  /** Milliseconds between the helper receiving the frame and the renderer drawing it. */
  frameAgeMs: number
  sequence: number
  capturedAt: number
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export type RecordingState = 'idle' | 'arming' | 'recording' | 'paused' | 'finalizing' | 'complete' | 'failed'

export interface RecordingVerification {
  checked: boolean
  decodable: boolean
  container: string | null
  videoCodec: string | null
  durationSeconds: number | null
  frameCount: number | null
  width: number | null
  height: number | null
  detail: string
}

export interface RecordingEntry {
  id: string
  filePath: string
  target: RecordingTarget
  label: string
  width: number
  height: number
  fps: number
  container: RecordingContainer
  startedAt: string
  finishedAt: string | null
  durationMs: number
  sizeBytes: number
  state: RecordingState
  error: string | null
  verified: RecordingVerification | null
}

export interface RecordingStatus {
  state: RecordingState
  entry: RecordingEntry | null
  encoder: {
    name: string
    available: boolean
    /** FFmpeg availability is checked on demand; null when never checked. */
    ffmpegPath: string | null
    detail: string
  }
  /** Frames submitted by the renderer for this session. */
  framesCaptured: number
  /** Frames the renderer wanted to send but could not (back-pressure). */
  framesDropped: number
  elapsedMs: number
  estimatedBytes: number
  outputDirectory: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type ExportKind =
  | 'combined-map'
  | 'output-map'
  | 'screen-guide'
  | 'stage-layout'
  | 'csv'
  | 'json'

export interface ExportArtifact {
  kind: ExportKind
  label: string
  path: string
  bytes: number
  width?: number
  height?: number
}

export interface ExportRequest {
  projectPath: string
  directory: string | null
  kinds: ExportKind[]
  /** Restrict per-output/per-screen artifacts to these ids (empty = all). */
  outputIds?: string[]
  screenIds?: string[]
  options?: Partial<ExportSettings>
}

export interface ExportReport {
  directory: string
  artifacts: ExportArtifact[]
  totalBytes: number
  startedAt: string
  finishedAt: string
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface DiagnosticReport {
  generatedAt: string
  app: { name: string; version: string; packaged: boolean; locale: string }
  runtime: {
    electron: string
    chrome: string
    node: string
    v8: string
    os: string
    arch: string
  }
  hardware: {
    cpuModel: string
    cpuCount: number
    totalMemoryMb: number
    freeMemoryMb: number
    appMemoryMb: number
  }
  paths: {
    userData: string
    logs: string
    libraryDatabase: string
    projectDirectory: string | null
    exportDirectory: string | null
    recordingDirectory: string | null
  }
  database: {
    libraryPath: string
    libraryBytes: number
    librarySchema: number
    projectPath: string | null
    projectBytes: number | null
    projectSchema: number | null
    recentProjects: number
  }
  storage: {
    exportDrive: string | null
    exportFreeBytes: number | null
    recordingDrive: string | null
    recordingFreeBytes: number | null
  }
  ndi: NdiRuntimeStatus
  ndiSources: NdiSourceStats[]
  recording: {
    state: RecordingState
    lastFile: string | null
    lastVerified: RecordingVerification | null
    encoderAvailable: boolean
    encoderDetail: string
  }
  project: {
    path: string | null
    screens: number
    outputs: number
    validationErrors: string[]
    mappingIssues: { error: number; warning: number; info: number }
  }
  logs: { recentWarnings: string[]; recentErrors: string[] }
}

export interface LogEntry {
  ts: string
  level: 'error' | 'warn' | 'info' | 'debug'
  scope: string
  message: string
  detail?: string
}

// ---------------------------------------------------------------------------
// Project file / library
// ---------------------------------------------------------------------------

export interface OpenProjectResult {
  path: string
  directory: string
  migrations: string[]
  missingAssets: string[]
  backupPath: string | null
}

export interface SaveProjectResult {
  path: string
  bytes: number
  savedAt: string
  backupPath: string | null
  screenCount: number
}

export interface RecentProjectEntry {
  path: string
  name: string
  openedAt: string
  pinned: boolean
  exists: boolean
}

export interface RecoverySnapshot {
  id: number
  path: string
  projectPath: string
  name: string
  createdAt: string
  reason: 'autosave' | 'manual' | 'pre-restore'
  bytes: number
  screenCount: number
}

export interface NewProjectRequest {
  name: string
  author: string
  directory: string
  stageWidthMm: number
  stageHeightMm: number
  defaultUnit: LengthUnit
  backgroundAssetPath: string | null
  initialScreenCount: number
  outputs: { name: string; width: number; height: number }[]
}

/** Renderer-safe project snapshot (no functions, no cyclic references). */
export interface ProjectSnapshot {
  path: string | null
  project: import('./types').Project
  dirty: boolean
  lastSavedAt: string | null
  autosaveAt: string | null
  selections: string[]
}

export interface AssetImportResult {
  path: string
  width: number
  height: number
  bytes: number
  format: string
  copiedTo: string | null
  warning: string | null
}

export type { Screen }
