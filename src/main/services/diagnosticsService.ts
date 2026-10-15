import { stat, statfs } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type { DiagnosticReport, LogEntry } from '@shared/appTypes'
import type { Project } from '@shared/types'
import { buildMappingPlan, issuesByLevel } from '@shared/mapping'
import { validateProject } from '@shared/validation'
import type { AppPaths } from './paths'
import type { ProjectStore } from './projectStore'
import type { NdiManager } from './ndiManager'
import type { RecordingService } from './recordingService'
import { getLogger } from './logger'

export interface DiagnosticsDependencies {
  paths: AppPaths
  store: ProjectStore
  ndi: NdiManager
  recording: RecordingService
  appVersion: string
}

/**
 * Collects the diagnostics dashboard payload.
 *
 * Only operational facts are gathered: versions, paths, free space, NDI state and
 * recent log entries. No project content, file contents or credentials are included,
 * so the report is safe to share.
 */
export class DiagnosticsService {
  private deps: DiagnosticsDependencies

  constructor(deps: DiagnosticsDependencies) {
    this.deps = deps
  }

  async report(): Promise<DiagnosticReport> {
    const { paths, store, ndi, recording } = this.deps
    const logger = getLogger()
    const project: Project = store.getProject()
    const mappingPlan = buildMappingPlan(project)
    const validation = validateProject(project)
    const counts = issuesByLevel(mappingPlan)
    const recordingStatus = recording.getStatus()
    const recentProjectPath = store.getProjectPath()
    const libraryStats = await store.libraryStats()

    let projectBytes: number | null = null
    if (recentProjectPath) {
      try {
        projectBytes = (await stat(recentProjectPath)).size
      } catch {
        projectBytes = 0
      }
    }

    const recordingDirectory = recording.getOutputDirectory(store.getSettings().recording)
    // Mirrors the export service: a chosen folder wins, then the project's own `Exports` folder,
    // then the app-data fallback for projects that were never saved.
    const projectPath = store.getProjectPath()
    const exportDirectory =
      store.getSettings().export.directory ??
      (projectPath ? path.join(path.dirname(projectPath), 'Exports') : paths.exports)

    return {
      generatedAt: new Date().toISOString(),
      app: {
        name: 'CuePoint',
        version: this.deps.appVersion,
        packaged: app.isPackaged,
        locale: app.getLocale()
      },
      runtime: {
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node,
        v8: process.versions.v8 ?? 'unknown',
        os: `${os.type()} ${os.release()}`,
        arch: process.arch
      },
      hardware: {
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        cpuCount: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
        appMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },
      paths: {
        userData: paths.userData,
        logs: paths.logs,
        libraryDatabase: paths.library,
        projectDirectory: recentProjectPath ? path.dirname(recentProjectPath) : null,
        exportDirectory,
        recordingDirectory
      },
      database: {
        libraryPath: paths.library,
        libraryBytes: libraryStats.bytes,
        librarySchema: 1,
        projectPath: recentProjectPath,
        projectBytes,
        projectSchema: recentProjectPath ? project.schemaVersion : null,
        recentProjects: libraryStats.recent
      },
      storage: {
        exportDrive: path.parse(exportDirectory).root || null,
        exportFreeBytes: await freeSpace(exportDirectory),
        recordingDrive: path.parse(recordingDirectory).root || null,
        recordingFreeBytes: await freeSpace(recordingDirectory)
      },
      ndi: ndi.getStatus(),
      ndiSources: ndi.getStats(),
      recording: {
        state: recordingStatus.state,
        lastFile: recordingStatus.entry?.filePath ?? null,
        lastVerified: recordingStatus.entry?.verified ?? null,
        encoderAvailable: recordingStatus.encoder.available,
        encoderDetail: recordingStatus.encoder.detail
      },
      project: {
        path: recentProjectPath,
        screens: project.screens.length,
        outputs: project.outputs.length,
        validationErrors: validation.errors,
        mappingIssues: counts
      },
      logs: {
        recentWarnings: logger
          .recent(25, 'warn')
          .map((entry) => `${entry.ts} [${entry.scope}] ${entry.message}`),
        recentErrors: logger
          .recent(25, 'error')
          .map((entry) => `${entry.ts} [${entry.scope}] ${entry.message}`)
      }
    }
  }

