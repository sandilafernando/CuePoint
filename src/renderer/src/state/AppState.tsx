import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type {
  AppSettings,
  DiagnosticReport,
  NdiRuntimeStatus,
  NdiSourceInfo,
  NdiSourceStats,
  NewProjectRequest,
  RecentProjectEntry,
  RecordingConfig,
  RecordingEntry,
  RecordingStatus,
  RecoverySnapshot
} from '@shared/appTypes'
import type { Project, Screen } from '@shared/types'
import type { AppInfo, ProjectValidationReport, RendererMenuState, ToastMessage } from '@shared/ipc'
import { SHORTCUT_ACTIONS } from '@shared/shortcuts'
import { createDefaultSettings } from '@shared/appSettings'
import { editorStore, type EditorAction, type EditorState, createScreenForStage } from './editor'
import { createScreen } from '@shared/project'
import { bridge, CuePointError, describeError, unwrap } from '../services/ipc'
import { frameHub } from '../features/ndi/frameHub'
import { NUDGE_MM, NUDGE_MM_FINE, NUDGE_MM_LARGE, PROJECT_SYNC_DEBOUNCE_MS } from '@shared/constants'

export type WorkspaceId =
  | 'home'
  | 'stage'
  | 'mapping'
  | 'ndi'
  | 'recording'
  | 'settings'
  | 'diagnostics'
  | 'help'

export interface Toast extends ToastMessage {
  receivedAt: number
}

interface NdiApi {
  runtime: NdiRuntimeStatus | null
  sources: NdiSourceInfo[]
  stats: NdiSourceStats[]
  discovering: boolean
  discover(): Promise<void>
  connect(source: NdiSourceInfo): Promise<void>
  disconnect(sourceId: string): Promise<void>
  setPaused(sourceId: string, paused: boolean): Promise<void>
  startHelper(): Promise<void>
  stopHelper(): Promise<void>
  refreshRuntime(): Promise<void>
}

interface RecordingApi {
  status: RecordingStatus | null
  config: RecordingConfig
  entries: RecordingEntry[]
  refresh(): Promise<void>
  updateConfig(patch: Partial<RecordingConfig>): Promise<void>
  start(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  cancel(): Promise<void>
  openFolder(): Promise<void>
  removeEntry(id: string, deleteFile: boolean): Promise<void>
  verify(id: string): Promise<void>
  reportProgress(framesCaptured: number, framesDropped: number, estimatedBytes: number): void
}

interface ProjectsApi {
  recent: RecentProjectEntry[]
  snapshots: RecoverySnapshot[]
  refreshRecent(): Promise<void>
  refreshSnapshots(): Promise<void>
  open(path?: string): Promise<void>
  create(request: NewProjectRequest): Promise<void>
  duplicate(path: string, name?: string): Promise<void>
  rename(name: string): Promise<void>
  forget(path: string): Promise<void>
  pin(path: string, pinned: boolean): Promise<void>
  reveal(path: string): Promise<void>
  restoreSnapshot(id: number): Promise<void>
  deleteSnapshot(id: number): Promise<void>
}

interface AppContextValue {
  ready: boolean
  info: AppInfo | null
  settings: AppSettings
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  resetSetting<K extends keyof AppSettings>(key: K): Promise<void>
  workspace: WorkspaceId
  goTo(workspace: WorkspaceId): void
  editor: EditorState
  dispatch(action: EditorAction): void
  saveProject(): Promise<void>
  saveProjectAs(): Promise<void>
  closeProject(): Promise<void>
  validate(showToast?: boolean): Promise<ProjectValidationReport | null>
  toasts: Toast[]
  notify(level: Toast['level'], message: string, detail?: string, timeoutMs?: number): void
  dismissToast(id: string): void
  projects: ProjectsApi
  ndi: NdiApi
  recording: RecordingApi
  command(id: string): void
  panels: { left: boolean; inspector: boolean }
  togglePanel(panel: 'left' | 'inspector', visible?: boolean): void
  modal: ModalState | null
  openModal(state: ModalState): void
  closeModal(): void
  diagnosticsReport: DiagnosticReport | null
  refreshDiagnostics(): Promise<void>
}

export type ModalState =
  | { kind: 'none' }
  | { kind: 'new-project' }
  | { kind: 'about' }
  | { kind: 'shortcuts' }
  | { kind: 'project-properties' }
  | { kind: 'recovery' }
  | { kind: 'confirm'; title: string; message: string; detail?: string; confirmLabel: string; onConfirm: () => void }

const AppContext = createContext<AppContextValue | null>(null)

let toastSeq = 0

/** Baseline settings used for resets and first paint before the main process answers. */
const DEFAULT_APP_SETTINGS = createDefaultSettings()

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside <AppProvider>.')
  return value
}

