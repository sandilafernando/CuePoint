import { copyFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  OpenProjectResult,
  RecentProjectEntry,
  RecordingEntry,
  RecoverySnapshot,
  SaveProjectResult
} from '@shared/appTypes'
import type { Project, ProjectSummary, Screen } from '@shared/types'
import type { SqlValue } from 'sql.js'
import {
  SCHEMA_VERSION,
  createDefaultOutput,
  createDefaultProject,
  migrateProject,
  nowIso,
  projectSummary,
  type NewProjectOptions
} from '@shared/project'
import { validateProject } from '@shared/validation'
import { createDefaultSettings, normalizeSettings } from '@shared/appSettings'
import { AppError } from './errors'
import type { AppPaths } from './paths'
import { resolveSqlJsWasm } from './paths'
import { SqliteDb, type SqlParam } from './sqlite'
import type { Logger } from './logger'

/** Project file extension. The file itself is an ordinary SQLite database. */
export const PROJECT_EXTENSION = 'cuepoint'

export const LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS library_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recent_projects (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recovery_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  screen_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  fps INTEGER NOT NULL,
  container TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  verification_json TEXT
);
`

export const PROJECT_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  width_mm REAL NOT NULL,
  height_mm REAL NOT NULL,
  canvas_px_per_meter REAL NOT NULL,
  default_unit TEXT NOT NULL,
  grid_visible INTEGER NOT NULL,
  grid_spacing_mm REAL NOT NULL,
  grid_major_every INTEGER NOT NULL,
  grid_subdivisions INTEGER NOT NULL,
  snap_to_grid INTEGER NOT NULL,
  snap_to_screens INTEGER NOT NULL,
  snap_to_stage INTEGER NOT NULL,
  snap_tolerance_px REAL NOT NULL,
  guides_visible INTEGER NOT NULL,
  rulers_visible INTEGER NOT NULL,
  background_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS screens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  color TEXT NOT NULL,
  visible INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  notes TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  group_id TEXT,
  x_mm REAL NOT NULL,
  y_mm REAL NOT NULL,
  width_mm REAL NOT NULL,
  height_mm REAL NOT NULL,
  rotation_deg REAL NOT NULL,
  pixel_width INTEGER NOT NULL,
  pixel_height INTEGER NOT NULL,
  pixel_pitch_mm REAL,
  map_output_id TEXT,
  map_x REAL NOT NULL,
  map_y REAL NOT NULL,
  map_width REAL NOT NULL,
  map_height REAL NOT NULL,
  map_auto_region INTEGER NOT NULL,
  map_export_visible INTEGER NOT NULL,
  map_scale REAL NOT NULL,
  map_offset_x REAL NOT NULL,
  map_offset_y REAL NOT NULL,
  map_notes TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS screens_order_idx ON screens (sort_order);
CREATE TABLE IF NOT EXISTS screen_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  visible INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  collapsed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outputs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  notes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  autosave_enabled INTEGER NOT NULL,
  autosave_interval_ms INTEGER NOT NULL,
  backup_retention INTEGER NOT NULL,
  export_directory TEXT
);
`

interface MetaRow {
  id: string
  name: string
  author: string
  created_at: string
  updated_at: string
  notes: string
}

interface ScreenRow {
  id: string
  name: string
  type: string
  color: string
  visible: number
  locked: number
  notes: string
  sort_order: number
  group_id: string | null
  x_mm: number
  y_mm: number
  width_mm: number
  height_mm: number
  rotation_deg: number
  pixel_width: number
  pixel_height: number
  pixel_pitch_mm: number | null
  map_output_id: string | null
  map_x: number
  map_y: number
  map_width: number
  map_height: number
  map_auto_region: number
  map_export_visible: number
  map_scale: number
  map_offset_x: number
  map_offset_y: number
  map_notes: string
}

export interface CurrentProjectState {
  project: Project
  projectPath: string | null
  dirty: boolean
  lastSavedAt: string | null
  autosaveAt: string | null
}

export interface StoreEvents {
  onDirtyState?: (state: {
    dirty: boolean
    savedAt: string | null
    autosaveAt: string | null
    path: string | null
  }) => void
  onProjectSaved?: (result: SaveProjectResult) => void
  onWarning?: (message: string, detail?: string) => void
}