  logs(query: { limit?: number; level?: LogEntry['level']; scope?: string } = {}): LogEntry[] {
    return getLogger().recent(
      Math.min(Math.max(query.limit ?? 200, 1), 500),
      query.level,
      query.scope
    )
  }

  clearLogs(): boolean {
    const logger = getLogger()
    logger.info('diagnostics', 'The in-memory log buffer was cleared by the operator.')
    return true
  }

  /** Plain-text report used by Help → Copy diagnostic report. */
  async reportText(): Promise<string> {
    const report = await this.report()
    const lines: string[] = [
      `${report.app.name} ${report.app.version} diagnostic report`,
      `Generated: ${report.generatedAt}`,
      '',
      'Runtime',
      `  Electron ${report.runtime.electron} (Chromium ${report.runtime.chrome}, Node ${report.runtime.node})`,
      `  OS ${report.runtime.os} ${report.runtime.arch} · packaged: ${report.app.packaged}`,
      `  CPU ${report.hardware.cpuModel} (${report.hardware.cpuCount} logical cores)`,
      `  Memory ${report.hardware.appMemoryMb} MB used by CuePoint of ${report.hardware.totalMemoryMb} MB total`,
      '',
      'Storage',
      `  User data: ${report.paths.userData}`,
      `  Library:   ${report.paths.libraryDatabase} (${report.database.libraryBytes} bytes)`,
      `  Project:   ${report.database.projectPath ?? 'none open'}`,
      `  Exports:   ${report.paths.exportDirectory} (free ${formatBytes(report.storage.exportFreeBytes)})`,
      `  Recording: ${report.paths.recordingDirectory} (free ${formatBytes(report.storage.recordingFreeBytes)})`,
      '',
      'NDI',
      `  Runtime available: ${report.ndi.available}`,
      `  Library: ${report.ndi.dllPath ?? 'not found'}`,
      `  Version: ${report.ndi.runtimeVersion ?? 'unknown'}`,
      `  Helper running: ${report.ndi.helperRunning} (pid ${report.ndi.helperPid ?? 'n/a'}, restarts ${report.ndi.restartCount})`,
      `  Reason: ${report.ndi.reason ?? 'none'}`,
      ...report.ndiSources.map(
        (source) =>
          `  Source "${source.name}": ${source.connected ? 'connected' : 'not connected'}, ${source.width}x${source.height}, recv ${source.receivedFps} fps, rendered ${source.renderedFps} fps, age ${source.frameAgeMs} ms, dropped ${source.droppedFrames}, skipped ${source.skippedFrames}`
      ),
      '',
      'Recording',
      `  State: ${report.recording.state}`,
      `  Last file: ${report.recording.lastFile ?? 'none'}`,
      `  Encoder: ${report.recording.encoderDetail}`,
      `  Verification: ${report.recording.lastVerified?.detail ?? 'no recording verified yet'}`,
      '',
      'Project',
      `  Screens: ${report.project.screens} · Outputs: ${report.project.outputs}`,
      `  Validation errors: ${report.project.validationErrors.length}`,
      `  Mapping issues: ${report.project.mappingIssues.error} error(s), ${report.project.mappingIssues.warning} warning(s), ${report.project.mappingIssues.info} info`,
      ...report.project.validationErrors.map((error) => `    ! ${error}`),
      '',
      'Recent warnings',
      ...(report.logs.recentWarnings.length
        ? report.logs.recentWarnings.map((line) => `  ${line}`)
        : ['  none']),
      '',
      'Recent errors',
      ...(report.logs.recentErrors.length
        ? report.logs.recentErrors.map((line) => `  ${line}`)
        : ['  none'])
    ]
    return lines.join('\n')
  }
}

async function freeSpace(target: string): Promise<number | null> {
  try {
    const stats = await statfs(target)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}
