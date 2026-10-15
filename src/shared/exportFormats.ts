import type { Project } from './types'
import { aspectDecimal, aspectRatioLabel, rectRight, rectBottom } from './geometry'
import { effectiveRegion, type MappingIssue, type MappingPlan } from './mapping'
import { SCHEMA_VERSION } from './project'

/**
 * Machine-readable export formats.
 *
 * Semantics are documented in the user manual and repeated inside the JSON payload so
 * a downstream tool never has to guess. CuePoint does **not** claim to emit a
 * proprietary third-party project format; the JSON document is the integration point.
 */

export const MAPPING_FORMAT = 'cuepoint.mapping'
export const MAPPING_FORMAT_VERSION = 1
export const CSV_FORMAT_LABEL = 'cuepoint.mapping.csv.v1'

export const CSV_COLUMNS = [
  'output_id',
  'output_name',
  'output_width',
  'output_height',
  'screen_id',
  'screen_name',
  'screen_type',
  'screen_visible',
  'screen_locked',
  'group_id',
  'physical_x_mm',
  'physical_y_mm',
  'physical_width_mm',
  'physical_height_mm',
  'rotation_deg',
  'pixel_width',
  'pixel_height',
  'pixel_pitch_mm',
  'pixel_aspect',
  'map_region_x',
  'map_region_y',
  'map_region_width',
  'map_region_height',
  'map_scale',
  'map_offset_x',
  'map_offset_y',
  'map_auto_region',
  'map_export_visible',
  'map_right',
  'map_bottom',
  'map_coverage_percent',
  'notes'
] as const

