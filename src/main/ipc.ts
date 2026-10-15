import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, clipboard, dialog, ipcMain, shell, type BrowserWindow as BW } from 'electron'
import type { AppInfo, PreviewRequest, RendererMenuState, WindowAction } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import type { AppSettings, ExportRequest } from '@shared/appTypes'
import type { Project } from '@shared/types'
import { SCHEMA_VERSION, nowIso } from '@shared/project'
import { validateProject } from '@shared/validation'
import { buildMappingPlan } from '@shared/mapping'
import { normalizeSettings } from '@shared/appSettings'
import { AppError, guard, requireString, assert } from './services/errors'
import type { AppPaths } from './services/paths'
import { ProjectStore, PROJECT_EXTENSION, sanitiseFileName, uniquePath } from './services/projectStore'
import type { ExportService } from './services/exportService'
import type { NdiManager } from './services/ndiManager'
import type { RecordingService } from './services/recordingService'
import type { DiagnosticsService } from './services/diagnosticsService'
import { SUPPORTED_IMAGE_EXTENSIONS, extensionOf, isSupportedImagePath, probeImage } from './services/imageProbe'
import { getLogger } from './services/logger'
import { APP_COPYRIGHT, APP_LICENSE, APP_VERSION, DOC_FILES } from './constants'

export interface IpcContext {
  paths: AppPaths
  store: ProjectStore
  exporter: ExportService
  ndi: NdiManager
  recording: RecordingService
  diagnostics: DiagnosticsService
  getWindow: () => BW | null
  setDirtySuppressed: (value: boolean) => void
  setMenuState: (patch: Partial<RendererMenuState>) => void
}

/**
 * Registers every IPC handler.
 *
 * Every handler is wrapped in `guard`, so a failure becomes a typed
 * `{ ok: false, error }` envelope instead of a rejected promise, and every mutating
 * handler validates its arguments before touching the file system.
 */