function toInt(value: SqlValue | undefined | null, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toText(value: SqlValue | undefined | null, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0
}

/**
 * Owns everything persistent: the library database (settings, recent projects,
 * recording history, recovery snapshots) and one SQLite database per project.
 */
export class ProjectStore {
  private paths: AppPaths
  private logger: Logger
  private events: StoreEvents
  private library: SqliteDb | null = null
  private settings: AppSettings = createDefaultSettings()
  private state: CurrentProjectState = {
    project: createDefaultProject({ name: 'Untitled Project' }),
    projectPath: null,
    dirty: false,
    lastSavedAt: null,
    autosaveAt: null
  }
  private autosaveTimer: NodeJS.Timeout | null = null
  private lastAutosaveAttempt = 0

  constructor(paths: AppPaths, logger: Logger, events: StoreEvents = {}) {
    this.paths = paths
    this.logger = logger
    this.events = events
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    for (const dir of [
      this.paths.userData,
      this.paths.logs,
      this.paths.projects,
      this.paths.exports,
      this.paths.recordings,
      this.paths.assets,
      this.paths.tmp
    ]) {
      await mkdir(dir, { recursive: true })
    }
    this.library = await SqliteDb.open(this.paths.library, {
      wasmPath: resolveSqlJsWasm(this.paths),
      schema: LIBRARY_SCHEMA,
      writable: true
    })
    const raw = this.library.one<{ value: string }>('SELECT value FROM library_meta WHERE key = ?', [
      'app_settings'
    ])
    if (raw?.value) {
      try {
        this.settings = normalizeSettings(JSON.parse(raw.value))
      } catch (error) {
        this.logger.warn('settings', 'Settings file was unreadable; defaults restored.', String(error))
        this.settings = createDefaultSettings()
      }
    }
    const versionRow = this.library.one<{ version: number }>('SELECT version FROM schema_version WHERE rowid = 1')
    if (!versionRow) {
      this.library.run(
        'INSERT INTO schema_version (version) VALUES (?)',
        [1]
      )
    }
    if (this.library.isDirty) await this.library.persist()
    this.startAutosaveTimer()
    this.logger.info('store', 'Library database ready.', this.paths.library)
  }

  async close(): Promise<void> {
    this.stopAutosaveTimer()
    await this.library?.close()
    this.library = null
  }

  getPaths(): AppPaths {
    return this.paths
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  getSettings(): AppSettings {
    return structuredClone(this.settings)
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const merged = normalizeSettings({ ...this.settings, ...patch, shortcuts: { ...this.settings.shortcuts, ...(patch.shortcuts ?? {}) } })
    this.settings = merged
    this.library?.run(
      'INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['app_settings', JSON.stringify(merged)]
    )
    await this.library?.persist()
    this.restartAutosaveTimerIfNeeded()
    return merged
  }

  async setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<AppSettings> {
    return this.saveSettings({ [key]: value } as Partial<AppSettings>)
  }

  // -------------------------------------------------------------------------
  // Recent projects
  // -------------------------------------------------------------------------

  async recentProjects(): Promise<RecentProjectEntry[]> {
    if (!this.library) return []
    const rows = this.library.query<{ path: string; name: string; opened_at: string; pinned: number }>(
      'SELECT path, name, opened_at, pinned FROM recent_projects ORDER BY pinned DESC, opened_at DESC LIMIT ?',
      [Math.max(3, this.settings.recentProjectLimit * 3)]
    )
    return rows.map((row) => ({
      path: row.path,
      name: row.name,
      openedAt: row.opened_at,
      pinned: row.pinned === 1,
      exists: existsSync(row.path)
    }))
  }

  async rememberProject(projectPath: string, name: string): Promise<void> {
    if (!this.library) return
    const rows = this.library.query<{ c: number }>('SELECT COUNT(*) AS c FROM recent_projects')
    this.library.run(
      'INSERT INTO recent_projects (path, name, opened_at, pinned) VALUES (?, ?, ?, 0) ON CONFLICT(path) DO UPDATE SET name = excluded.name, opened_at = excluded.opened_at',
      [projectPath, name, nowIso()]
    )
    await this.library.persist()

    const limit = Math.max(3, this.settings.recentProjectLimit)
    if ((rows[0]?.c ?? 0) > limit) {
      this.library.run(
        `DELETE FROM recent_projects WHERE pinned = 0 AND path NOT IN (
           SELECT path FROM recent_projects ORDER BY pinned DESC, opened_at DESC LIMIT ?
         )`,
        [limit]
      )
      await this.library.persist()
    }
  }

  async forgetRecent(projectPath: string): Promise<void> {
    this.library?.run('DELETE FROM recent_projects WHERE path = ?', [projectPath])
    await this.library?.persist()
  }

  async pinRecent(projectPath: string, pinned: boolean): Promise<void> {
    this.library?.run('UPDATE recent_projects SET pinned = ? WHERE path = ?', [boolToInt(pinned), projectPath])
    await this.library?.persist()
  }

  // -------------------------------------------------------------------------
  // Current project state
  // -------------------------------------------------------------------------

  getCurrent(): CurrentProjectState {
    return this.state
  }

  getProject(): Project {
    return this.state.project
  }

  getProjectPath(): string | null {
    return this.state.projectPath
  }

  isDirty(): boolean {
    return this.state.dirty
  }

  /** Replaces the in-memory project (renderer is authoritative for edits). */
  setProject(project: Project, options: { dirty?: boolean; reason?: string } = {}): void {
    const normalized = {
      ...project,
      schemaVersion: SCHEMA_VERSION,
      meta: { ...project.meta, updatedAt: nowIso() }
    }
    this.state.project = normalized
    if (options.dirty !== false) {
      this.state.dirty = true
      this.emitDirty()
    }
  }

  markClean(projectPath?: string): void {
    this.state.dirty = false
    if (projectPath) this.state.projectPath = projectPath
    this.emitDirty()
  }

  isProjectOpen(): boolean {
    return this.state.projectPath !== null
  }

  // -------------------------------------------------------------------------
  // Create / open / save
  // -------------------------------------------------------------------------

  private async writeProjectFile(target: string, project: Project): Promise<number> {
    const db = await SqliteDb.open(target, { wasmPath: resolveSqlJsWasm(this.paths), schema: PROJECT_SCHEMA })
    try {
      writeProjectInto(db, project)
      db.run('DELETE FROM schema_version')
      db.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION])
      return await db.persist()
    } finally {
      await db.close()
    }
  }

  async createProject(
    request: Omit<NewProjectOptions, 'outputs'> & {
      directory: string
      outputs?: { name: string; width: number; height: number }[]
    }
  ): Promise<OpenProjectResult> {
    const directory = request.directory || this.settings.projectDirectory || this.paths.projects
    await mkdir(directory, { recursive: true })
    const safeName = sanitiseFileName(request.name)
    const target = uniquePath(path.join(directory, `${safeName}.${PROJECT_EXTENSION}`))

    const outputs = request.outputs?.length
      ? request.outputs.map((output) =>
          createDefaultOutput({ name: output.name, width: output.width, height: output.height })
        )
      : undefined

    const project = createDefaultProject({
      name: request.name,
      author: request.author ?? '',
      stageWidthMm: request.stageWidthMm,
      stageHeightMm: request.stageHeightMm,
      defaultUnit: request.defaultUnit,
      backgroundAssetPath: request.backgroundAssetPath ?? null,
      initialScreenCount: request.initialScreenCount ?? 0,
      ...(outputs ? { outputs } : {})
    })
    const bytes = await this.writeProjectFile(target, project)

    this.state = {
      project,
      projectPath: target,
      dirty: false,
      lastSavedAt: nowIso(),
      autosaveAt: null
    }
    await this.library?.run(
      'INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['last_project', target]
    )
    await this.library?.persist()
    await this.rememberProject(target, project.meta.name)
    this.emitDirty()
    this.logger.info('store', `Created project "${project.meta.name}".`, `${target} (${bytes} bytes)`)

    return {
      path: target,
      directory: path.dirname(target),
      migrations: [],
      missingAssets: [],
      backupPath: null
    }
  }

  async openProject(projectPath: string): Promise<OpenProjectResult & { project: Project; bytes: number }> {
    const resolved = path.resolve(projectPath)
    if (!existsSync(resolved)) {
      throw new AppError('E_NOT_FOUND', `The project file "${resolved}" could not be found.`, {
        hint: 'Use Home → Recent Projects to locate it, or open a recovery snapshot.'
      })
    }

    const db = await SqliteDb.open(resolved, {
      wasmPath: resolveSqlJsWasm(this.paths),
      schema: PROJECT_SCHEMA,
      writable: false
    })
    let raw: unknown
    try {
      raw = readProjectFrom(db)
    } finally {
      await db.close()
    }

    const { project, migrations } = migrateProject(raw)
    const missingAssets = this.findMissingAssets(project)
    // Flag the background so the canvas can show a placeholder instead of a broken image.
    project.stage.background.assetMissing = missingAssets.length > 0

    this.state = {
      project,
      projectPath: resolved,
      dirty: false,
      lastSavedAt: nowIso(),
      autosaveAt: null
    }
    this.lastAutosaveAttempt = Date.now()

    await this.rememberProject(resolved, project.meta.name)
    this.library?.run(
      'INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['last_project', resolved]
    )
    await this.library?.persist()
    this.emitDirty()

    if (migrations.length) {
      this.logger.info('store', 'Project migrated.', migrations.join(' '))
      this.state.dirty = true
      this.emitDirty()
    }
    if (missingAssets.length) {
      this.events.onWarning?.(
        `${missingAssets.length} linked asset(s) could not be found.`,
        missingAssets.join('\n')
      )
    }

    const bytes = await stat(resolved).then((s) => s.size).catch(() => 0)
    return {
      path: resolved,
      directory: path.dirname(resolved),
      migrations,
      missingAssets,
      backupPath: null,
      project,
      bytes
    }
  }

  /** Saves the current project. `backup` keeps a rolling copy of the previous file. */
  async saveCurrent(reason: 'manual' | 'autosave' | 'restore' | 'close' = 'manual'): Promise<SaveProjectResult | null> {
    if (!this.state.projectPath) return null
    const target = this.state.projectPath
    const validation = validateProject(this.state.project)
    if (!validation.ok) {
      this.logger.warn(
        'store',
        `Project saved with ${validation.errors.length} validation error(s).`,
        validation.errors.join(' | ')
      )
    }

    const backupPath = `${target}.bak`
    let bytes = 0
    const db = await SqliteDb.open(target, {
      wasmPath: resolveSqlJsWasm(this.paths),
      schema: PROJECT_SCHEMA
    })
    try {
      writeProjectInto(db, this.state.project)
      db.run('DELETE FROM schema_version')
      db.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION])
      bytes = await db.persist({ backup: true, backupPath })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOSPC') {
        throw new AppError('E_DISK_FULL', 'The project could not be saved because the disk is full.', {
          hint: 'Free up disk space, then choose File → Save again. Your changes are still in memory.'
        })
      }
      throw error
    } finally {
      await db.close()
    }

    const savedAt = nowIso()
    this.state.lastSavedAt = savedAt
    this.state.dirty = false
    if (reason === 'autosave') this.state.autosaveAt = savedAt
    this.lastAutosaveAttempt = Date.now()

    await this.rememberProject(target, this.state.project.meta.name)
    if (reason !== 'manual') {
      await this.createSnapshot(reason === 'autosave' ? 'autosave' : 'manual', target)
    }
    this.emitDirty()

    const result: SaveProjectResult = {
      path: target,
      bytes,
      savedAt,
      backupPath: existsSync(backupPath) ? backupPath : null,
      screenCount: this.state.project.screens.length
    }
    this.events.onProjectSaved?.(result)
    return result
  }

  async saveAs(directory: string, name?: string): Promise<SaveProjectResult> {
    const dir = directory || (this.state.projectPath ? path.dirname(this.state.projectPath) : this.paths.projects)
    await mkdir(dir, { recursive: true })
    const projectName = name ?? this.state.project.meta.name
    const target = uniquePath(path.join(dir, `${sanitiseFileName(projectName)}.${PROJECT_EXTENSION}`))

    // Copy the existing file first so the new file keeps a valid SQLite header even if
    // the write below is interrupted.
    if (this.state.projectPath && existsSync(this.state.projectPath)) {
      await copyFile(this.state.projectPath, target).catch(() => undefined)
    }

    this.state.projectPath = target
    this.state.project.meta.name = projectName
    const result = await this.saveCurrent('manual')
    if (!result) throw new AppError('E_IO', 'Save As failed: no target path was resolved.')
    this.logger.info('store', `Project saved as "${projectName}".`, target)
    return result
  }

  async renameProject(newName: string): Promise<Project> {
    const trimmed = newName.trim()
    if (!trimmed) throw new AppError('E_INVALID_INPUT', 'Project name cannot be empty.')
    this.state.project.meta.name = trimmed
    this.state.project.meta.updatedAt = nowIso()
    this.state.dirty = true
    this.emitDirty()
    if (this.state.projectPath) await this.rememberProject(this.state.projectPath, trimmed)
    return this.state.project
  }

  async duplicateProject(sourcePath: string, newName?: string): Promise<OpenProjectResult & { project: Project }> {
    const opened = await this.openProject(sourcePath)
    const project = opened.project
    project.meta.id = `${project.meta.id}-copy-${Date.now().toString(36)}`
    project.meta.name = newName?.trim() || `${project.meta.name} copy`
    project.meta.createdAt = nowIso()
    const directory = path.dirname(sourcePath)
    const target = uniquePath(path.join(directory, `${sanitiseFileName(project.meta.name)}.${PROJECT_EXTENSION}`))
    await this.writeProjectFile(target, project)
    return { ...opened, path: target, project }
  }

  // -------------------------------------------------------------------------
  // Recovery snapshots
  // -------------------------------------------------------------------------

  private get recoveryDirectory(): string {
    return path.join(this.paths.userData, 'recovery')
  }

  async createSnapshot(
    reason: RecoverySnapshot['reason'],
    projectPath?: string | null
  ): Promise<RecoverySnapshot | null> {
    const sourcePath = projectPath ?? this.state.projectPath
    if (!sourcePath || !this.library) return null
    if (!existsSync(sourcePath)) return null

    await mkdir(this.recoveryDirectory, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = path.basename(sourcePath, `.${PROJECT_EXTENSION}`)
    const snapshotPath = path.join(this.recoveryDirectory, `${base}_${reason}_${stamp}.${PROJECT_EXTENSION}`)
    await copyFile(sourcePath, snapshotPath)
    const bytes = (await stat(snapshotPath)).size

    this.library.run(
      `INSERT INTO recovery_snapshots (project_path, snapshot_path, name, created_at, reason, bytes, screen_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sourcePath,
        snapshotPath,
        this.state.project.meta.name,
        nowIso(),
        reason,
        bytes,
        this.state.project.screens.length
      ]
    )
    await this.library.persist()

    const retention = Math.max(1, this.settings.backupRetention)
    const rows = this.library.query<{ id: number; snapshot_path: string }>(
      'SELECT id, snapshot_path FROM recovery_snapshots WHERE project_path = ? ORDER BY created_at DESC',
      [sourcePath]
    )
    for (const row of rows.slice(retention)) {
      await unlink(row.snapshot_path).catch(() => undefined)
      this.library.run('DELETE FROM recovery_snapshots WHERE id = ?', [row.id])
    }
    if (rows.length > retention) await this.library.persist()

    return {
      id: 0,
      path: snapshotPath,
      projectPath: sourcePath,
      name: this.state.project.meta.name,
      createdAt: nowIso(),
      reason,
      bytes,
      screenCount: this.state.project.screens.length
    }
  }

  async snapshots(projectPath?: string): Promise<RecoverySnapshot[]> {
    if (!this.library) return []
    const rows = this.library.query<{
      id: number
      project_path: string
      snapshot_path: string
      name: string
      created_at: string
      reason: string
      bytes: number
      screen_count: number
    }>(
      projectPath
        ? 'SELECT * FROM recovery_snapshots WHERE project_path = ? ORDER BY created_at DESC'
        : 'SELECT * FROM recovery_snapshots ORDER BY created_at DESC LIMIT 200',
      projectPath ? [projectPath] : []
    )
    return rows
      .filter((row) => existsSync(row.snapshot_path))
      .map((row) => ({
        id: row.id,
        path: row.snapshot_path,
        projectPath: row.project_path,
        name: row.name,
        createdAt: row.created_at,
        reason: (row.reason as RecoverySnapshot['reason']) ?? 'manual',
        bytes: row.bytes,
        screenCount: row.screen_count
      }))
  }

  async deleteSnapshot(id: number): Promise<boolean> {
    if (!this.library) return false
    const row = this.library.one<{ snapshot_path: string }>(
      'SELECT snapshot_path FROM recovery_snapshots WHERE id = ?',
      [id]
    )
    if (!row) return false
    await unlink(row.snapshot_path).catch(() => undefined)
    this.library.run('DELETE FROM recovery_snapshots WHERE id = ?', [id])
    await this.library.persist()
    return true
  }

  // -------------------------------------------------------------------------
  // Recording history (library)
  // -------------------------------------------------------------------------

  recordingEntries(): RecordingEntry[] {
    if (!this.library) return []
    const rows = this.library.query<{
      id: string
      file_path: string
      target: string
      label: string
      width: number
      height: number
      fps: number
      container: string
      started_at: string
      finished_at: string | null
      duration_ms: number
      size_bytes: number
      state: string
      error: string | null
      verification_json: string | null
    }>('SELECT * FROM recordings ORDER BY started_at DESC LIMIT 200')
    return rows.map((row) => ({
      id: row.id,
      filePath: row.file_path,
      target: row.target as RecordingEntry['target'],
      label: row.label,
      width: row.width,
      height: row.height,
      fps: row.fps,
      container: row.container as RecordingEntry['container'],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      sizeBytes: row.size_bytes,
      state: row.state as RecordingEntry['state'],
      error: row.error,
      verified: row.verification_json ? (JSON.parse(row.verification_json) as RecordingEntry['verified']) : null
    }))
  }

  async upsertRecordingEntry(entry: RecordingEntry): Promise<void> {
    this.library?.run(
      `INSERT INTO recordings (id, file_path, target, label, width, height, fps, container, started_at, finished_at, duration_ms, size_bytes, state, error, verification_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET file_path = excluded.file_path, target = excluded.target, label = excluded.label,
         width = excluded.width, height = excluded.height, fps = excluded.fps, container = excluded.container,
         finished_at = excluded.finished_at, duration_ms = excluded.duration_ms, size_bytes = excluded.size_bytes,
         state = excluded.state, error = excluded.error, verification_json = excluded.verification_json`,
      [
        entry.id,
        entry.filePath,
        entry.target,
        entry.label,
        entry.width,
        entry.height,
        entry.fps,
        entry.container,
        entry.startedAt,
        entry.finishedAt,
        Math.round(entry.durationMs),
        Math.round(entry.sizeBytes),
        entry.state,
        entry.error,
        entry.verified ? JSON.stringify(entry.verified) : null
      ]
    )
    await this.library?.persist()
  }

  async deleteRecordingEntry(id: string): Promise<boolean> {
    if (!this.library) return false
    this.library.run('DELETE FROM recordings WHERE id = ?', [id])
    await this.library.persist()
    return true
  }

  // -------------------------------------------------------------------------
  // Autosave
  // -------------------------------------------------------------------------

  private startAutosaveTimer(): void {
    this.stopAutosaveTimer()
    if (!this.settings.autosaveEnabled) return
    const interval = Math.max(5_000, this.settings.autosaveIntervalMs)
    this.autosaveTimer = setInterval(() => {
      void this.runAutosave()
    }, interval)
    this.autosaveTimer.unref?.()
  }

  private stopAutosaveTimer(): void {
    if (this.autosaveTimer) clearInterval(this.autosaveTimer)
    this.autosaveTimer = null
  }

  private restartAutosaveTimerIfNeeded(): void {
    this.startAutosaveTimer()
  }

  /**
   * Autosave runs entirely in the main process against its own copy of the project,
   * so it never blocks the renderer canvas. Requires an open project *and* changes.
   */
  async runAutosave(): Promise<SaveProjectResult | null> {
    if (!this.settings.autosaveEnabled) return null
    if (!this.state.projectPath || !this.state.dirty) return null
    if (Date.now() - this.lastAutosaveAttempt < 2_000) return null
    try {
      const result = await this.saveCurrent('autosave')
      this.logger.debug('store', 'Autosave completed.', `${result?.bytes ?? 0} bytes`)
      return result
    } catch (error) {
      this.logger.error('store', 'Autosave failed.', String(error))
      this.events.onWarning?.(
        'Autosave failed. Your project is still open and unsaved changes are preserved in memory.',
        String(error)
      )
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private emitDirty(): void {
    this.events.onDirtyState?.({
      dirty: this.state.dirty,
      savedAt: this.state.lastSavedAt,
      autosaveAt: this.state.autosaveAt,
      path: this.state.projectPath
    })
  }

  findMissingAssets(project: Project): string[] {
    const missing: string[] = []
    const background = project.stage.background.assetPath
    if (background && !existsSync(background)) missing.push(background)
    return missing
  }

  summary(): ProjectSummary | null {
    if (!this.state.projectPath) return null
    const summary = projectSummary(this.state.project, this.state.projectPath, 0)
    summary.exists = existsSync(this.state.projectPath)
    summary.missingAssets = this.findMissingAssets(this.state.project).length
    return summary
  }

  async libraryStats(): Promise<{ bytes: number; recent: number; snapshots: number }> {
    const bytes = this.library ? await this.library.fileBytes() : 0
    const recent = this.library?.scalar<number>('SELECT COUNT(*) FROM recent_projects') ?? 0
    const snapshots = this.library?.scalar<number>('SELECT COUNT(*) FROM recovery_snapshots') ?? 0
    return { bytes, recent: Number(recent), snapshots: Number(snapshots) }
  }

  async writeTextExport(directory: string, fileName: string, contents: string): Promise<string> {
    await mkdir(directory, { recursive: true })
    const target = path.join(directory, fileName)
    await writeFile(target, contents, 'utf8')
    return target
  }

  async cleanupTemporaryFiles(): Promise<void> {
    try {
      const files = await readdir(this.paths.tmp)
      for (const file of files) {
        await unlink(path.join(this.paths.tmp, file)).catch(() => undefined)
      }
    } catch {
      // Best effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Row serialisation
// ---------------------------------------------------------------------------

export function writeProjectInto(db: SqliteDb, project: Project): void {
  db.transaction(() => {
    db.run('DELETE FROM screens')
    db.run('DELETE FROM screen_groups')
    db.run('DELETE FROM outputs')
    db.run('DELETE FROM stage')
    db.run('DELETE FROM project_meta')
    db.run('DELETE FROM project_settings')

    db.run(
      'INSERT INTO project_meta (id, name, author, created_at, updated_at, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [
        project.meta.id,
        project.meta.name,
        project.meta.author,
        project.meta.createdAt,
        project.meta.updatedAt,
        project.meta.notes
      ]
    )

    db.run(
      `INSERT INTO stage (id, name, width_mm, height_mm, canvas_px_per_meter, default_unit, grid_visible,
        grid_spacing_mm, grid_major_every, grid_subdivisions, snap_to_grid, snap_to_screens, snap_to_stage,
        snap_tolerance_px, guides_visible, rulers_visible, background_json)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project.stage.name,
        project.stage.widthMm,
        project.stage.heightMm,
        project.stage.canvasPxPerMeter,
        project.stage.defaultUnit,
        boolToInt(project.stage.gridVisible),
        project.stage.gridSpacingMm,
        project.stage.gridMajorEvery,
        project.stage.gridSubdivisions,
        boolToInt(project.stage.snapToGrid),
        boolToInt(project.stage.snapToScreens),
        boolToInt(project.stage.snapToStage),
        project.stage.snapTolerancePx,
        boolToInt(project.stage.guidesVisible),
        boolToInt(project.stage.rulersVisible),
        JSON.stringify(project.stage.background)
      ]
    )

    for (const screen of project.screens) {
      db.run(
        `INSERT INTO screens (id, name, type, color, visible, locked, notes, sort_order, group_id, x_mm, y_mm,
          width_mm, height_mm, rotation_deg, pixel_width, pixel_height, pixel_pitch_mm, map_output_id, map_x, map_y,
          map_width, map_height, map_auto_region, map_export_visible, map_scale, map_offset_x, map_offset_y, map_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          screen.id,
          screen.name,
          screen.type,
          screen.color,
          boolToInt(screen.visible),
          boolToInt(screen.locked),
          screen.notes,
          screen.order,
          screen.groupId,
          screen.xMm,
          screen.yMm,
          screen.widthMm,
          screen.heightMm,
          screen.rotationDeg,
          Math.round(screen.pixelWidth),
          Math.round(screen.pixelHeight),
          screen.pixelPitchMm,
          screen.mapping.outputId,
          screen.mapping.region.x,
          screen.mapping.region.y,
          screen.mapping.region.width,
          screen.mapping.region.height,
          boolToInt(screen.mapping.autoRegion),
          boolToInt(screen.mapping.exportVisible),
          screen.mapping.scale,
          screen.mapping.offsetXPx,
          screen.mapping.offsetYPx,
          screen.mapping.notes
        ]
      )
    }

    for (const group of project.groups) {
      db.run(
        'INSERT INTO screen_groups (id, name, color, visible, locked, collapsed) VALUES (?, ?, ?, ?, ?, ?)',
        [
          group.id,
          group.name,
          group.color,
          boolToInt(group.visible),
          boolToInt(group.locked),
          boolToInt(group.collapsed)
        ]
      )
    }

    for (const output of project.outputs) {
      db.run('INSERT INTO outputs (id, name, width, height, enabled, notes) VALUES (?, ?, ?, ?, ?, ?)', [
        output.id,
        output.name,
        Math.round(output.width),
        Math.round(output.height),
        boolToInt(output.enabled),
        output.notes
      ])
    }

    db.run(
      'INSERT INTO project_settings (id, autosave_enabled, autosave_interval_ms, backup_retention, export_directory) VALUES (1, ?, ?, ?, ?)',
      [
        boolToInt(project.settings.autosaveEnabled),
        project.settings.autosaveIntervalMs,
        project.settings.backupRetention,
        project.settings.exportDirectory
      ]
    )
  })
}

/** Reads a project database into a plain payload for `migrateProject`. */
export function readProjectFrom(db: SqliteDb): unknown {
  const meta = db.one<MetaRow>('SELECT * FROM project_meta LIMIT 1')
  const stage = db.one<Record<string, SqlValue>>('SELECT * FROM stage WHERE id = 1')
  const screenRows = db.query<ScreenRow>('SELECT * FROM screens ORDER BY sort_order ASC')
  const groupRows = db.query<Record<string, SqlValue>>('SELECT * FROM screen_groups')
  const outputRows = db.query<Record<string, SqlValue>>('SELECT * FROM outputs')
  const settingsRows = db.query<Record<string, SqlValue>>('SELECT * FROM project_settings WHERE id = 1')
  const version = db.scalar<number>('SELECT version FROM schema_version LIMIT 1')

  const screens: Screen[] = screenRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as Screen['type'],
    color: row.color,
    visible: row.visible === 1,
    locked: row.locked === 1,
    notes: toText(row.notes),
    order: toInt(row.sort_order),
    groupId: row.group_id ?? null,
    xMm: toInt(row.x_mm),
    yMm: toInt(row.y_mm),
    widthMm: toInt(row.width_mm, 2000),
    heightMm: toInt(row.height_mm, 1000),
    rotationDeg: toInt(row.rotation_deg),
    pixelWidth: Math.round(toInt(row.pixel_width, 800)),
    pixelHeight: Math.round(toInt(row.pixel_height, 400)),
    pixelPitchMm: typeof row.pixel_pitch_mm === 'number' ? row.pixel_pitch_mm : null,
    mapping: {
      outputId: row.map_output_id ?? null,
      region: {
        x: toInt(row.map_x),
        y: toInt(row.map_y),
        width: toInt(row.map_width, 800),
        height: toInt(row.map_height, 400)
      },
      autoRegion: row.map_auto_region === 1,
      exportVisible: row.map_export_visible === 1,
      scale: toInt(row.map_scale, 1),
      offsetXPx: toInt(row.map_offset_x),
      offsetYPx: toInt(row.map_offset_y),
      notes: toText(row.map_notes)
    }
  }))

  const settings = settingsRows[0]

  return {
    schemaVersion: typeof version === 'number' ? version : 1,
    meta: meta
      ? {
          id: toText(meta.id),
          name: toText(meta.name, 'Untitled Project'),
          author: toText(meta.author),
          createdAt: toText(meta.created_at, nowIso()),
          updatedAt: toText(meta.updated_at, nowIso()),
          notes: toText(meta.notes)
        }
      : undefined,
    stage: stage
      ? {
          name: toText(stage.name, 'Main Stage'),
          widthMm: toInt(stage.width_mm, 12_000),
          heightMm: toInt(stage.height_mm, 6_000),
          canvasPxPerMeter: toInt(stage.canvas_px_per_meter, 40),
          defaultUnit: toText(stage.default_unit, 'm'),
          gridVisible: toInt(stage.grid_visible, 1) === 1,
          gridSpacingMm: toInt(stage.grid_spacing_mm, 500),
          gridMajorEvery: toInt(stage.grid_major_every, 4),
          gridSubdivisions: toInt(stage.grid_subdivisions, 4),
          snapToGrid: toInt(stage.snap_to_grid, 1) === 1,
          snapToScreens: toInt(stage.snap_to_screens, 1) === 1,
          snapToStage: toInt(stage.snap_to_stage, 1) === 1,
          snapTolerancePx: toInt(stage.snap_tolerance_px, 8),
          guidesVisible: toInt(stage.guides_visible, 1) === 1,
          rulersVisible: toInt(stage.rulers_visible, 1) === 1,
          background: safeJsonParse(toText(stage.background_json, '{}'), {})
        }
      : undefined,
    screens,
    groups: groupRows.map((row) => ({
      id: toText(row.id),
      name: toText(row.name),
      color: toText(row.color, '#4c8dff'),
      visible: toInt(row.visible, 1) === 1,
      locked: toInt(row.locked) === 1,
      collapsed: toInt(row.collapsed) === 1
    })),
    outputs: outputRows.map((row) => ({
      id: toText(row.id),
      name: toText(row.name, 'Output'),
      width: Math.round(toInt(row.width, 1920)),
      height: Math.round(toInt(row.height, 1080)),
      enabled: toInt(row.enabled, 1) === 1,
      notes: toText(row.notes)
    })),
    settings: settings
      ? {
          autosaveEnabled: toInt(settings.autosave_enabled, 1) === 1,
          autosaveIntervalMs: toInt(settings.autosave_interval_ms, 30_000),
          backupRetention: toInt(settings.backup_retention, 10),
          exportDirectory: typeof settings.export_directory === 'string' ? settings.export_directory : null
        }
      : undefined
  }
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function sanitiseFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
  return cleaned.slice(0, 80) || 'Untitled Project'
}

export function uniquePath(candidate: string): string {
  if (!existsSync(candidate)) return candidate
  const dir = path.dirname(candidate)
  const ext = path.extname(candidate)
  const base = path.basename(candidate, ext)
  for (let i = 2; i < 500; i += 1) {
    const next = path.join(dir, `${base} (${i})${ext}`)
    if (!existsSync(next)) return next
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

export type { SqlParam }