/** Subscribes a component to the editor store. */
export function useEditor(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getState, editorStore.getState)
}

function isTextTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  )
}

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const editor = useEditor()
  const [ready, setReady] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [workspace, setWorkspace] = useState<WorkspaceId>('home')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modal, setModal] = useState<ModalState | null>(null)
  const [panels, setPanels] = useState({ left: true, inspector: true })
  const [diagnosticsReport, setDiagnosticsReport] = useState<DiagnosticReport | null>(null)

  const [recent, setRecent] = useState<RecentProjectEntry[]>([])
  const [snapshots, setSnapshots] = useState<RecoverySnapshot[]>([])
  const [ndiRuntime, setNdiRuntime] = useState<NdiRuntimeStatus | null>(null)
  const [ndiSources, setNdiSources] = useState<NdiSourceInfo[]>([])
  const [ndiStats, setNdiStats] = useState<NdiSourceStats[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null)
  const [recordingConfig, setRecordingConfig] = useState<RecordingConfig>(DEFAULT_APP_SETTINGS.recording)
  const [recordingEntries, setRecordingEntries] = useState<RecordingEntry[]>([])

  const editorRef = useRef(editor)
  editorRef.current = editor
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const pendingSync = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedProject = useRef<Project | null>(null)

  // -------------------------------------------------------------------------
  // Toasts
  // -------------------------------------------------------------------------

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (level: Toast['level'], message: string, detail?: string, timeoutMs = level === 'error' ? 0 : 4200) => {
      toastSeq += 1
      const toast: Toast = {
        id: `toast-${Date.now()}-${toastSeq}`,
        level,
        message,
        detail,
        timeoutMs,
        receivedAt: Date.now()
      }
      setToasts((current) => [...current.slice(-4), toast])
    },
    []
  )

  const reportError = useCallback(
    (error: unknown, context: string) => {
      const described = describeError(error)
      notify('error', `${context}: ${described.message}`, described.detail)
      if (error instanceof CuePointError && error.detail) {
        console.error(`[cuepoint] ${context}`, error.detail)
      } else {
        console.error(`[cuepoint] ${context}`, error)
      }
    },
    [notify]
  )

  const run = useCallback(
    async <T,>(label: string, work: () => Promise<T>, silent = false): Promise<T | null> => {
      try {
        return await work()
      } catch (error) {
        if (!silent) reportError(error, label)
        return null
      }
    },
    [reportError]
  )

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [appInfo, loadedSettings] = await Promise.all([
          unwrap(bridge().app.info()),
          unwrap(bridge().app.getSettings())
        ])
        if (cancelled) return
        setInfo(appInfo)
        setSettings(loadedSettings)
        setRecordingConfig(loadedSettings.recording)
        setReady(true)
      } catch (error) {
        reportError(error, 'CuePoint could not start')
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reportError])

  // -------------------------------------------------------------------------
  // Project synchronisation
  // -------------------------------------------------------------------------

  const flushSync = useCallback(async (reason: string) => {
    const state = editorRef.current
    if (!state.project || !state.path) return
    if (lastSyncedProject.current === state.project) return
    lastSyncedProject.current = state.project
    try {
      await unwrap(bridge().project.apply(state.project, { reason }))
    } catch (error) {
      lastSyncedProject.current = null
      reportError(error, 'The in-memory project could not be synchronised with the application core')
    }
  }, [reportError])

  useEffect(() => {
    if (!editor.project) {
      lastSyncedProject.current = null
      return
    }
    if (pendingSync.current) clearTimeout(pendingSync.current)
    pendingSync.current = setTimeout(() => {
      pendingSync.current = null
      void flushSync('edit')
    }, PROJECT_SYNC_DEBOUNCE_MS)
    return () => {
      if (pendingSync.current) clearTimeout(pendingSync.current)
    }
  }, [editor.project, flushSync])

  // Best-effort flush so a very fast edit-then-quit cannot lose the last change.
  useEffect(() => {
    const handler = (): void => {
      if (pendingSync.current) {
        clearTimeout(pendingSync.current)
        pendingSync.current = null
      }
      const state = editorRef.current
      if (state.project && state.path) void bridge().project.apply(state.project, { reason: 'unload' })
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // -------------------------------------------------------------------------
  // Recent projects, snapshots, recording entries
  // -------------------------------------------------------------------------

  const refreshRecent = useCallback(async () => {
    await run('Recent projects', async () => {
      setRecent(await unwrap(bridge().project.recent()))
    }, true)
  }, [run])

  const refreshSnapshots = useCallback(async () => {
    await run('Recovery snapshots', async () => {
      setSnapshots(await unwrap(bridge().project.snapshots()))
    }, true)
  }, [run])

  const refreshRecordingEntries = useCallback(async () => {
    await run('Recording history', async () => {
      setRecordingEntries(await unwrap(bridge().recording.entries()))
    }, true)
  }, [run])

  const refreshDiagnostics = useCallback(async () => {
    await run('Diagnostics', async () => {
      setDiagnosticsReport(await unwrap(bridge().diagnostics.report()))
    })
  }, [run])

  useEffect(() => {
    if (!ready) return
    void refreshRecent()
    void refreshRecordingEntries()
    void run('NDI status', async () => {
      const status = await unwrap(bridge().ndi.status())
      setNdiRuntime(status)
      setNdiStats(await unwrap(bridge().ndi.stats()))
    }, true)
    void run('Recording status', async () => {
      setRecordingStatus(await unwrap(bridge().recording.status()))
      setRecordingConfig(await unwrap(bridge().recording.config()))
    }, true)
  }, [ready, refreshRecent, refreshRecordingEntries, run])

  // -------------------------------------------------------------------------
  // Main -> renderer subscriptions
  // -------------------------------------------------------------------------

  useEffect(() => {
    const api = bridge()
    const offs: (() => void)[] = []

    offs.push(
      api.app.onToast((toast) => {
        setToasts((current) => [...current.slice(-4), { ...toast, receivedAt: Date.now() }])
      })
    )
    offs.push(api.app.onSettingsChanged((next) => setSettings(next)))
    offs.push(api.app.onDirtyState((state) => {
      editorStore.dispatch({
        type: 'setSavedState',
        savedAt: state.savedAt,
        autosaveAt: state.autosaveAt,
        path: state.path
      })
    }))
    offs.push(api.project.onChanged(() => {
      void refreshRecent()
    }))
    offs.push(api.ndi.onRuntime((status) => setNdiRuntime(status)))
    offs.push(api.ndi.onSources((sources) => setNdiSources(sources)))
    offs.push(api.ndi.onStats((stats) => setNdiStats(stats)))
    offs.push(api.recording.onStatus((status) => setRecordingStatus(status)))
    offs.push(
      api.ndi.onFrames((meta, buffer) => {
        frameHub.push({ meta, buffer, receivedAt: performance.now() })
      })
    )
    return () => {
      for (const off of offs) off()
    }
  }, [refreshRecent])

  // -------------------------------------------------------------------------
  // Menu state
  // -------------------------------------------------------------------------

  useEffect(() => {
    const state: Partial<RendererMenuState> = {
      canUndo: editor.past.length > 0,
      canRedo: editor.future.length > 0,
      hasSelection: editor.selection.length > 0,
      selectionCount: editor.selection.length,
      gridVisible: editor.project?.stage.gridVisible ?? true,
      snapEnabled: editor.project?.stage.snapToGrid ?? true,
      guidesVisible: editor.project?.stage.guidesVisible ?? true,
      leftPanelVisible: panels.left,
      inspectorVisible: panels.inspector
    }
    void bridge().app.setMenuState(state)
  }, [editor.past.length, editor.future.length, editor.selection.length, editor.project, panels])

  // -------------------------------------------------------------------------
  // Project operations
  // -------------------------------------------------------------------------

  const loadProject = useCallback(
    async (path: string) => {
      await run('Open project', async () => {
        const result = await unwrap(bridge().project.openPath(path))
        const project = await unwrap(bridge().project.current())
        const backgroundDataUrl = project.stage.background.assetPath
          ? await unwrap(bridge().stage.readAssetDataUrl(project.stage.background.assetPath)).catch(() => null)
          : null
        editorStore.dispatch({
          type: 'load',
          project,
          path: result.path,
          backgroundDataUrl: backgroundDataUrl ?? null
        })
        setWorkspace('stage')
        await refreshRecent()
        if (result.migrations.length > 0) {
          notify('info', 'Project upgraded', result.migrations.join(' '))
        }
        if (result.missingAssets.length > 0) {
          notify(
            'warning',
            `${result.missingAssets.length} asset(s) could not be found`,
            'The stage background is referenced but missing. Use Stage Designer → Background to relink or replace it.'
          )
        }
      })
    },
    [notify, refreshRecent, run]
  )

  const createProject = useCallback(
    async (request: NewProjectRequest) => {
      await run('Create project', async () => {
        const result = await unwrap(bridge().project.create(request))
        const project = await unwrap(bridge().project.current())
        editorStore.dispatch({ type: 'load', project, path: result.path })
        setWorkspace('stage')
        await refreshRecent()
        notify('success', `Created ${project.meta.name}`, `Saved to ${result.path}`)
      })
    },
    [notify, refreshRecent, run]
  )

  const saveProject = useCallback(
    async () => {
      await run('Save project', async () => {
        await flushSync('save')
        const result = await unwrap(bridge().project.save())
        if (!result) {
          // No path yet — fall through to Save As.
          const target = await unwrap(bridge().project.saveAs())
          if (!target) return
          editorStore.dispatch({ type: 'markSaved', path: target.path, savedAt: target.savedAt })
          notify('success', 'Project saved', target.path)
          return
        }
        editorStore.dispatch({ type: 'markSaved', path: result.path, savedAt: result.savedAt })
        await refreshRecent()
        notify('success', 'Project saved', `${result.screenCount} screens · ${result.path}`)
      })
    },
    [flushSync, notify, refreshRecent, run]
  )

  const saveProjectAs = useCallback(async () => {
    await run('Save project as', async () => {
      await flushSync('save-as')
      const result = await unwrap(bridge().project.saveAs())
      if (!result) return
      editorStore.dispatch({ type: 'markSaved', path: result.path, savedAt: result.savedAt })
      await refreshRecent()
      notify('success', 'Project saved', result.path)
    })
  }, [flushSync, notify, refreshRecent, run])

  const closeProject = useCallback(async () => {
    editorStore.dispatch({ type: 'close' })
    frameHub.clear()
    setWorkspace('home')
    notify('info', 'Project closed', 'Your files remain on disk.')
  }, [notify])

  const validate = useCallback(
    async (showToast = true) => {
      const report = await run('Validate project', async () => unwrap(bridge().project.validate()))
      if (!report) return null
      if (showToast) {
        const errors = report.errors.length
        const warnings = report.warnings.length
        if (errors > 0) {
          notify('error', `Validation found ${errors} error(s)`, report.errors[0])
        } else if (warnings > 0) {
          notify('warning', `Validation passed with ${warnings} warning(s)`, report.warnings[0])
        } else {
          notify('success', 'Validation passed', 'No geometry, mapping or asset problems were found.')
        }
      }
      return report
    },
    [notify, run]
  )

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  const goTo = useCallback((next: WorkspaceId) => setWorkspace(next), [])

  const togglePanel = useCallback((panel: 'left' | 'inspector', visible?: boolean) => {
    setPanels((current) => ({ ...current, [panel]: visible ?? !current[panel] }))
  }, [])

  const addScreen = useCallback(() => {
    const state = editorRef.current
    if (!state.project) {
      notify('warning', 'No project is open', 'Create or open a project before adding screens.')
      return
    }
    const screen = createScreenForStage(state)
    editorStore.dispatch({ type: 'addScreens', screens: [screen] })
    setWorkspace('stage')
  }, [notify])

  const zoomBy = useCallback((factor: number) => {
    const view = editorRef.current.view
    editorStore.dispatch({ type: 'setView', view: { zoom: Math.min(8, Math.max(0.05, view.zoom * factor)) } })
  }, [])

  const command = useCallback(
    (id: string) => {
      const state = editorRef.current
      switch (id) {
        // File
        case 'file.new':
          setModal({ kind: 'new-project' })
          return
        case 'file.open':
          void run('Open project', async () => {
            const result = await unwrap(bridge().project.openDialog())
            if (!result) return
            await loadProject(result.path)
          })
          return
        case 'file.save':
          void saveProject()
          return
        case 'file.saveAs':
          void saveProjectAs()
          return
        case 'file.importBackground':
          setWorkspace('stage')
          void run('Import background', async () => {
            const asset = await unwrap(bridge().stage.importBackground())
            if (!asset) return
            const dataUrl = await unwrap(bridge().stage.readAssetDataUrl(asset.path))
            editorStore.dispatch({
              type: 'setBackgroundImage',
              dataUrl,
              assetPath: asset.path,
              width: asset.width,
              height: asset.height
            })
            notify('success', 'Background imported', `${asset.width} × ${asset.height} px`)
          })
          return
        case 'file.export':
          setWorkspace('mapping')
          return
        case 'file.projectProperties':
          setModal({ kind: 'project-properties' })
          return
        case 'file.revealProject':
          if (state.path) {
            void run('Reveal project folder', async () => {
              await unwrap(bridge().app.revealPath(state.path as string))
            })
          } else {
            notify('warning', 'This project has not been saved yet', 'Save the project first, then reveal its folder.')
          }
          return

        // Edit
        case 'edit.undo':
          editorStore.dispatch({ type: 'undo' })
          return
        case 'edit.redo':
          editorStore.dispatch({ type: 'redo' })
          return
        case 'edit.copy':
          if (state.selection.length) {
            editorStore.dispatch({ type: 'copy', ids: state.selection })
            void bridge().app.writeClipboard(JSON.stringify(selectedToClipboard(state)))
          }
          return
        case 'edit.cut':
          if (state.selection.length) {
            editorStore.dispatch({ type: 'cut', ids: state.selection })
            void bridge().app.writeClipboard(JSON.stringify(selectedToClipboard(state)))
          }
          return
        case 'edit.paste':
          void (async () => {
            const clipboard = await unwrap(bridge().app.readClipboard()).catch(() => '')
            const parsed = parseClipboard(clipboard)
            if (parsed) {
              const existing = new Set(state.project?.screens.map((screen) => screen.id) ?? [])
              const screens = parsed.map((screen) => {
                const copy = createScreen({
                  name: `${screen.name ?? 'Screen'} copy`,
                  widthMm: screen.widthMm ?? 2000,
                  heightMm: screen.heightMm ?? 1000,
                  pixelWidth: screen.pixelWidth,
                  pixelHeight: screen.pixelHeight,
                  xMm: (screen.xMm ?? 0) + 200,
                  yMm: (screen.yMm ?? 0) + 200
                })
                if (existing.has(copy.id)) copy.id = `${copy.id}-${Date.now().toString(36)}`
                copy.rotationDeg = screen.rotationDeg ?? 0
                return copy
              })
              editorStore.dispatch({ type: 'addScreens', screens, label: 'Paste screens' })
              return
            }
            editorStore.dispatch({ type: 'paste' })
          })()
          return
        case 'edit.duplicate':
          if (state.selection.length) editorStore.dispatch({ type: 'duplicateScreens', ids: state.selection })
          return
        case 'edit.selectAll':
          editorStore.dispatch({
            type: 'select',
            ids: state.project?.screens.filter((screen) => screen.visible).map((screen) => screen.id) ?? []
          })
          return
        case 'edit.clearSelection':
          editorStore.dispatch({ type: 'select', ids: [] })
          editorStore.dispatch({ type: 'setGuides', guides: [] })
          return
        case 'edit.delete': {
          if (!state.selection.length) return
          const locked = new Set(
            state.project?.screens.filter((screen) => screen.locked).map((screen) => screen.id) ?? []
          )
          const deletable = state.selection.filter((id) => !locked.has(id))
          if (deletable.length === 0) {
            notify('warning', 'All selected screens are locked', 'Unlock a screen before deleting it.')
            return
          }
          const names = state.project?.screens
            .filter((screen) => deletable.includes(screen.id))
            .map((screen) => screen.name)
            .join(', ')
          setModal({
            kind: 'confirm',
            title: 'Delete screens',
            message: `Delete ${deletable.length} screen(s)?`,
            detail: `${names}\n\nThis can be undone with Ctrl+Z until the project is closed.`,
            confirmLabel: 'Delete',
            onConfirm: () => {
              editorStore.dispatch({ type: 'deleteScreens', ids: deletable })
              notify('info', `Deleted ${deletable.length} screen(s)`, 'Press Ctrl+Z to restore them.')
            }
          })
          return
        }
        case 'edit.preferences':
          setWorkspace('settings')
          return

        // View
        case 'view.zoomIn':
          zoomBy(1.25)
          setWorkspace('stage')
          return
        case 'view.zoomOut':
          zoomBy(1 / 1.25)
          setWorkspace('stage')
          return
        case 'view.fitStage':
          setWorkspace('stage')
          window.dispatchEvent(new CustomEvent('cuepoint:fit-stage'))
          return
        case 'view.fitSelection':
          setWorkspace('stage')
          window.dispatchEvent(new CustomEvent('cuepoint:fit-selection'))
          return
        case 'view.resetView':
          editorStore.dispatch({ type: 'setView', view: { zoom: 1, panX: 40, panY: 40 } })
          setWorkspace('stage')
          return
        case 'view.toggleGrid':
          editorStore.dispatch({
            type: 'updateStage',
            patch: { gridVisible: !(state.project?.stage.gridVisible ?? true) }
          })
          return
        case 'view.toggleSnap': {
          const grid = state.project?.stage.snapToGrid ?? true
          editorStore.dispatch({
            type: 'updateStage',
            patch: {
              snapToGrid: !grid,
              snapToScreens: !grid,
              snapToStage: !grid
            }
          })
          notify('info', !grid ? 'Snapping enabled' : 'Snapping disabled')
          return
        }
        case 'view.toggleGuides':
          editorStore.dispatch({
            type: 'updateStage',
            patch: { guidesVisible: !(state.project?.stage.guidesVisible ?? true) }
          })
          return
        case 'view.toggleLeftPanel':
          togglePanel('left')
          return
        case 'view.toggleInspector':
          togglePanel('inspector')
          return
        case 'view.fullscreen':
          return

        // Tools
        case 'tools.home':
          setWorkspace('home')
          return
        case 'tools.stageDesigner':
          setWorkspace('stage')
          return
        case 'tools.pixelMapping':
          setWorkspace('mapping')
          return
        case 'tools.ndiStudio':
          setWorkspace('ndi')
          return
        case 'tools.recording':
          setWorkspace('recording')
          return
        case 'tools.settings':
          setWorkspace('settings')
          return
        case 'tools.diagnostics':
          setWorkspace('diagnostics')
          void refreshDiagnostics()
          return
        case 'tools.help':
          setWorkspace('help')
          return
        case 'tools.validateProject':
        case 'tools.validateMapping': {
          setWorkspace(id === 'tools.validateMapping' ? 'mapping' : 'stage')
          void validate(true)
          return
        }
        case 'project.recover':
          setModal({ kind: 'recovery' })
          void refreshSnapshots()
          return

        // Screens
        case 'screen.add':
          addScreen()
          return
        case 'screen.rename': {
          const target = state.selection[0]
          if (!target) return
          window.dispatchEvent(new CustomEvent('cuepoint:rename-screen', { detail: target }))
          return
        }
        case 'screen.lock':
          if (state.selection.length) editorStore.dispatch({ type: 'toggleLock', ids: state.selection })
          return
        case 'screen.hide':
          if (state.selection.length) editorStore.dispatch({ type: 'toggleVisible', ids: state.selection })
          return
        case 'screen.duplicate':
          if (state.selection.length) editorStore.dispatch({ type: 'duplicateScreens', ids: state.selection })
          else addScreen()
          return
        case 'screen.alignLeft':
        case 'screen.alignCenter':
        case 'screen.alignRight':
        case 'screen.alignTop':
        case 'screen.alignMiddle':
        case 'screen.alignBottom': {
          const mode = id.replace('screen.align', '').toLowerCase()
          editorStore.dispatch({ type: 'align', mode: mode as never })
          return
        }

        // NDI
        case 'ndi.refresh':
          setWorkspace('ndi')
          window.dispatchEvent(new CustomEvent('cuepoint:ndi-discover'))
          return
        case 'ndi.connect':
          window.dispatchEvent(new CustomEvent('cuepoint:ndi-connect'))
          return
        case 'ndi.disconnectAll':
          void (async () => {
            for (const stat of ndiStats) {
              await bridge().ndi.disconnect(stat.sourceId)
            }
            notify('info', 'All NDI sources disconnected')
          })()
          return

        // Recording
        case 'recording.start':
          setWorkspace('recording')
          window.dispatchEvent(new CustomEvent('cuepoint:recording-toggle'))
          return
        case 'recording.stop':
          window.dispatchEvent(new CustomEvent('cuepoint:recording-stop'))
          return
        case 'recording.openFolder':
          void run('Open output folder', async () => {
            await unwrap(bridge().recording.openFolder())
          })
          return

        // Help
        case 'help.manual':
          setWorkspace('help')
          window.dispatchEvent(new CustomEvent('cuepoint:help-doc', { detail: 'user-manual' }))
          return
        case 'help.shortcuts':
          setModal({ kind: 'shortcuts' })
          return
        case 'help.troubleshooting':
          setWorkspace('help')
          window.dispatchEvent(new CustomEvent('cuepoint:help-doc', { detail: 'troubleshooting' }))
          return
        case 'help.copyDiagnostics':
          void run('Copy diagnostic report', async () => {
            const report = await unwrap(bridge().diagnostics.report())
            const text = JSON.stringify(report, null, 2)
            await unwrap(bridge().app.writeClipboard(text))
            notify('success', 'Diagnostic report copied', 'Paste it into a support message.')
          })
          return
        case 'help.openLogs':
          void run('Open logs folder', async () => {
            if (!info) return
            await unwrap(bridge().app.openPath(info.logsPath))
          })
          return
        case 'help.about':
          setModal({ kind: 'about' })
          return
        default:
          return
      }
    },
    [
      addScreen,
      info,
      loadProject,
      ndiStats,
      notify,
      refreshDiagnostics,
      refreshSnapshots,
      run,
      saveProject,
      saveProjectAs,
      togglePanel,
      validate,
      zoomBy
    ]
  )

  useEffect(() => {
    const off = bridge().app.onCommand((id) => command(id))
    return off
  }, [command])

  // -------------------------------------------------------------------------
  // Renderer-owned keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handlers = new Map<string, string>()
    for (const action of SHORTCUT_ACTIONS) {
      if (action.owner !== 'renderer') continue
      const accelerator = settings.shortcuts[action.id] ?? action.default
      if (accelerator) handlers.set(accelerator, action.id)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null

      // Canvas nudge, only while the stage workspace is active and not editing text.
      if (
        workspace === 'stage' &&
        !isTextTarget(target) &&
        editorRef.current.selection.length > 0 &&
        event.key.startsWith('Arrow')
      ) {
        const step = event.altKey ? NUDGE_MM_FINE : event.shiftKey ? NUDGE_MM_LARGE : NUDGE_MM
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        if (dx !== 0 || dy !== 0) {
          event.preventDefault()
          nudge(editorRef.current, dx, dy)
          return
        }
      }

      if (isTextTarget(target) && event.key !== 'Escape') return

      const parts: string[] = []
      if (event.ctrlKey || event.metaKey) parts.push('CmdOrCtrl')
      if (event.shiftKey) parts.push('Shift')
      if (event.altKey) parts.push('Alt')
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) parts.push(key)
      const accelerator = parts.join('+')

      const id = handlers.get(accelerator)
      if (!id) return
      event.preventDefault()
      command(id)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [command, settings.shortcuts, workspace])

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      await run('Save settings', async () => {
        const next = await unwrap(bridge().app.saveSettings(patch))
        setSettings(next)
        setRecordingConfig(next.recording)
      })
    },
    [run]
  )

  const resetSetting = useCallback(
    async (key: keyof AppSettings) => {
      const value = DEFAULT_APP_SETTINGS[key]
      await updateSettings({ [key]: value } as Partial<AppSettings>)
    },
    [updateSettings]
  )

  // -------------------------------------------------------------------------
  // NDI + recording façades (stable across renders)
  // -------------------------------------------------------------------------

  const ndi = useMemo<NdiApi>(
    () => ({
      runtime: ndiRuntime,
      sources: ndiSources,
      stats: ndiStats,
      discovering,
      async discover() {
        setDiscovering(true)
        await run('NDI discovery', async () => {
          const sources = await unwrap(bridge().ndi.discover())
          setNdiSources(sources)
          if (sources.length === 0) {
            notify(
              'warning',
              'No NDI sources found',
              'Check that the NDI runtime is installed and the source is on the same network, then press Refresh.'
            )
          } else {
            notify('success', `Found ${sources.length} NDI source(s)`)
          }
        })
        setDiscovering(false)
      },
      async connect(source) {
        await run('NDI connect', async () => {
          const stats = await unwrap(bridge().ndi.connect(source))
          setNdiStats((current) => [...current.filter((item) => item.sourceId !== stats.sourceId), stats])
          notify('success', `Connected to ${source.name}`, `${stats.width} × ${stats.height}`)
        })
      },
      async disconnect(sourceId) {
        await run('NDI disconnect', async () => {
          await unwrap(bridge().ndi.disconnect(sourceId))
          frameHub.clear(sourceId)
          setNdiStats((current) => current.filter((item) => item.sourceId !== sourceId))
        })
      },
      async setPaused(sourceId, paused) {
        await run('NDI preview', async () => {
          await unwrap(bridge().ndi.setPaused(sourceId, paused))
          setNdiStats((current) =>
            current.map((item) => (item.sourceId === sourceId ? { ...item, paused } : item))
          )
        })
      },
      async startHelper() {
        await run('Start NDI helper', async () => {
          setNdiRuntime(await unwrap(bridge().ndi.start()))
        })
      },
      async stopHelper() {
        await run('Stop NDI helper', async () => {
          setNdiRuntime(await unwrap(bridge().ndi.stop()))
        })
      },
      async refreshRuntime() {
        await run('NDI status', async () => {
          setNdiRuntime(await unwrap(bridge().ndi.status()))
        })
      }
    }),
    [discovering, ndiRuntime, ndiSources, ndiStats, notify, run]
  )

  const recording = useMemo<RecordingApi>(
    () => ({
      status: recordingStatus,
      config: recordingConfig,
      entries: recordingEntries,
      async refresh() {
        await refreshRecordingEntries()
        await run('Recording status', async () => {
          setRecordingStatus(await unwrap(bridge().recording.status()))
        }, true)
      },
      async updateConfig(patch) {
        const next = { ...recordingConfig, ...patch }
        setRecordingConfig(next)
        await updateSettings({ recording: next })
      },
      async start() {
        window.dispatchEvent(new CustomEvent('cuepoint:recording-start'))
      },
      async pause() {
        await run('Pause recording', async () => {
          setRecordingStatus(await unwrap(bridge().recording.pause()))
        })
      },
      async resume() {
        await run('Resume recording', async () => {
          setRecordingStatus(await unwrap(bridge().recording.resume()))
        })
      },
      async stop() {
        window.dispatchEvent(new CustomEvent('cuepoint:recording-stop'))
      },
      async cancel() {
        window.dispatchEvent(new CustomEvent('cuepoint:recording-abort'))
      },
      async openFolder() {
        await run('Open recording folder', async () => {
          await unwrap(bridge().recording.openFolder())
        })
      },
      async removeEntry(id, deleteFile) {
        await run('Delete recording', async () => {
          await unwrap(bridge().recording.deleteEntry(id, deleteFile))
          await refreshRecordingEntries()
        })
      },
      async verify(id) {
        await run('Verify recording', async () => {
          const entry = await unwrap(bridge().recording.verify(id))
          setRecordingEntries((current) => current.map((item) => (item.id === entry.id ? entry : item)))
          if (entry.verified?.decodable) {
            notify('success', 'Recording verified', entry.verified.detail)
          } else {
            notify('error', 'Recording could not be verified', entry.verified?.detail ?? 'No verification detail available.')
          }
        })
      },
      reportProgress(framesCaptured, framesDropped, estimatedBytes) {
        setRecordingStatus((current) =>
          current ? { ...current, framesCaptured, framesDropped, estimatedBytes } : current
        )
      }
    }),
    [notify, recordingConfig, recordingEntries, recordingStatus, refreshRecordingEntries, run, updateSettings]
  )

  const projects = useMemo<ProjectsApi>(
    () => ({
      recent,
      snapshots,
      refreshRecent,
      refreshSnapshots,
      async open(path) {
        if (path) await loadProject(path)
        else command('file.open')
      },
      async create(request) {
        await createProject(request)
      },
      async duplicate(path, name) {
        await run('Duplicate project', async () => {
          const result = await unwrap(bridge().project.duplicate(path, name))
          await refreshRecent()
          notify('success', 'Project duplicated', result.path)
        })
      },
      async rename(name) {
        await run('Rename project', async () => {
          const project = await unwrap(bridge().project.rename(name))
          editorStore.dispatch({ type: 'load', project, path: editorRef.current.path })
          await refreshRecent()
        })
      },
      async forget(path) {
        await run('Remove from recent', async () => {
          await unwrap(bridge().project.forgetRecent(path))
          await refreshRecent()
          notify('info', 'Removed from recent projects', 'The project file was not deleted.')
        })
      },
      async pin(path, pinned) {
        await run('Pin project', async () => {
          await unwrap(bridge().project.pinRecent(path, pinned))
          await refreshRecent()
        })
      },
      async reveal(path) {
        await run('Reveal in Explorer', async () => {
          await unwrap(bridge().app.revealPath(path))
        })
      },
      async restoreSnapshot(id) {
        await run('Restore snapshot', async () => {
          const result = await unwrap(bridge().project.restoreSnapshot(id))
          const project = await unwrap(bridge().project.current())
          editorStore.dispatch({ type: 'load', project, path: result.path })
          setModal(null)
          setWorkspace('stage')
          notify('success', 'Recovery snapshot restored', 'The project is marked as modified — save to keep it.')
        })
      },
      async deleteSnapshot(id) {
        await run('Delete snapshot', async () => {
          await unwrap(bridge().project.deleteSnapshot(id))
          await refreshSnapshots()
        })
      }
    }),
    [
      command,
      createProject,
      loadProject,
      notify,
      recent,
      refreshRecent,
      refreshSnapshots,
      run,
      snapshots
    ]
  )

  const value: AppContextValue = {
    ready,
    info,
    settings,
    updateSettings,
    resetSetting,
    workspace,
    goTo,
    editor,
    dispatch: editorStore.dispatch,
    saveProject,
    saveProjectAs,
    closeProject,
    validate,
    toasts,
    notify,
    dismissToast,
    projects,
    ndi,
    recording,
    command,
    panels,
    togglePanel,
    modal,
    openModal: setModal,
    closeModal: () => setModal(null),
    diagnosticsReport,
    refreshDiagnostics
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

function nudge(state: EditorState, dxMm: number, dyMm: number): void {
  const locked = new Set(state.project?.screens.filter((screen) => screen.locked).map((screen) => screen.id) ?? [])
  const ids = state.selection.filter((id) => !locked.has(id))
  if (ids.length === 0) return
  const changes = ids.map((id) => {
    const screen = state.project?.screens.find((candidate) => candidate.id === id)
    return {
      id,
      geometry: { xMm: (screen?.xMm ?? 0) + dxMm, yMm: (screen?.yMm ?? 0) + dyMm }
    }
  })
  editorStore.dispatch({
    type: 'setGeometry',
    changes,
    label: `Nudge screens (${dxMm}mm, ${dyMm}mm)`,
    coalesce: 'nudge'
  })
}

function selectedToClipboard(state: EditorState): Partial<Screen>[] {
  const ids = new Set(state.selection)
  return (state.project?.screens ?? [])
    .filter((screen) => ids.has(screen.id))
    .map((screen) => ({
      name: screen.name,
      widthMm: screen.widthMm,
      heightMm: screen.heightMm,
      pixelWidth: screen.pixelWidth,
      pixelHeight: screen.pixelHeight,
      xMm: screen.xMm,
      yMm: screen.yMm,
      rotationDeg: screen.rotationDeg
    }))
}

/** Accepts CuePoint screen JSON, or a plain text list of screen names. */
function parseClipboard(text: string): Partial<Screen>[] | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed) as Partial<Screen>[]
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed.filter((item) => item && typeof item.widthMm === 'number')
  } catch {
    return null
  }
}
