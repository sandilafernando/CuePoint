import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ExportArtifact,
  ExportKind,
  ExportReport,
  ExportRequest,
  ExportSettings
} from '@shared/appTypes'
import type { ExportPreview, PreviewRequest } from '@shared/ipc'
import type { Project } from '@shared/types'
import {
  buildCombinedMapPlan,
  buildMappingPlan,
  buildStageLayoutPlan,
  type CombinedMapPlan,
  type MappingPlan
} from '@shared/mapping'
import {
  renderCombinedMap,
  renderOutputMap,
  renderScreenGuide,
  renderStageLayout,
  type MapRenderOptions
} from '@shared/raster/render'
import { encodePng } from './pngEncoder'
import { AppError } from './errors'
import type { AppPaths } from './paths'
import type { ProjectStore } from './projectStore'
import type { Logger } from './logger'
import { projectToCsv, projectToMappingJson, suggestedExportName } from '@shared/exportFormats'
import { resampleImage, type RgbaImage } from '@shared/raster/draw'

/** Hard ceiling on a single rendered image, to protect memory. */
const MAX_EXPORT_PIXELS = 80_000_000

export interface ExportContext {
  project: Project
  plan: MappingPlan
  settings: ExportSettings
}

export class ExportService {
  private paths: AppPaths
  private store: ProjectStore
  private logger: Logger

  constructor(paths: AppPaths, store: ProjectStore, logger: Logger) {
    this.paths = paths
    this.store = store
    this.logger = logger
  }

  private context(overrides?: Partial<ExportSettings>): ExportContext {
    const project = this.store.getProject()
    const settings = { ...this.store.getSettings().export, ...(overrides ?? {}) }
    return { project, plan: buildMappingPlan(project), settings }
  }

  private mapOptions(context: ExportContext): MapRenderOptions {
    return {
      showLabels: context.settings.includeLabels,
      showGrid: context.settings.includeGrid,
      showBorders: context.settings.includeBorders
    }
  }

  private defaultDirectory(): string {
    const settings = this.store.getSettings()
    if (settings.export.directory) return settings.export.directory
    if (this.store.getProject().settings.exportDirectory) {
      return this.store.getProject().settings.exportDirectory as string
    }
    // The Export panel promises exports "next to the project file", so a saved project gets
    // its own `Exports` folder beside it. The app-data folder is only the fallback for a
    // project that has never been written to disk.
    const projectPath = this.store.getProjectPath()
    return projectPath ? path.join(path.dirname(projectPath), 'Exports') : this.paths.exports
  }

