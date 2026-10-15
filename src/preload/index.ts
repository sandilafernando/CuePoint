import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type CuePointApi, type PreviewRequest, type RendererMenuState } from '@shared/ipc'
import type {
  AppSettings,
  ExportRequest,
  LogEntry,
  NdiFrameMeta,
  NewProjectRequest,
  RecordingConfig
} from '@shared/appTypes'

/**
 * CuePoint preload.
 *
 * Runs sandboxed with context isolation, so the renderer never sees `ipcRenderer` — only
 * the functions below. Every call returns the `IpcResult` envelope produced by the main
 * process, and every subscription returns its own unsubscribe function so React effects
 * can clean up without leaking listeners.
 */

type Unsubscribe = () => void

/** Minimal shape of a transferred MessagePort; keeps DOM types out of the preload program. */
export interface FramePort {
  onmessage: ((event: { data: FramePortMessage }) => void) | null
  onmessageerror?: ((event: unknown) => void) | null
  start(): void
  close(): void
  postMessage(message: unknown): void
}

export interface FramePortMessage {
  kind: string
  meta: NdiFrameMeta
  buffer: ArrayBuffer
}

const framePortWaiters: ((port: FramePort) => void)[] = []
let pendingFramePort: FramePort | null = null

ipcRenderer.on('ndi:framePort', (event: IpcRendererEvent) => {
  const port = (event.ports as unknown as FramePort[] | undefined)?.[0]
  if (!port) return
  const waiter = framePortWaiters.shift()
  if (waiter) waiter(port)
  else pendingFramePort = port
})

/** Hands the port to whoever asks for it first, buffering it if nobody is listening yet. */
function takeFramePort(callback: (port: FramePort) => void): void {
  if (pendingFramePort) {
    const port = pendingFramePort
    pendingFramePort = null
    callback(port)
    return
  }
  framePortWaiters.push(callback)
}

function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

let activeFramePort: FramePort | null = null

