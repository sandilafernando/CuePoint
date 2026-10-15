import type {
  AppSettings,
  AssetImportResult,
  DiagnosticReport,
  ExportReport,
  ExportRequest,
  IpcResult,
  LogEntry,
  NdiFrameMeta,
  NdiRuntimeStatus,
  NdiSourceInfo,
  NdiSourceStats,
  NewProjectRequest,
  OpenProjectResult,
  RecentProjectEntry,
  RecordingConfig,
  RecordingEntry,
  RecordingStatus,
  RecoverySnapshot,
  SaveProjectResult
} from './appTypes'
import type { Project, ProjectSummary } from './types'
import type { MappingIssue } from './mapping'

/** Channel names. Grouped by domain so both processes stay in sync. */
export const IPC = {
  app: {
    info: 'app:info',
    settings: 'app:settings:get',
    saveSettings: 'app:settings:save',
    window: 'app:window',
    isMaximized: 'app:isMaximized',
    chooseDirectory: 'app:chooseDirectory',
    chooseFile: 'app:chooseFile',
    openExternal: 'app:openExternal',
    openPath: 'app:openPath',
    revealPath: 'app:revealPath',
    clipboardWrite: 'app:clipboard:write',
    clipboardRead: 'app:clipboard:read',
    setMenuState: 'app:menuState:set'
  },
  project: {
    create: 'project:create',
    openDialog: 'project:openDialog',
    openPath: 'project:openPath',
    current: 'project:current',
    save: 'project:save',
    saveAs: 'project:saveAs',
    apply: 'project:apply',
    validate: 'project:validate',
    recent: 'project:recent',
    forgetRecent: 'project:forgetRecent',
    pinRecent: 'project:pinRecent',
    duplicate: 'project:duplicate',
    rename: 'project:rename',
    snapshots: 'project:snapshots',
    restoreSnapshot: 'project:restoreSnapshot',
    deleteSnapshot: 'project:deleteSnapshot',
    markClean: 'project:markClean'
  },
  stage: {
    importBackground: 'stage:importBackground',
    probeAsset: 'stage:probeAsset',
    readAssetDataUrl: 'stage:readAssetDataUrl',
    clearBackground: 'stage:clearBackground'
  },
  export: {
    run: 'export:run',
    preview: 'export:preview',
    defaultDirectory: 'export:defaultDirectory'
  },
  ndi: {
    status: 'ndi:status',
    start: 'ndi:start',
    stop: 'ndi:stop',
    discover: 'ndi:discover',
    connect: 'ndi:connect',
    disconnect: 'ndi:disconnect',
    setPaused: 'ndi:setPaused',
    setPreviewFps: 'ndi:setPreviewFps',
    stats: 'ndi:stats',
    requestPort: 'ndi:requestPort',
    rendererReady: 'ndi:rendererReady'
  },
  recording: {
    status: 'recording:status',
    start: 'recording:start',
    pause: 'recording:pause',
    resume: 'recording:resume',
    stop: 'recording:stop',
    cancel: 'recording:cancel',
    begin: 'recording:begin',
    receiveChunk: 'recording:chunk',
    finalize: 'recording:finalize',
    entries: 'recording:entries',
    deleteEntry: 'recording:deleteEntry',
    verify: 'recording:verify',
    openFolder: 'recording:openFolder',
    checkEncoder: 'recording:checkEncoder',
    config: 'recording:config'
  },
  diagnostics: {
    report: 'diagnostics:report',
    logs: 'diagnostics:logs',
    clearLogs: 'diagnostics:clearLogs',
    writeReport: 'diagnostics:writeReport'
  },
  docs: {
    list: 'docs:list',
    read: 'docs:read',
    open: 'docs:open'
  },
  events: {
    /** Main -> renderer: execute a command id from the menu or an accelerator. */
    command: 'event:command',
    /** Main -> renderer: project content changed on disk or by another flow. */
    projectChanged: 'event:projectChanged',
    /** Main -> renderer: transient toast/notification. */
    toast: 'event:toast',
    /** Main -> renderer: settings changed. */
    settingsChanged: 'event:settingsChanged',
    /** Main -> renderer: NDI statistics sample. */
    ndiStats: 'event:ndiStats',
    /** Main -> renderer: NDI runtime / helper state. */
    ndiRuntime: 'event:ndiRuntime',
    /** Main -> renderer: NDI source list changed. */
    ndiSources: 'event:ndiSources',
    /** Main -> renderer: recording state changed. */
    recording: 'event:recording',
    /** Main -> renderer: unsaved-changes prompt answer. */
    dirtyState: 'event:dirtyState',
    /** Main -> renderer: request to close, after save prompt. */
    closeRequested: 'event:closeRequested'
  }
} as const