export function registerIpcHandlers(context: IpcContext): void {
  const { paths, store, exporter, ndi, recording, diagnostics } = context
  const logger = getLogger()

  const withWindow = <T>(fn: (window: BW) => T): T => {
    const window = context.getWindow()
    if (!window || window.isDestroyed()) {
      throw new AppError('E_INTERNAL', 'The CuePoint window is not available.')
    }
    return fn(window)
  }

  // -------------------------------------------------------------------------
  // Application
  // -------------------------------------------------------------------------

  ipcMain.handle(
    IPC.app.info,
    () =>
      guard('app.info', (): AppInfo => ({
        name: 'CuePoint',
        version: APP_VERSION,
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        userDataPath: paths.userData,
        logsPath: paths.logs,
        docsPath: paths.docs,
        workspacePath: paths.appRoot,
        license: APP_LICENSE,
        author: 'Sandila Fernando',
        copyright: APP_COPYRIGHT
      }))
  )

  ipcMain.handle(IPC.app.settings, () => guard('app.settings', () => store.getSettings()))

  ipcMain.handle(IPC.app.saveSettings, (_event, patch: Partial<AppSettings>) =>
    guard('app.saveSettings', async () => {
      assert(patch && typeof patch === 'object', 'Settings payload is required.')
      const normalized = normalizeSettings({ ...store.getSettings(), ...patch })
      const saved = await store.saveSettings(normalized)
      ndi.updateSettings(saved.ndi)
      return saved
    })
  )

  ipcMain.handle(IPC.app.window, (_event, action: WindowAction) =>
    guard('app.window', () =>
      withWindow((window) => {
        switch (action) {
          case 'minimize':
            window.minimize()
            return true
          case 'maximize':
            if (window.isMaximized()) window.unmaximize()
            else window.maximize()
            return window.isMaximized()
          case 'close':
            window.close()
            return true
          default:
            throw new AppError('E_INVALID_INPUT', `Unknown window action "${String(action)}".`)
        }
      })
    )
  )

  ipcMain.handle(IPC.app.isMaximized, () =>
    guard('app.isMaximized', () => withWindow((window) => window.isMaximized()))
  )

  ipcMain.handle(
    IPC.app.chooseDirectory,
    (_event, options: { title?: string; defaultPath?: string } | undefined) =>
      guard('app.chooseDirectory', async () => {
        const window = context.getWindow()
        const result = await dialog.showOpenDialog(window ?? undefined!, {
          title: options?.title ?? 'Choose a folder',
          defaultPath: options?.defaultPath,
          properties: ['openDirectory', 'createDirectory', 'promptToCreate']
        })
        if (result.canceled || result.filePaths.length === 0) return null
        return result.filePaths[0]
      })
  )

  ipcMain.handle(
    IPC.app.chooseFile,
    (
      _event,
      options: { title?: string; filters?: { name: string; extensions: string[] }[]; defaultPath?: string } | undefined
    ) =>
      guard('app.chooseFile', async () => {
        const window = context.getWindow()
        const result = await dialog.showOpenDialog(window ?? undefined!, {
          title: options?.title ?? 'Choose a file',
          defaultPath: options?.defaultPath,
          filters: options?.filters ?? [
            { name: 'Images', extensions: SUPPORTED_IMAGE_EXTENSIONS },
            { name: 'All files', extensions: ['*'] }
          ],
          properties: ['openFile']
        })
        if (result.canceled || result.filePaths.length === 0) return null
        return result.filePaths[0]
      })
  )

  ipcMain.handle(IPC.app.openExternal, (_event, url: string) =>
    guard('app.openExternal', async () => {
      const target = requireString(url, 'URL')
      // Only well-formed http(s) URLs may leave the application.
      assert(/^https?:\/\//i.test(target), 'Only http and https links can be opened.')
      await shell.openExternal(target)
      return true
    })
  )

  ipcMain.handle(IPC.app.openPath, (_event, target: string) =>
    guard('app.openPath', async () => {
      const value = requireString(target, 'Path')
      const error = await shell.openPath(value)
      if (error) {
        throw new AppError('E_IO', error, { hint: 'Check that the file still exists and that you have access to it.' })
      }
      return true
    })
  )

  ipcMain.handle(IPC.app.revealPath, (_event, target: string) =>
    guard('app.revealPath', async () => {
      const value = requireString(target, 'Path')
      if (!existsSync(value)) {
        throw new AppError('E_NOT_FOUND', `"${value}" no longer exists.`, {
          hint: 'The file may have been moved or deleted outside CuePoint.'
        })
      }
      shell.showItemInFolder(value)
      return true
    })
  )

  ipcMain.handle(IPC.app.clipboardWrite, (_event, text: string) =>
    guard('app.clipboardWrite', () => {
      assert(typeof text === 'string', 'Clipboard text must be a string.')
      clipboard.writeText(text.slice(0, 200_000))
      return true
    })
  )

  ipcMain.handle(IPC.app.clipboardRead, () => guard('app.clipboardRead', () => clipboard.readText()))

  ipcMain.handle(IPC.app.setMenuState, (_event, patch: Partial<RendererMenuState>) =>
    guard('app.setMenuState', () => {
      assert(patch && typeof patch === 'object', 'A menu state payload is required.')
      context.setMenuState(patch)
      return true
    })
  )

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.project.create, (_event, request: Record<string, unknown>) =>
    guard('project.create', async () => {
      assert(request && typeof request === 'object', 'A project request is required.')
      const name = requireString(request.name, 'Project name', 120)
      const directory = typeof request.directory === 'string' && request.directory ? request.directory : paths.projects
      const result = await store.createProject({
        name,
        author: typeof request.author === 'string' ? request.author : '',
        directory,
        stageWidthMm: Number(request.stageWidthMm ?? 12_000),
        stageHeightMm: Number(request.stageHeightMm ?? 6_000),
        defaultUnit: (request.defaultUnit as AppSettings['defaultUnit']) ?? 'm',
        backgroundAssetPath:
          typeof request.backgroundAssetPath === 'string' && request.backgroundAssetPath
            ? request.backgroundAssetPath
            : null,
        initialScreenCount: Number(request.initialScreenCount ?? 0),
        outputs: Array.isArray(request.outputs)
          ? (request.outputs as { name: string; width: number; height: number }[])
          : undefined
      })
      return result
    })
  )

  ipcMain.handle(IPC.project.openDialog, () =>
    guard('project.openDialog', async () => {
      const window = context.getWindow()
      const result = await dialog.showOpenDialog(window ?? undefined!, {
        title: 'Open CuePoint project',
        defaultPath: paths.projects,
        filters: [
          { name: 'CuePoint projects', extensions: [PROJECT_EXTENSION] },
          { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const opened = await store.openProject(result.filePaths[0])
      return toOpenResult(opened)
    })
  )

  ipcMain.handle(IPC.project.openPath, (_event, projectPath: string) =>
    guard('project.openPath', async () => {
      const opened = await store.openProject(requireString(projectPath, 'Project path'))
      return toOpenResult(opened)
    })
  )

  ipcMain.handle(IPC.project.current, () =>
    guard('project.current', () => {
      if (!store.getProjectPath()) {
        throw new AppError('E_NOT_FOUND', 'No project is currently open.')
      }
      return store.getProject()
    })
  )

  ipcMain.handle(IPC.project.save, () =>
    guard('project.save', async () => {
      if (!store.getProjectPath()) return null
      return store.saveCurrent('manual')
    })
  )

  ipcMain.handle(IPC.project.saveAs, (_event, directory?: string) =>
    guard('project.saveAs', async () => {
      let target = typeof directory === 'string' && directory ? directory : ''
      if (!target) {
        const window = context.getWindow()
        const result = await dialog.showOpenDialog(window ?? undefined!, {
          title: 'Choose a folder for this project',
          defaultPath: store.getProjectPath() ? path.dirname(store.getProjectPath()!) : paths.projects,
          properties: ['openDirectory', 'createDirectory', 'promptToCreate']
        })
        if (result.canceled || result.filePaths.length === 0) return null
        target = result.filePaths[0]
      }
      return store.saveAs(target)
    })
  )

  ipcMain.handle(IPC.project.apply, (_event, payload: { project: Project; reason?: string }) =>
    guard('project.apply', async () => {
      assert(payload?.project && typeof payload.project === 'object', 'A project payload is required.')
      const incoming = payload.project
      assert(Array.isArray(incoming.screens), 'The project payload has no screens array.')
      assert(Array.isArray(incoming.outputs), 'The project payload has no outputs array.')
      assert(incoming.stage && typeof incoming.stage === 'object', 'The project payload has no stage.')
      store.setProject({ ...incoming, schemaVersion: SCHEMA_VERSION }, { reason: payload.reason })
      return { dirty: store.isDirty() }
    })
  )

  ipcMain.handle(IPC.project.validate, () =>
    guard('project.validate', () => {
      const project = store.getProject()
      const validation = validateProject(project)
      const plan = buildMappingPlan(project)
      return {
        errors: validation.errors,
        warnings: validation.warnings,
        mappingIssues: plan.issues,
        summary: store.summary()
      }
    })
  )

  ipcMain.handle(IPC.project.recent, () => guard('project.recent', () => store.recentProjects()))

  ipcMain.handle(IPC.project.forgetRecent, (_event, projectPath: string) =>
    guard('project.forgetRecent', async () => {
      // Removing a project from the list never deletes the file.
      await store.forgetRecent(requireString(projectPath, 'Project path'))
      return true
    })
  )

  ipcMain.handle(IPC.project.pinRecent, (_event, payload: { path: string; pinned: boolean }) =>
    guard('project.pinRecent', async () => {
      const target = requireString(payload?.path, 'Project path')
      await store.pinRecent(target, Boolean(payload?.pinned))
      return true
    })
  )

  ipcMain.handle(IPC.project.duplicate, (_event, payload: { path: string; newName?: string }) =>
    guard('project.duplicate', async () => {
      const source = requireString(payload?.path, 'Project path')
      const result = await store.duplicateProject(source, payload?.newName)
      const opened = await store.openProject(result.path)
      return toOpenResult(opened)
    })
  )

  ipcMain.handle(IPC.project.rename, (_event, newName: string) =>
    guard('project.rename', async () => store.renameProject(requireString(newName, 'Project name', 120)))
  )

  ipcMain.handle(IPC.project.snapshots, (_event, projectPath?: string) =>
    guard('project.snapshots', () => store.snapshots(typeof projectPath === 'string' ? projectPath : undefined))
  )

  ipcMain.handle(IPC.project.restoreSnapshot, (_event, id: number) =>
    guard('project.restoreSnapshot', async () => {
      const snapshots = await store.snapshots()
      const snapshot = snapshots.find((candidate) => candidate.id === id)
      if (!snapshot) throw new AppError('E_NOT_FOUND', 'That recovery snapshot is no longer available.')
      if (!existsSync(snapshot.path)) {
        throw new AppError('E_NOT_FOUND', 'The recovery snapshot file is missing from disk.')
      }
      // Restore into the original project location, keeping the current file as a backup.
      const target = snapshot.projectPath
      if (existsSync(target)) {
        await copyFile(target, `${target}.pre-restore.bak`).catch(() => undefined)
      }
      await copyFile(snapshot.path, target)
      const opened = await store.openProject(target)
      return toOpenResult(opened)
    })
  )

  ipcMain.handle(IPC.project.deleteSnapshot, (_event, id: number) =>
    guard('project.deleteSnapshot', () => store.deleteSnapshot(Number(id)))
  )

  ipcMain.handle(IPC.project.markClean, (_event, projectPath?: string) =>
    guard('project.markClean', () => {
      store.markClean(typeof projectPath === 'string' ? projectPath : undefined)
      return true
    })
  )

  // -------------------------------------------------------------------------
  // Stage assets
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.stage.probeAsset, (_event, assetPath: string) =>
    guard('stage.probeAsset', async () => {
      const target = requireString(assetPath, 'Asset path')
      return probeAsset(target)
    })
  )

  ipcMain.handle(IPC.stage.importBackground, () =>
    guard('stage.importBackground', async () => {
      const window = context.getWindow()
      const result = await dialog.showOpenDialog(window ?? undefined!, {
        title: 'Import stage background',
        filters: [
          { name: 'Images', extensions: SUPPORTED_IMAGE_EXTENSIONS },
          { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const source = result.filePaths[0]
      const info = await probeAsset(source)
      await mkdir(paths.assets, { recursive: true })
      const target = uniquePath(
        path.join(paths.assets, `${sanitiseFileName(path.basename(source, path.extname(source)))}${path.extname(source)}`)
      )
      await copyFile(source, target)
      logger.info('stage', 'Background imported.', `${source} -> ${target}`)
      return { ...info, copiedTo: target }
    })
  )

  ipcMain.handle(IPC.stage.readAssetDataUrl, (_event, assetPath: string) =>
    guard('stage.readAssetDataUrl', async () => {
      const target = requireString(assetPath, 'Asset path')
      if (!existsSync(target)) {
        throw new AppError('E_NOT_FOUND', `The background image "${path.basename(target)}" was not found.`, {
          hint: 'Import the image again, or choose a different file.'
        })
      }
      const info = await stat(target)
      assert(info.size <= 64 * 1024 * 1024, 'That image is larger than the 64 MB limit for stage backgrounds.')
      const buffer = await readFile(target)
      const probed = probeImage(buffer)
      const mime =
        probed?.format === 'png'
          ? 'image/png'
          : probed?.format === 'jpeg'
            ? 'image/jpeg'
            : probed?.format === 'webp'
              ? 'image/webp'
              : probed?.format === 'gif'
                ? 'image/gif'
                : probed?.format === 'bmp'
                  ? 'image/bmp'
                  : 'application/octet-stream'
      return `data:${mime};base64,${buffer.toString('base64')}`
    })
  )

  ipcMain.handle(IPC.stage.clearBackground, (_event, deleteFile: boolean) =>
    guard('stage.clearBackground', async () => {
      const project = store.getProject()
      const assetPath = project.stage.background.assetPath
      project.stage.background.assetPath = null
      project.stage.background.assetMissing = false
      project.stage.background.sourceWidth = null
      project.stage.background.sourceHeight = null
      store.setProject(project, { reason: 'background-cleared' })
      if (deleteFile && assetPath && assetPath.startsWith(paths.assets)) {
        await unlink(assetPath).catch(() => undefined)
      }
      return true
    })
  )

  async function probeAsset(target: string): Promise<{
    path: string
    width: number
    height: number
    bytes: number
    format: string
    copiedTo: string | null
    warning: string | null
  }> {
    if (!existsSync(target)) {
      throw new AppError('E_NOT_FOUND', `"${target}" could not be found.`)
    }
    if (isSupportedImagePath(target)) {
      // Accept known extensions, but still verify the header below.
    }
    const info = await stat(target)
    if (info.size > 64 * 1024 * 1024) {
      throw new AppError('E_UNSUPPORTED', 'That image is larger than the 64 MB limit for stage backgrounds.')
    }
    const handle = await readFile(target)
    const probed = probeImage(handle)
    if (!probed) {
      throw new AppError(
        'E_UNSUPPORTED',
        `"${path.basename(target)}" is not a readable PNG, JPEG, WebP, BMP or GIF image.`,
        { hint: 'Choose a different file, or re-export the image from your image editor.' }
      )
    }
    if (probed.width < 16 || probed.height < 16) {
      throw new AppError('E_UNSUPPORTED', 'Stage backgrounds must be at least 16 × 16 pixels.')
    }
    const extension = extensionOf(target)
    const warning =
      extension && !SUPPORTED_IMAGE_EXTENSIONS.includes(extension)
        ? `The file extension ".${extension}" does not match the detected ${probed.format.toUpperCase()} data.`
        : null
    return {
      path: target,
      width: probed.width,
      height: probed.height,
      bytes: info.size,
      format: probed.format,
      copiedTo: null,
      warning
    }
  }

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.export.run, (_event, request: ExportRequest) =>
    guard('export.run', async () => {
      assert(request && typeof request === 'object', 'An export request is required.')
      assert(Array.isArray(request.kinds), 'The export request must list at least one kind.')
      return exporter.run(request)
    })
  )

  ipcMain.handle(IPC.export.preview, (_event, request: PreviewRequest) =>
    guard('export.preview', async () => {
      assert(request && typeof request === 'object', 'A preview request is required.')
      return exporter.preview(request)
    })
  )

  ipcMain.handle(IPC.export.defaultDirectory, () =>
    guard('export.defaultDirectory', async () => {
      const settings = store.getSettings()
      const directory = settings.export.directory ?? paths.exports
      if (settings.export.directory) return directory
      // Fall back to a native picker the first time, so exports land where the
      // operator expects instead of deep inside the app data folder.
      const window = context.getWindow()
      const result = await dialog.showOpenDialog(window ?? undefined!, {
        title: 'Choose an export folder',
        defaultPath: directory,
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      })
      if (result.canceled || result.filePaths.length === 0) return directory
      await store.saveSettings({ export: { ...settings.export, directory: result.filePaths[0] } })
      return result.filePaths[0]
    })
  )

  // -------------------------------------------------------------------------
  // NDI
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.ndi.status, () => guard('ndi.status', () => ndi.getStatus()))

  ipcMain.handle(IPC.ndi.start, () =>
    guard('ndi.start', async () => {
      const status = ndi.start()
      return status
    })
  )

  ipcMain.handle(IPC.ndi.stop, () =>
    guard('ndi.stop', () => {
      ndi.stop()
      return ndi.getStatus()
    })
  )

  ipcMain.handle(IPC.ndi.discover, (_event, timeoutMs?: number) =>
    guard('ndi.discover', async () => ndi.discover(typeof timeoutMs === 'number' ? timeoutMs : undefined))
  )

  ipcMain.handle(IPC.ndi.connect, (_event, source: { id: string; name: string; urlAddress: string; groups: string }) =>
    guard('ndi.connect', () => {
      assert(source && typeof source.name === 'string' && source.name.trim().length > 0, 'A source name is required.')
      return ndi.connect({
        id: source.id || source.name,
        name: source.name,
        urlAddress: typeof source.urlAddress === 'string' ? source.urlAddress : '',
        groups: typeof source.groups === 'string' ? source.groups : ''
      })
    })
  )

  ipcMain.handle(IPC.ndi.disconnect, (_event, sourceId: string) =>
    guard('ndi.disconnect', () => ndi.disconnect(requireString(sourceId, 'Source id')))
  )

  ipcMain.handle(IPC.ndi.setPaused, (_event, payload: { sourceId: string; paused: boolean }) =>
    guard('ndi.setPaused', () =>
      ndi.setPaused(requireString(payload?.sourceId, 'Source id'), Boolean(payload?.paused))
    )
  )

  ipcMain.handle(IPC.ndi.setPreviewFps, (_event, fps: number) =>
    guard('ndi.setPreviewFps', async () => {
      const value = Math.round(Number(fps))
      assert(Number.isFinite(value) && value >= 1 && value <= 120, 'Preview frame rate must be between 1 and 120.')
      const settings = store.getSettings()
      await store.saveSettings({ ndi: { ...settings.ndi, previewFps: value } })
      ndi.setPreviewFps(value)
      return true
    })
  )

  ipcMain.handle(IPC.ndi.stats, () => guard('ndi.stats', () => ndi.getStats()))

  ipcMain.handle(IPC.ndi.requestPort, () => guard('ndi.requestPort', () => ndi.createFramePort()))

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.recording.status, () => guard('recording.status', () => recording.getStatus()))

  ipcMain.handle(IPC.recording.start, (_event, config: Record<string, unknown>) =>
    guard('recording.start', async () => {
      const settings = store.getSettings()
      const merged = normalizeSettings({
        ...settings,
        recording: { ...settings.recording, ...(config ?? {}) }
      })
      assert(merged.recording.target !== 'screen' || merged.recording.screenId, 'Select a screen to record.')
      assert(merged.recording.target !== 'ndi' || merged.recording.ndiSourceId, 'Select an NDI source to record.')
      return recording.preflight(merged.recording)
    })
  )

  ipcMain.handle(IPC.recording.pause, () => guard('recording.pause', () => recording.pause()))
  ipcMain.handle(IPC.recording.resume, () => guard('recording.resume', () => recording.resume()))

  ipcMain.handle(
    IPC.recording.begin,
    (
      _event,
      payload: { mimeType: string; container: 'webm' | 'mp4'; width: number; height: number; fps: number; label: string }
    ) =>
      guard('recording.begin', async () => {
        assert(payload && typeof payload === 'object', 'A recording payload is required.')
        assert(typeof payload.mimeType === 'string' && payload.mimeType.length > 0, 'A MIME type is required.')
        const settings = store.getSettings()
        return recording.begin({ ...payload, config: settings.recording })
      })
  )

  ipcMain.handle(IPC.recording.receiveChunk, (_event, sessionId: string, chunk: ArrayBuffer) =>
    guard('recording.push', async () => {
      assert(chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk), 'A binary chunk is required.')
      const bytes = new Uint8Array(chunk as ArrayBuffer)
      return recording.push(requireString(sessionId, 'Session id'), bytes)
    })
  )

  ipcMain.handle(IPC.recording.finalize, (_event, sessionId: string, payload: Record<string, number>) =>
    guard('recording.finalize', async () => {
      const settings = store.getSettings()
      return recording.finish(requireString(sessionId, 'Session id'), {
        durationMs: Number(payload?.durationMs ?? 0),
        framesCaptured: Number(payload?.framesCaptured ?? 0),
        framesDropped: Number(payload?.framesDropped ?? 0),
        config: settings.recording
      })
    })
  )

  ipcMain.handle(IPC.recording.cancel, (_event, sessionId: string, reason: string) =>
    guard('recording.cancel', () => recording.abort(requireString(sessionId, 'Session id'), reason || 'Cancelled by the operator.'))
  )

  ipcMain.handle(IPC.recording.stop, () =>
    guard('recording.stop', () => {
      recording.setProgress('', 0, 0, 0)
      return recording.getStatus()
    })
  )

  ipcMain.handle(IPC.recording.entries, () => guard('recording.entries', () => store.recordingEntries()))

  ipcMain.handle(IPC.recording.deleteEntry, (_event, payload: { id: string; deleteFile: boolean }) =>
    guard('recording.deleteEntry', async () => {
      const id = requireString(payload?.id, 'Recording id')
      const entry = store.recordingEntries().find((candidate) => candidate.id === id)
      if (payload?.deleteFile && entry && existsSync(entry.filePath)) {
        await unlink(entry.filePath).catch(() => undefined)
      }
      return store.deleteRecordingEntry(id)
    })
  )

  ipcMain.handle(IPC.recording.verify, (_event, id: string) =>
    guard('recording.verify', () => recording.verifyEntry(requireString(id, 'Recording id')))
  )

  ipcMain.handle(IPC.recording.openFolder, () =>
    guard('recording.openFolder', async () => {
      const directory = recording.getOutputDirectory(store.getSettings().recording)
      await mkdir(directory, { recursive: true })
      const error = await shell.openPath(directory)
      if (error) throw new AppError('E_IO', error)
      return true
    })
  )

  ipcMain.handle(IPC.recording.checkEncoder, () => guard('recording.checkEncoder', () => recording.checkEncoder(true)))

  ipcMain.handle(IPC.recording.config, () => guard('recording.config', () => store.getSettings().recording))

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.diagnostics.report, () => guard('diagnostics.report', () => diagnostics.report()))

  ipcMain.handle(IPC.diagnostics.logs, (_event, query?: { limit?: number; level?: 'error' | 'warn' | 'info' | 'debug'; scope?: string }) =>
    guard('diagnostics.logs', () => diagnostics.logs(query ?? {}))
  )

  ipcMain.handle(IPC.diagnostics.clearLogs, () =>
    guard('diagnostics.clearLogs', () => {
      logger.info('diagnostics', 'Log view cleared.')
      return true
    })
  )

  ipcMain.handle(IPC.diagnostics.writeReport, () =>
    guard('diagnostics.writeReport', async () => {
      const text = await diagnostics.reportText()
      const target = path.join(paths.logs, `diagnostic-report-${Date.now()}.txt`)
      await writeFile(target, text, 'utf8')
      return target
    })
  )

  // -------------------------------------------------------------------------
  // Documentation
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.docs.list, () =>
    guard('docs.list', () =>
      DOC_FILES.map((doc) => ({
        id: doc.id,
        title: doc.title,
        description: doc.description,
        path: path.join(paths.docs, doc.file),
        exists: existsSync(path.join(paths.docs, doc.file))
      }))
    )
  )

  ipcMain.handle(IPC.docs.read, (_event, id: string) =>
    guard('docs.read', async () => {
      const doc = DOC_FILES.find((candidate) => candidate.id === id)
      if (!doc) throw new AppError('E_NOT_FOUND', 'That document is not part of this build.')
      const target = path.join(paths.docs, doc.file)
      if (!existsSync(target)) {
        throw new AppError('E_NOT_FOUND', `The document "${doc.title}" was not installed with this build.`, {
          hint: 'Reinstall CuePoint, or open the documentation next to the installer.'
        })
      }
      return readFile(target, 'utf8')
    })
  )

  ipcMain.handle(IPC.docs.open, (_event, id: string) =>
    guard('docs.open', async () => {
      const doc = DOC_FILES.find((candidate) => candidate.id === id)
      if (!doc) throw new AppError('E_NOT_FOUND', 'That document is not part of this build.')
      const target = path.join(paths.docs, doc.file)
      if (!existsSync(target)) {
        throw new AppError('E_NOT_FOUND', `The document "${doc.title}" was not installed with this build.`)
      }
      const error = await shell.openPath(target)
      if (error) throw new AppError('E_IO', error)
      return true
    })
  )

  logger.info('ipc', `Registered ${countHandlers()} IPC handlers.`)
}

function countHandlers(): number {
  // Reflects how many channels this module registered, for the diagnostics log line.
  return Object.values(IPC).reduce((sum, group) => sum + Object.keys(group).length, 0)
}

function toOpenResult(opened: {
  path: string
  directory: string
  migrations: string[]
  missingAssets: string[]
  backupPath: string | null
}): {
  path: string
  directory: string
  migrations: string[]
  missingAssets: string[]
  backupPath: string | null
} {
  return {
    path: opened.path,
    directory: opened.directory,
    migrations: opened.migrations,
    missingAssets: opened.missingAssets,
    backupPath: opened.backupPath
  }
}

export function sendToRenderer(window: BW | null, channel: string, payload?: unknown): void {
  if (!window || window.isDestroyed()) return
  window.webContents.send(channel, payload)
}

export function broadcastSettings(window: BW | null, settings: AppSettings): void {
  sendToRenderer(window, IPC.events.settingsChanged, settings)
}

export function broadcastToast(
  window: BW | null,
  toast: { id: string; level: 'info' | 'success' | 'warning' | 'error'; message: string; detail?: string; timeoutMs?: number }
): void {
  sendToRenderer(window, IPC.events.toast, {
    id: toast.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level: toast.level,
    message: toast.message,
    detail: toast.detail,
    timeoutMs: toast.timeoutMs ?? 5_000
  })
}

export function broadcastDirtyState(
  window: BW | null,
  state: { dirty: boolean; savedAt: string | null; autosaveAt: string | null; path: string | null }
): void {
  sendToRenderer(window, IPC.events.dirtyState, state)
}

export function emitCommand(window: BW | null, command: string): void {
  sendToRenderer(window, IPC.events.command, command)
}

export function projectSummaryFor(store: ProjectStore): ReturnType<ProjectStore['summary']> {
  return store.summary()
}

export function windowFrom(target: BrowserWindow | null): BrowserWindow | null {
  return target && !target.isDestroyed() ? target : null
}

export function describeSaveTimestamp(): string {
  return nowIso()
}
