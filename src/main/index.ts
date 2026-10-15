import { readFileSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  nativeTheme,
  session,
  shell,
  type BrowserWindowConstructorOptions
} from 'electron'
import { IPC } from '@shared/ipc'
import type { RecordingStatus } from '@shared/appTypes'
import { createLogger, getLogger } from './services/logger'
import { resolveAppPaths, type AppPaths } from './services/paths'
import { ProjectStore } from './services/projectStore'
import { ExportService } from './services/exportService'
import { NdiManager } from './services/ndiManager'
import { RecordingService } from './services/recordingService'
import { DiagnosticsService } from './services/diagnosticsService'
import { registerIpcHandlers, sendToRenderer } from './ipc'
import { buildApplicationMenu } from './menu'
import { APP_COPYRIGHT, APP_NAME, APP_VERSION } from './constants'

/**
 * CuePoint main process.
 *
 * Security posture: context isolation on, sandbox on, Node integration off, a strict
 * CSP, no remote content, all navigation denied and every IPC argument validated in
 * `registerIpcHandlers`.
 */

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let paths: AppPaths
let store: ProjectStore
let exporter: ExportService
let ndi: NdiManager
let recording: RecordingService
let diagnostics: DiagnosticsService
let quitting = false
let rendererReady = false
let dirtySuppressed = false

const windowStateFile = (): string => path.join(paths.userData, 'window-state.json')

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1440, height: 900, maximized: false }
  try {
    const raw = JSON.parse(readFileSync(windowStateFile(), 'utf8')) as Partial<WindowState>
    return {
      width: typeof raw.width === 'number' && raw.width >= 960 ? raw.width : fallback.width,
      height: typeof raw.height === 'number' && raw.height >= 640 ? raw.height : fallback.height,
      x: typeof raw.x === 'number' ? raw.x : undefined,
      y: typeof raw.y === 'number' ? raw.y : undefined,
      maximized: raw.maximized === true
    }
  } catch {
    return fallback
  }
}

function saveWindowState(window: BrowserWindow): void {
  try {
    const bounds = window.getNormalBounds()
    const payload: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized()
    }
    writeFileSync(windowStateFile(), JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    // Window state is a convenience; failure is not worth reporting.
  }
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

function applySecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })

  // CuePoint needs no web permissions; audio capture is not implemented in 1.0.0.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })

  session.defaultSession.setPermissionCheckHandler(() => false)
}

function hardenWebContents(window: BrowserWindow): void {
  const contents = window.webContents

  contents.setWindowOpenHandler(({ url }) => {
    // External links open in the default browser; nothing opens inside CuePoint.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      getLogger().warn('security', 'Blocked a navigation attempt outside the application.', url)
    }
  })

  contents.on('will-attach-webview', (event) => {
    // No webviews are used; refuse them outright.
    event.preventDefault()
  })

  contents.on('render-process-gone', (_event, details) => {
    getLogger().error('renderer', `The renderer process ended (${details.reason}).`, `exitCode=${details.exitCode}`)
    if (!quitting && details.reason !== 'clean-exit') {
      dialog.showMessageBoxSync({
        type: 'error',
        title: `${APP_NAME} — interface restarted`,
        message: 'The CuePoint interface stopped unexpectedly and has been reloaded.',
        detail:
          'Your project is still open in memory. If your most recent edits are missing, use File → Open and choose the project, then check Home → Recovery snapshots.'
      })
      window.reload()
    }
  })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const state = loadWindowState()
  const options: BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#101318',
    autoHideMenuBar: false,
    title: APP_NAME,
    // Keeps the native Windows window controls (minimise / maximise / close) while
    // letting CuePoint draw its own title bar content.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#161a20',
      symbolColor: '#c9d4e3',
      height: 38
    },
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  }
  if (typeof state.x === 'number' && typeof state.y === 'number') {
    options.x = state.x
    options.y = state.y
  }

  const window = new BrowserWindow(options)
  hardenWebContents(window)

  window.once('ready-to-show', () => {
    if (state.maximized) window.maximize()
    window.show()
  })

  window.on('resize', () => saveWindowState(window))
  window.on('move', () => saveWindowState(window))
  window.on('maximize', () => {
    saveWindowState(window)
    sendToRenderer(window, IPC.events.dirtyState, currentDirtyState())
  })
  window.on('unmaximize', () => {
    saveWindowState(window)
    sendToRenderer(window, IPC.events.dirtyState, currentDirtyState())
  })

  window.on('close', (event) => {
    if (quitting) return
    const shouldBlock = handleCloseRequest(window)
    if (shouldBlock) event.preventDefault()
  })

  window.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icon.ico'),
    path.join(app.getAppPath(), 'assets', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.ico')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate))
}