export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  packaged: boolean
  userDataPath: string
  logsPath: string
  docsPath: string
  workspacePath: string
  license: string
  author: string
  copyright: string
}

export interface ToastMessage {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  detail?: string
  /** Milliseconds; 0 keeps it until dismissed. */
  timeoutMs: number
  action?: { label: string; command: string }
}

export interface CloseRequest {
  reason: 'window-close' | 'app-quit' | 'project-open'
}

export interface DirtyState {
  dirty: boolean
  savedAt: string | null
  autosaveAt: string | null
  path: string | null
}

export interface PreviewRequest {
  kind: 'combined-map' | 'output-map' | 'screen-guide' | 'stage-layout'
  outputId?: string
  screenId?: string
  maxWidth?: number
  maxHeight?: number
}

export interface ExportPreview {
  kind: string
  width: number
  height: number
  /** PNG data URL, already downscaled for display. */
  dataUrl: string
  artifacts: { label: string; path: string }[]
  warnings: string[]
}

export interface ProjectValidationReport {
  errors: string[]
  warnings: string[]
  mappingIssues: MappingIssue[]
  summary: ProjectSummary | null
}

export interface LogQuery {
  limit?: number
  level?: 'error' | 'warn' | 'info' | 'debug'
  scope?: string
}

export interface RendererMenuState {
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  selectionCount: number
  gridVisible: boolean
  snapEnabled: boolean
  guidesVisible: boolean
  leftPanelVisible: boolean
  inspectorVisible: boolean
}

export interface DocEntry {
  id: string
  title: string
  path: string
  exists: boolean
  description: string
}

/**
 * The API exposed on `window.cuepoint` by the preload script.
 * Everything returns an `IpcResult` envelope; nothing throws across the bridge.
 */