  async run(request: ExportRequest): Promise<ExportReport> {
    const startedAt = new Date().toISOString()
    const context = this.context(request.options)
    const { project, plan, settings } = context
    const warnings: string[] = []
    const artifacts: ExportArtifact[] = []

    const rootDirectory = request.directory ?? this.defaultDirectory()
    const runDirectory = path.join(
      rootDirectory,
      suggestedExportName(project.meta.name, 'export', 'folder').replace(/\.folder$/, '')
    )
    await mkdir(runDirectory, { recursive: true })

    const baseName = sanitiseBase(project.meta.name)
    const kinds: ExportKind[] = request.kinds.length
      ? request.kinds
      : ['combined-map', 'output-map', 'csv', 'json']
    const renderOptions = this.mapOptions(context)

    const outputPlans = request.outputIds?.length
      ? plan.outputs.filter((outputPlan) => request.outputIds!.includes(outputPlan.output.id))
      : plan.outputs
    const screenIds = request.screenIds?.length ? new Set(request.screenIds) : null

    const writeImage = async (
      kind: ExportKind,
      label: string,
      fileName: string,
      image: RgbaImage
    ): Promise<void> => {
      const pixels = image.width * image.height
      if (pixels > MAX_EXPORT_PIXELS) {
        warnings.push(
          `Skipped ${label}: ${image.width} × ${image.height} exceeds the ${MAX_EXPORT_PIXELS.toLocaleString()} pixel export limit. Reduce the output resolution or export per output.`
        )
        return
      }
      const target = path.join(runDirectory, fileName)
      const buffer = encodePng(image)
      await writeFile(target, buffer)
      artifacts.push({
        kind,
        label,
        path: target,
        bytes: buffer.length,
        width: image.width,
        height: image.height
      })
    }

    if (kinds.includes('combined-map')) {
      const combined = buildCombinedMapPlan(project, plan)
      if (combined.blocks.length === 0) {
        warnings.push('The combined pixel map is empty because no screen is mapped to an output.')
      }
      await writeImage(
        'combined-map',
        'Combined pixel map',
        `${baseName}_combined-map.png`,
        renderCombinedMap(combined, renderOptions)
      )
    }

    if (kinds.includes('output-map')) {
      for (const outputPlan of outputPlans) {
        await writeImage(
          'output-map',
          `Output map — ${outputPlan.output.name}`,
          `${baseName}_output_${sanitiseBase(outputPlan.output.name)}.png`,
          renderOutputMap(outputPlan, renderOptions)
        )
      }
    }

    if (kinds.includes('screen-guide')) {
      const screens = screenIds
        ? project.screens.filter((screen) => screenIds.has(screen.id))
        : project.screens
      for (const screen of screens) {
        if (settings.perScreenGuides === false && !screenIds) continue
        await writeImage(
          'screen-guide',
          `Screen guide — ${screen.name}`,
          `${baseName}_screen_${sanitiseBase(screen.name)}.png`,
          renderScreenGuide(project, screen, {
            showGrid: settings.includeGrid,
            subtitle: `PROJECT ${project.meta.name}`,
            safeAreaPercent: 10
          })
        )
      }
    }

    if (kinds.includes('stage-layout') || settings.stageLayout) {
      const layoutPlan = buildStageLayoutPlan(project, 250)
      const pxPerMeter = Math.min(240, Math.max(4, 2048 / Math.max(layoutPlan.bounds.width / 1000, 0.001)))
      await writeImage(
        'stage-layout',
        'Stage layout',
        `${baseName}_stage-layout.png`,
        renderStageLayout(project, layoutPlan, {
          pxPerMeter,
          showGrid: settings.includeGrid,
          showLabels: settings.includeLabels
        })
      )
    }

    if (kinds.includes('csv')) {
      const csv = projectToCsv(project, plan, settings.csvDelimiter)
      const target = path.join(runDirectory, `${baseName}_mapping.csv`)
      await writeFile(target, csv, 'utf8')
      const bytes = (await stat(target)).size
      artifacts.push({ kind: 'csv', label: 'Mapping table (CSV)', path: target, bytes })
    }

    if (kinds.includes('json')) {
      const json = projectToMappingJson(project, plan, {
        appVersion: this.appVersion(),
        includeIssueDetails: true,
        jsonIndent: settings.jsonIndent
      })
      const target = path.join(runDirectory, `${baseName}_mapping.json`)
      await writeFile(target, json, 'utf8')
      const bytes = (await stat(target)).size
      artifacts.push({ kind: 'json', label: 'Mapping document (JSON)', path: target, bytes })
    }

    const errors = plan.issues.filter((issue) => issue.level === 'error')
    if (errors.length > 0) {
      warnings.push(
        `The export contains ${errors.length} mapping error(s). Open Tools → Validate Mapping for the details before using these files.`
      )
    }

    const report: ExportReport = {
      directory: runDirectory,
      artifacts,
      totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
      startedAt,
      finishedAt: new Date().toISOString(),
      warnings
    }
    this.logger.info(
      'export',
      `Exported ${artifacts.length} artifact(s) (${Math.round(report.totalBytes / 1024)} KB).`,
      runDirectory
    )
    return report
  }