// ---------------------------------------------------------------------------
// Close / dirty handling
// ---------------------------------------------------------------------------

function currentDirtyState(): {
  dirty: boolean
  savedAt: string | null
  autosaveAt: string | null
  path: string | null
} {
  const state = store.getCurrent()
  return {
    dirty: state.dirty,
    savedAt: state.lastSavedAt,
    autosaveAt: state.autosaveAt,
    path: state.projectPath
  }
}

/** Returns true when the close should be cancelled. */
function handleCloseRequest(window: BrowserWindow): boolean {
  if (!store.isDirty() || dirtySuppressed) {
    saveWindowState(window)
    return false
  }
  const choice = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved changes',
    message: `Save changes to "${store.getProject().meta.name}" before closing?`,
    detail:
      'CuePoint keeps autosave snapshots, but they are recovery copies. Saving writes the project to its file.'
  })

  if (choice === 2) return true
  if (choice === 0) {
    try {
      if (store.getProjectPath()) {
        void store.saveCurrent('close')
      } else {
        // No path yet: ask for one, and only close once a file exists.
        const target = dialog.showOpenDialogSync(window, {
          title: 'Choose a folder to save this project in',
          defaultPath: paths.projects,
          properties: ['openDirectory', 'createDirectory', 'promptToCreate']
        })
        if (!target || target.length === 0) return true
        void store.saveAs(target[0])
      }
    } catch (error) {
      dialog.showErrorBox('CuePoint could not save the project', String(error))
      return true
    }
  }
  saveWindowState(window)
  return false
}

// ---------------------------------------------------------------------------
// Menu state
// ---------------------------------------------------------------------------

interface RendererMenuState {
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  selectionCount: number
  dirty: boolean
  hasProject: boolean
  gridVisible: boolean
  snapEnabled: boolean
  guidesVisible: boolean
  leftPanelVisible: boolean
  inspectorVisible: boolean
  isFullScreen: boolean
  recording: boolean
  ndiConnected: number
}

let menuState: RendererMenuState = {
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  selectionCount: 0,
  dirty: false,
  hasProject: false,
  gridVisible: true,
  snapEnabled: true,
  guidesVisible: true,
  leftPanelVisible: true,
  inspectorVisible: true,
  isFullScreen: false,
  recording: false,
  ndiConnected: 0
}

function refreshMenu(): void {
  Menu.setApplicationMenu(
    buildApplicationMenu({
      getWindow: () => mainWindow,
      getState: () => ({
        ...menuState,
        isFullScreen: mainWindow?.isFullScreen() ?? false,
        ndiConnected: ndi?.connectedCount ?? 0
      }),
      runCommand: (command) => runCommand(command)
    })
  )
}

/** Commands the main process can execute itself; everything else goes to the renderer. */
function runCommand(command: string): void {
  const window = mainWindow
  switch (command) {
    case 'view.fullscreen':
      if (window) window.setFullScreen(!window.isFullScreen())
      refreshMenu()
      return
    case 'app.exit':
      app.quit()
      return
    case 'ndi.disconnectAll':
      ndi?.disconnectAll()
      refreshMenu()
      return
    case 'help.openLogs':
      void shell.openPath(paths.logs)
      return
    default:
      break
  }
  if (window && rendererReady) {
    sendToRenderer(window, IPC.events.command, command)
  } else if (window) {
    // Queue the command until the renderer is listening.
    window.webContents.once('did-finish-load', () => sendToRenderer(window, IPC.events.command, command))
  }
}

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------