const api: CuePointApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.app.info),
    getSettings: () => ipcRenderer.invoke(IPC.app.settings),
    saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke(IPC.app.saveSettings, settings),
    window: (action) => ipcRenderer.invoke(IPC.app.window, action),
    isMaximized: () => ipcRenderer.invoke(IPC.app.isMaximized),
    chooseDirectory: (options) => ipcRenderer.invoke(IPC.app.chooseDirectory, options),
    chooseFile: (options) => ipcRenderer.invoke(IPC.app.chooseFile, options),
    openExternal: (url) => ipcRenderer.invoke(IPC.app.openExternal, url),
    openPath: (target) => ipcRenderer.invoke(IPC.app.openPath, target),
    revealPath: (target) => ipcRenderer.invoke(IPC.app.revealPath, target),
    writeClipboard: (text) => ipcRenderer.invoke(IPC.app.clipboardWrite, text),
    readClipboard: () => ipcRenderer.invoke(IPC.app.clipboardRead),
    setMenuState: (state: Partial<RendererMenuState>) => ipcRenderer.invoke(IPC.app.setMenuState, state),
    onCommand: (handler) => subscribe<string>(IPC.events.command, handler),
    onToast: (handler) => subscribe(IPC.events.toast, handler),
    onSettingsChanged: (handler) => subscribe(IPC.events.settingsChanged, handler),
    onDirtyState: (handler) => subscribe(IPC.events.dirtyState, handler),
    onCloseRequested: (handler) => subscribe(IPC.events.closeRequested, handler)
  },
  project: {
    create: (request: NewProjectRequest) => ipcRenderer.invoke(IPC.project.create, request),
    openDialog: () => ipcRenderer.invoke(IPC.project.openDialog),
    openPath: (projectPath) => ipcRenderer.invoke(IPC.project.openPath, projectPath),
    current: () => ipcRenderer.invoke(IPC.project.current),
    save: () => ipcRenderer.invoke(IPC.project.save),
    saveAs: (directory) => ipcRenderer.invoke(IPC.project.saveAs, directory),
    apply: (project, options) => ipcRenderer.invoke(IPC.project.apply, { project, reason: options?.reason }),
    validate: () => ipcRenderer.invoke(IPC.project.validate),
    recent: () => ipcRenderer.invoke(IPC.project.recent),
    forgetRecent: (projectPath) => ipcRenderer.invoke(IPC.project.forgetRecent, projectPath),
    pinRecent: (projectPath, pinned) => ipcRenderer.invoke(IPC.project.pinRecent, { path: projectPath, pinned }),
    duplicate: (projectPath, newName) => ipcRenderer.invoke(IPC.project.duplicate, { path: projectPath, newName }),
    rename: (newName) => ipcRenderer.invoke(IPC.project.rename, newName),
    snapshots: (projectPath) => ipcRenderer.invoke(IPC.project.snapshots, projectPath),
    restoreSnapshot: (id) => ipcRenderer.invoke(IPC.project.restoreSnapshot, id),
    deleteSnapshot: (id) => ipcRenderer.invoke(IPC.project.deleteSnapshot, id),
    onChanged: (handler) => subscribe(IPC.events.projectChanged, handler)
  },
  stage: {
    importBackground: () => ipcRenderer.invoke(IPC.stage.importBackground),
    probeAsset: (assetPath) => ipcRenderer.invoke(IPC.stage.probeAsset, assetPath),
    readAssetDataUrl: (assetPath) => ipcRenderer.invoke(IPC.stage.readAssetDataUrl, assetPath),
    clearBackground: (deleteFile) => ipcRenderer.invoke(IPC.stage.clearBackground, deleteFile)
  },
  export: {
    run: (request: ExportRequest) => ipcRenderer.invoke(IPC.export.run, request),
    preview: (request: PreviewRequest) => ipcRenderer.invoke(IPC.export.preview, request),
    defaultDirectory: () => ipcRenderer.invoke(IPC.export.defaultDirectory)
  },
  ndi: {
    status: () => ipcRenderer.invoke(IPC.ndi.status),
    start: () => ipcRenderer.invoke(IPC.ndi.start),
    stop: () => ipcRenderer.invoke(IPC.ndi.stop),
    discover: (timeoutMs) => ipcRenderer.invoke(IPC.ndi.discover, timeoutMs),
    connect: (source) => ipcRenderer.invoke(IPC.ndi.connect, source),
    disconnect: (sourceId) => ipcRenderer.invoke(IPC.ndi.disconnect, sourceId),
    setPaused: (sourceId, paused) => ipcRenderer.invoke(IPC.ndi.setPaused, { sourceId, paused }),
    setPreviewFps: (fps) => ipcRenderer.invoke(IPC.ndi.setPreviewFps, fps),
    stats: () => ipcRenderer.invoke(IPC.ndi.stats),
    requestPort: () => ipcRenderer.invoke(IPC.ndi.requestPort),
    /**
     * Hands the raw MessagePort to the renderer. Reading frames in the renderer avoids a
     * second copy of every pixel buffer through the bridge.
     */
    attachFramePort: (callback: (port: unknown) => void): Unsubscribe => {
      let active = true
      takeFramePort((port) => {
        if (!active) {
          try {
            port.close()
          } catch {
            // Port already gone.
          }
          return
        }
        activeFramePort = port
        callback(port)
      })
      return () => {
        active = false
      }
    },
    /** Fallback used when the renderer cannot use a raw port. */
    onFrames: (handler: (meta: NdiFrameMeta, buffer: ArrayBuffer) => void): Unsubscribe => {
      let active = true
      takeFramePort((port) => {
        if (!active) return
        activeFramePort = port
        port.onmessage = (event: { data: FramePortMessage }) => {
          if (event.data?.kind === 'frame') handler(event.data.meta, event.data.buffer)
        }
        port.start()
      })
      return () => {
        active = false
      }
    },
    reportRenderStats: (sourceId: string, renderedFps: number, frameAgeMs: number): void => {
      const port = activeFramePort
      if (!port) return
      try {
        port.postMessage({ kind: 'renderStats', sourceId, renderedFps, frameAgeMs })
      } catch {
        // The port may have been replaced; metrics are best effort.
      }
    },
    onStats: (handler) => subscribe(IPC.events.ndiStats, handler),
    onRuntime: (handler) => subscribe(IPC.events.ndiRuntime, handler),
    onSources: (handler) => subscribe(IPC.events.ndiSources, handler)
  },
  recording: {
    status: () => ipcRenderer.invoke(IPC.recording.status),
    start: (config: Partial<RecordingConfig>) => ipcRenderer.invoke(IPC.recording.start, config),
    pause: () => ipcRenderer.invoke(IPC.recording.pause),
    resume: () => ipcRenderer.invoke(IPC.recording.resume),
    stop: () => ipcRenderer.invoke(IPC.recording.stop),
    cancel: () => ipcRenderer.invoke(IPC.recording.cancel),
    begin: (payload) => ipcRenderer.invoke(IPC.recording.begin, payload),
    push: (sessionId: string, chunk: ArrayBuffer) =>
      ipcRenderer.invoke(IPC.recording.receiveChunk, sessionId, chunk),
    finish: (sessionId: string, payload) => ipcRenderer.invoke(IPC.recording.finalize, sessionId, payload),
    abort: (sessionId: string, reason: string) => ipcRenderer.invoke(IPC.recording.cancel, sessionId, reason),
    entries: () => ipcRenderer.invoke(IPC.recording.entries),
    deleteEntry: (id: string, deleteFile: boolean) =>
      ipcRenderer.invoke(IPC.recording.deleteEntry, { id, deleteFile }),
    verify: (id: string) => ipcRenderer.invoke(IPC.recording.verify, id),
    openFolder: () => ipcRenderer.invoke(IPC.recording.openFolder),
    checkEncoder: () => ipcRenderer.invoke(IPC.recording.checkEncoder),
    config: () => ipcRenderer.invoke(IPC.recording.config),
    onStatus: (handler) => subscribe(IPC.events.recording, handler)
  },
  diagnostics: {
    report: () => ipcRenderer.invoke(IPC.diagnostics.report),
    logs: (query?: { limit?: number; level?: LogEntry['level']; scope?: string }) =>
      ipcRenderer.invoke(IPC.diagnostics.logs, query),
    clearLogs: () => ipcRenderer.invoke(IPC.diagnostics.clearLogs),
    writeReport: () => ipcRenderer.invoke(IPC.diagnostics.writeReport)
  },
  docs: {
    list: () => ipcRenderer.invoke(IPC.docs.list),
    read: (id: string) => ipcRenderer.invoke(IPC.docs.read, id),
    open: (id: string) => ipcRenderer.invoke(IPC.docs.open, id)
  }
}

contextBridge.exposeInMainWorld('cuepoint', api)