export interface CuePointApi {
  app: {
    info(): Promise<IpcResult<AppInfo>>
    getSettings(): Promise<IpcResult<AppSettings>>
    saveSettings(settings: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
    window(action: WindowAction): Promise<IpcResult<boolean>>
    isMaximized(): Promise<IpcResult<boolean>>
    chooseDirectory(options?: { title?: string; defaultPath?: string }): Promise<IpcResult<string | null>>
    chooseFile(options?: {
      title?: string
      filters?: { name: string; extensions: string[] }[]
      defaultPath?: string
    }): Promise<IpcResult<string | null>>
    openExternal(url: string): Promise<IpcResult<boolean>>
    openPath(target: string): Promise<IpcResult<boolean>>
    revealPath(target: string): Promise<IpcResult<boolean>>
    writeClipboard(text: string): Promise<IpcResult<boolean>>
    readClipboard(): Promise<IpcResult<string>>
    /** Keeps File/Edit/View menu enablement in sync with the renderer. */
    setMenuState(state: Partial<RendererMenuState>): Promise<IpcResult<boolean>>
    onCommand(handler: (command: string) => void): () => void
    onToast(handler: (toast: ToastMessage) => void): () => void
    onSettingsChanged(handler: (settings: AppSettings) => void): () => void
    onDirtyState(handler: (state: DirtyState) => void): () => void
    onCloseRequested(handler: (request: CloseRequest) => void): () => void
  }
  project: {
    create(request: NewProjectRequest): Promise<IpcResult<OpenProjectResult>>
    openDialog(): Promise<IpcResult<OpenProjectResult | null>>
    openPath(path: string): Promise<IpcResult<OpenProjectResult>>
    /** Full project currently loaded in the application core. */
    current(): Promise<IpcResult<Project>>
    save(): Promise<IpcResult<SaveProjectResult | null>>
    saveAs(directory?: string): Promise<IpcResult<SaveProjectResult | null>>
    apply(project: Project, options?: { reason?: string }): Promise<IpcResult<{ dirty: boolean }>>
    validate(): Promise<IpcResult<ProjectValidationReport>>
    recent(): Promise<IpcResult<RecentProjectEntry[]>>
    forgetRecent(path: string): Promise<IpcResult<boolean>>
    pinRecent(path: string, pinned: boolean): Promise<IpcResult<boolean>>
    duplicate(path: string, newName?: string): Promise<IpcResult<OpenProjectResult>>
    rename(newName: string): Promise<IpcResult<Project>>
    snapshots(projectPath?: string): Promise<IpcResult<RecoverySnapshot[]>>
    restoreSnapshot(id: number): Promise<IpcResult<OpenProjectResult>>
    deleteSnapshot(id: number): Promise<IpcResult<boolean>>
    onChanged(handler: (payload: { reason: string }) => void): () => void
  }
  stage: {
    importBackground(): Promise<IpcResult<AssetImportResult | null>>
    probeAsset(path: string): Promise<IpcResult<AssetImportResult>>
    readAssetDataUrl(path: string): Promise<IpcResult<string>>
    clearBackground(deleteFile: boolean): Promise<IpcResult<boolean>>
  }
  export: {
    run(request: ExportRequest): Promise<IpcResult<ExportReport>>
    preview(request: PreviewRequest): Promise<IpcResult<ExportPreview>>
    defaultDirectory(): Promise<IpcResult<string>>
  }
  ndi: {
    status(): Promise<IpcResult<NdiRuntimeStatus>>
    start(): Promise<IpcResult<NdiRuntimeStatus>>
    stop(): Promise<IpcResult<NdiRuntimeStatus>>
    discover(timeoutMs?: number): Promise<IpcResult<NdiSourceInfo[]>>
    connect(source: { id: string; name: string; urlAddress: string; groups: string }): Promise<IpcResult<NdiSourceStats>>
    disconnect(sourceId: string): Promise<IpcResult<boolean>>
    setPaused(sourceId: string, paused: boolean): Promise<IpcResult<boolean>>
    setPreviewFps(fps: number): Promise<IpcResult<boolean>>
    stats(): Promise<IpcResult<NdiSourceStats[]>>
    /** Asks the main process to create the frame port for this renderer. */
    requestPort(): Promise<IpcResult<boolean>>
    /**
     * Receives the raw MessagePort used to transport frames.
     * Reading frames in the renderer avoids an extra copy of every pixel buffer.
     */
    attachFramePort(callback: (port: unknown) => void): () => void
    /** Fallback that lets the preload read the port and forward decoded frames. */
    onFrames(handler: (meta: NdiFrameMeta, buffer: ArrayBuffer) => void): () => void
    /** Sends renderer-side measurements back to the supervisor (diagnostics only). */
    reportRenderStats(sourceId: string, renderedFps: number, frameAgeMs: number): void
    onStats(handler: (stats: NdiSourceStats[]) => void): () => void
    onRuntime(handler: (status: NdiRuntimeStatus) => void): () => void
    onSources(handler: (sources: NdiSourceInfo[]) => void): () => void
  }
  recording: {
    status(): Promise<IpcResult<RecordingStatus>>
    start(config: Partial<RecordingConfig>): Promise<IpcResult<RecordingStatus>>
    pause(): Promise<IpcResult<RecordingStatus>>
    resume(): Promise<IpcResult<RecordingStatus>>
    stop(): Promise<IpcResult<RecordingStatus>>
    cancel(): Promise<IpcResult<RecordingStatus>>
    /** Creates the file for a session before chunks are streamed into it. */
    begin(payload: {
      mimeType: string
      container: 'webm' | 'mp4'
      width: number
      height: number
      fps: number
      label: string
    }): Promise<IpcResult<{ sessionId: string; filePath: string }>>
    /** Streams an encoded chunk to disk. */
    push(sessionId: string, chunk: ArrayBuffer): Promise<IpcResult<{ bytes: number }>>
    /** Finalises the file and runs verification. */
    finish(sessionId: string, payload: { durationMs: number; framesCaptured: number; framesDropped: number }): Promise<IpcResult<RecordingEntry>>
    abort(sessionId: string, reason: string): Promise<IpcResult<boolean>>
    entries(): Promise<IpcResult<RecordingEntry[]>>
    deleteEntry(id: string, deleteFile: boolean): Promise<IpcResult<boolean>>
    verify(id: string): Promise<IpcResult<RecordingEntry>>
    openFolder(): Promise<IpcResult<boolean>>
    checkEncoder(): Promise<IpcResult<RecordingStatus['encoder']>>
    config(): Promise<IpcResult<RecordingConfig>>
    onStatus(handler: (status: RecordingStatus) => void): () => void
  }
  diagnostics: {
    report(): Promise<IpcResult<DiagnosticReport>>
    logs(query?: LogQuery): Promise<IpcResult<LogEntry[]>>
    clearLogs(): Promise<IpcResult<boolean>>
    writeReport(): Promise<IpcResult<string>>
  }
  docs: {
    list(): Promise<IpcResult<DocEntry[]>>
    read(id: string): Promise<IpcResult<string>>
    open(id: string): Promise<IpcResult<boolean>>
  }
}