function bootstrap(): void {
  app.setAppUserModelId('com.sandilafernando.cuepoint')
  app.setName(APP_NAME)
  nativeTheme.themeSource = 'dark'

  paths = resolveAppPaths(app)
  const logger = createLogger({
    directory: paths.logs,
    level: 'info',
    keepFiles: 10
  })
  logger.info('app', `${APP_NAME} ${APP_VERSION} starting.`, `userData=${paths.userData}`)
  logger.info('app', APP_COPYRIGHT)

  store = new ProjectStore(paths, logger, {
    onDirtyState: (state) => {
      menuState.dirty = state.dirty
      menuState.hasProject = Boolean(state.path)
      refreshMenu()
      sendToRenderer(mainWindow, IPC.events.dirtyState, state)
    },
    onProjectSaved: (result) => {
      refreshMenu()
      logger.debug('store', `Saved ${result.screenCount} screens.`, result.path)
    },
    onWarning: (message, detail) => {
      sendToRenderer(mainWindow, IPC.events.toast, {
        id: `warn-${Date.now()}`,
        level: 'warning',
        message,
        detail,
        timeoutMs: 9_000
      })
    }
  })

  applySecurityPolicy()

  void store
    .init()
    .then(() => {
      exporter = new ExportService(paths, store, logger)
      ndi = new NdiManager(store.getSettings().ndi, path.join(__dirname, 'ndi-helper.js'), {
        onRuntime: (status) => sendToRenderer(mainWindow, IPC.events.ndiRuntime, status),
        onSources: (sources) => sendToRenderer(mainWindow, IPC.events.ndiSources, sources),
        onStats: (stats) => {
          sendToRenderer(mainWindow, IPC.events.ndiStats, stats)
          menuState.ndiConnected = ndi.connectedCount
          refreshMenu()
        }
      })
      recording = new RecordingService(paths, store, logger)
      recording.onStatusChange((status: RecordingStatus) => {
        sendToRenderer(mainWindow, IPC.events.recording, status)
        menuState.recording = status.state === 'recording' || status.state === 'paused' || status.state === 'finalizing'
        refreshMenu()
      })
      diagnostics = new DiagnosticsService({ paths, store, ndi, recording, appVersion: APP_VERSION })

      mainWindow = createWindow()
      ndi.attachWebContents(mainWindow.webContents)

      // Create the frame port as soon as the helper becomes ready, so the renderer starts
      // receiving NDI frames without needing to call `requestPort()` itself. If the helper
      // is already ready by the time the window finishes loading, `did-finish-load` will
      // trigger the same path below.
      ndi.requestFramePort()

      registerIpcHandlers({
        paths,
        store,
        exporter,
        ndi,
        recording,
        diagnostics,
        getWindow: () => mainWindow,
        setDirtySuppressed: (value) => {
          dirtySuppressed = value
        },
        setMenuState: (patch) => {
          menuState = { ...menuState, ...patch }
          refreshMenu()
        }
      })

      mainWindow.webContents.on('did-finish-load', () => {
        rendererReady = true
        sendToRenderer(mainWindow, IPC.events.dirtyState, currentDirtyState())
        if (store.getSettings().ndi.autoStartHelper) {
          const status = ndi.start()
          sendToRenderer(mainWindow, IPC.events.ndiRuntime, status)
        }
      })

      mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
        logger.error('renderer', `The interface failed to load (${code} ${description}).`, url)
      })

      refreshMenu()
      void store.cleanupTemporaryFiles()
      void logger.rotate()
    })
    .catch((error: unknown) => {
      logger.error('app', 'CuePoint failed to start.', String(error))
      dialog.showErrorBox(
        `${APP_NAME} could not start`,
        [
          'CuePoint could not initialise its application data.',
          '',
          String(error),
          '',
          `Folder: ${paths?.userData ?? 'unknown'}`
        ].join('\n')
      )
      app.quit()
    })
}

app.whenReady().then(bootstrap)

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && store) {
    mainWindow = createWindow()
    if (ndi) ndi.attachWebContents(mainWindow.webContents)
  }
})

app.on('before-quit', () => {
  quitting = true
  const logger = getLogger()
  try {
    ndi?.stop()
    void store?.close()
    logger.info('app', 'CuePoint shutting down.')
    void logger.flushNow()
  } catch {
    // Never block shutdown on logging or cleanup failures.
  }
})

process.on('uncaughtException', (error) => {
  const logger = getLogger()
  logger.error('main', 'Unhandled exception in the main process.', error.stack ?? String(error))
})

process.on('unhandledRejection', (reason) => {
  const logger = getLogger()
  logger.error('main', 'Unhandled promise rejection in the main process.', String(reason))
})