export function csvEscape(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function fmt(value: number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const rounded = Math.round(value * 10 ** decimals) / 10 ** decimals
  return String(rounded)
}

/**
 * Long-format CSV: one row per mapped screen, with its output repeated on the row.
 * Unassigned screens are emitted with empty output columns so nothing is silently lost.
 */
export function projectToCsv(
  project: Project,
  plan: MappingPlan,
  delimiter: ',' | ';' | '\t' = ','
): string {
  const rows: string[] = []
  rows.push(CSV_COLUMNS.join(delimiter))
  const byOutput = new Map(plan.outputs.map((o) => [o.output.id, o]))

  for (const screen of project.screens) {
    const outputId = screen.mapping.outputId
    const outputPlan = outputId ? byOutput.get(outputId) : undefined
    const output = outputPlan?.output
    const region = effectiveRegion(screen.mapping)
    const coverage =
      outputPlan && outputPlan.output.width * outputPlan.output.height > 0
        ? ((region.width * region.height) / (outputPlan.output.width * outputPlan.output.height)) * 100
        : null

    const values: string[] = [
      output?.id ?? '',
      output?.name ?? '',
      output ? String(output.width) : '',
      output ? String(output.height) : '',
      screen.id,
      screen.name,
      screen.type,
      screen.visible ? 'true' : 'false',
      screen.locked ? 'true' : 'false',
      screen.groupId ?? '',
      fmt(screen.xMm, 3),
      fmt(screen.yMm, 3),
      fmt(screen.widthMm, 3),
      fmt(screen.heightMm, 3),
      fmt(screen.rotationDeg, 4),
      String(screen.pixelWidth),
      String(screen.pixelHeight),
      screen.pixelPitchMm === null ? '' : fmt(screen.pixelPitchMm, 4),
      fmt(aspectDecimal(screen.pixelWidth, screen.pixelHeight), 6),
      fmt(region.x, 3),
      fmt(region.y, 3),
      fmt(region.width, 3),
      fmt(region.height, 3),
      fmt(screen.mapping.scale, 6),
      fmt(screen.mapping.offsetXPx, 3),
      fmt(screen.mapping.offsetYPx, 3),
      screen.mapping.autoRegion ? 'true' : 'false',
      screen.mapping.exportVisible ? 'true' : 'false',
      fmt(rectRight(region), 3),
      fmt(rectBottom(region), 3),
      coverage === null ? '' : fmt(coverage, 4),
      screen.mapping.notes || screen.notes
    ]
    rows.push(values.map((value) => csvEscape(value, delimiter)).join(delimiter))
  }

  return `${rows.join('\r\n')}\r\n`
}

export interface MappingJsonOptions {
  appVersion: string
  appName?: string
  includeIssueDetails?: boolean
  jsonIndent?: number
}

/**
 * Versioned JSON mapping document.
 *
 * Coordinate systems are stated explicitly so consumers cannot misinterpret units:
 * physical geometry is millimetres in stage space, mapping regions are pixels in
 * output space with the origin at the output's top-left corner.
 */
export function projectToMappingJson(
  project: Project,
  plan: MappingPlan,
  options: MappingJsonOptions
): string {
  const document = {
    format: MAPPING_FORMAT,
    formatVersion: MAPPING_FORMAT_VERSION,
    csvFormat: CSV_FORMAT_LABEL,
    generator: {
      name: options.appName ?? 'CuePoint',
      version: options.appVersion,
      projectSchemaVersion: SCHEMA_VERSION
    },
    exportedAt: new Date().toISOString(),
    units: {
      length: 'mm',
      lengthNote:
        'All physical dimensions are millimetres. Convert with 1 m = 1000 mm, 1 in = 25.4 mm, 1 ft = 304.8 mm.',
      pixel: 'px',
      rotation: 'degrees, clockwise positive, normalised to 0 <= r < 360'
    },
    coordinateSystems: {
      stageSpace:
        'Origin at the stage top-left corner. +x to the right, +y downward. Used by all physical_* fields.',
      screenLocalSpace:
        'Each screen is an axis-aligned rectangle (x, y, width, height) rotated by rotation_deg about that rectangle centre.',
      outputSpace:
        'Origin at the output top-left corner, +y downward. map_region_* and map_offset_* are pixels in this space.',
      effectiveRegion:
        'map_region_x + map_offset_x, map_region_y + map_offset_y, map_region_width * map_scale, map_region_height * map_scale.'
    },
    project: {
      id: project.meta.id,
      name: project.meta.name,
      author: project.meta.author,
      notes: project.meta.notes,
      createdAt: project.meta.createdAt,
      updatedAt: project.meta.updatedAt,
      stage: {
        name: project.stage.name,
        widthMm: project.stage.widthMm,
        heightMm: project.stage.heightMm,
        canvasPxPerMeter: project.stage.canvasPxPerMeter,
        background: {
          assetPath: project.stage.background.assetPath,
          visible: project.stage.background.visible,
          opacity: project.stage.background.opacity,
          fit: project.stage.background.fit,
          offsetXMm: project.stage.background.offsetXMm,
          offsetYMm: project.stage.background.offsetYMm,
          scale: project.stage.background.scale,
          rotationDeg: project.stage.background.rotationDeg
        }
      }
    },
    outputs: plan.outputs.map((outputPlan) => ({
      id: outputPlan.output.id,
      name: outputPlan.output.name,
      width: outputPlan.output.width,
      height: outputPlan.output.height,
      enabled: outputPlan.output.enabled,
      notes: outputPlan.output.notes,
      mappedPixels: outputPlan.mappedPixels,
      coveredPixels: outputPlan.coveredPixels,
      coveragePercent: outputPlan.coveragePercent,
      unusedPixels: outputPlan.unusedPixels,
      screens: outputPlan.blocks.map((block) => {
        const screen = project.screens.find((s) => s.id === block.screenId)
        const region = effectiveRegion(screen?.mapping ?? {
          region: block.rect,
          scale: 1,
          offsetXPx: 0,
          offsetYPx: 0
        })
        return {
          screenId: block.screenId,
          name: block.name,
          type: screen?.type ?? 'led',
          color: screen?.color ?? '#808080',
          visible: screen?.visible ?? true,
          locked: screen?.locked ?? false,
          groupId: screen?.groupId ?? null,
          physical: {
            xMm: screen?.xMm ?? 0,
            yMm: screen?.yMm ?? 0,
            widthMm: screen?.widthMm ?? 0,
            heightMm: screen?.heightMm ?? 0,
            rotationDeg: screen?.rotationDeg ?? 0
          },
          pixel: {
            width: block.native.width,
            height: block.native.height,
            pitchMm: screen?.pixelPitchMm ?? null,
            aspect: aspectDecimal(block.native.width, block.native.height),
            aspectLabel: aspectRatioLabel(block.native.width, block.native.height)
          },
          mapping: {
            region: screen?.mapping.region ?? block.rect,
            effectiveRegion: region,
            scale: screen?.mapping.scale ?? 1,
            offsetXPx: screen?.mapping.offsetXPx ?? 0,
            offsetYPx: screen?.mapping.offsetYPx ?? 0,
            autoRegion: screen?.mapping.autoRegion ?? true,
            exportVisible: screen?.mapping.exportVisible ?? true,
            scaled:
              block.scaled ||
              (screen?.mapping.region.width ?? 0) !== block.native.width ||
              (screen?.mapping.region.height ?? 0) !== block.native.height,
            notes: screen?.mapping.notes ?? ''
          }
        }
      })
    })),
    unassignedScreens: plan.unassigned.map((screen) => ({
      screenId: screen.id,
      name: screen.name,
      pixelWidth: screen.pixelWidth,
      pixelHeight: screen.pixelHeight,
      physicalWidthMm: screen.widthMm,
      physicalHeightMm: screen.heightMm
    })),
    totals: plan.totals,
    issues: options.includeIssueDetails === false
      ? plan.issues.map((issue: MappingIssue) => ({
          level: issue.level,
          code: issue.code,
          screenId: issue.screenId ?? null,
          outputId: issue.outputId ?? null
        }))
      : plan.issues,
    compatibility: {
      thirdParty:
        'CuePoint exports this documented JSON document and the CSV table. It does not emit Resolume Arena, disguise, Watchout or any other vendor project file, and no vendor compatibility is claimed.',
      notes: [
        'Use the combined pixel map PNG as a visual reference for content authors.',
        'Use the per-screen guide PNGs to author content at each screen native resolution.',
        'The mapping JSON is stable within a formatVersion; consumers should check formatVersion first.'
      ]
    }
  }

  return `${JSON.stringify(document, null, Math.max(0, options.jsonIndent ?? 2))}\n`
}

export function suggestedExportName(
  projectName: string,
  suffix: string,
  extension: string
): string {
  const safeProject = projectName
    .trim()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'project'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return `${safeProject}_${suffix}_${stamp}.${extension}`
}