  /** Builds a downscaled preview image and returns it as a data URL. */
  async preview(request: PreviewRequest): Promise<ExportPreview> {
    const context = this.context()
    const { project, plan, settings } = context
    const renderOptions = {
      ...this.mapOptions(context),
      showGrid: settings.includeGrid,
      showLabels: settings.includeLabels
    }
    const maxWidth = Math.max(64, Math.min(4096, request.maxWidth ?? 900))
    const maxHeight = Math.max(64, Math.min(4096, request.maxHeight ?? 520))
    const warnings: string[] = []
    let image: RgbaImage
    let artifacts: { label: string; path: string }[] = []
    let kind = request.kind

    switch (request.kind) {
      case 'combined-map': {
        const combined = buildCombinedMapPlan(project, plan)
        image = renderCombinedMap(combined, renderOptions)
        artifacts = [
          { label: 'Combined pixel map', path: `${combined.width} × ${combined.height} px` },
          ...combined.bands.map((band) => ({
            label: `Band: ${band.outputName}`,
            path: `${band.width} × ${band.height} px at y=${band.y}`
          }))
        ]
        break
      }
      case 'output-map': {
        const target =
          plan.outputs.find((outputPlan) => outputPlan.output.id === request.outputId) ?? plan.outputs[0]
        if (!target) throw new AppError('E_NOT_FOUND', 'This project has no mapping outputs to preview.')
        image = renderOutputMap(target, renderOptions)
        artifacts = [
          { label: `Output: ${target.output.name}`, path: `${target.output.width} × ${target.output.height} px` },
          { label: 'Coverage', path: `${target.coveragePercent}% (${target.coveredPixels.toLocaleString()} px)` }
        ]
        break
      }
      case 'screen-guide': {
        const screen = request.screenId
          ? project.screens.find((s) => s.id === request.screenId)
          : project.screens[0]
        if (!screen) throw new AppError('E_NOT_FOUND', 'Select a screen to preview its guide image.')
        image = renderScreenGuide(project, screen, {
          showGrid: settings.includeGrid,
          subtitle: `PROJECT ${project.meta.name}`
        })
        artifacts = [{ label: screen.name, path: `${screen.pixelWidth} × ${screen.pixelHeight} px native` }]
        break
      }
      case 'stage-layout': {
        const layoutPlan = buildStageLayoutPlan(project, 250)
        const pxPerMeter = Math.min(160, Math.max(4, maxWidth / Math.max(layoutPlan.bounds.width / 1000, 0.001)))
        image = renderStageLayout(project, layoutPlan, {
          pxPerMeter,
          showGrid: settings.includeGrid,
          showLabels: settings.includeLabels
        })
        artifacts = [
          { label: 'Stage', path: `${(project.stage.widthMm / 1000).toFixed(2)} m × ${(project.stage.heightMm / 1000).toFixed(2)} m` }
        ]
        break
      }
      default:
        throw new AppError('E_UNSUPPORTED', `Unknown preview kind "${String(kind)}".`)
    }

    kind = request.kind
    const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height)
    const preview =
      scale < 1 ? resampleImage(image, Math.round(image.width * scale), Math.round(image.height * scale)) : image
    const dataUrl = `data:image/png;base64,${encodePng(preview).toString('base64')}`
    if (scale < 1) {
      warnings.push(
        `Preview downscaled to ${preview.width} × ${preview.height} px. The exported file is ${image.width} × ${image.height} px.`
      )
    }

    return {
      kind,
      width: image.width,
      height: image.height,
      dataUrl,
      artifacts,
      warnings
    }
  }

  private appVersion(): string {
    return process.env.CUEPOINT_VERSION ?? '1.0.0'
  }

  /** Combined map plan accessor used by diagnostics. */
  combinedPlan(project: Project, plan: MappingPlan): CombinedMapPlan {
    return buildCombinedMapPlan(project, plan)
  }
}

function sanitiseBase(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\- ]+/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 48) || 'project'
  )
}
