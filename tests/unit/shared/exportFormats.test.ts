import { describe, expect, it } from 'vitest'
import {
  CSV_COLUMNS,
  CSV_FORMAT_LABEL,
  MAPPING_FORMAT,
  MAPPING_FORMAT_VERSION,
  csvEscape,
  projectToCsv,
  projectToMappingJson,
  suggestedExportName
} from '@shared/exportFormats'
import { buildMappingPlan } from '@shared/mapping'
import { createDefaultProject, createScreen } from '@shared/project'
import type { OutputDevice, Project } from '@shared/types'

/**
 * Export formats are a public interface: other people's tooling reads them. These tests pin
 * the column order, the coordinate semantics and the format version.
 */

function fixture(): Project {
  const output: OutputDevice = { id: 'out-main', name: 'Main Output', width: 1920, height: 1080, enabled: true, notes: '' }
  const project = createDefaultProject({ name: 'Autumn Show', author: 'Stage Ops', stageWidthMm: 12_000, stageHeightMm: 6000 })
  project.outputs = [output]
  const screen = createScreen({
    name: 'Upstage LED',
    widthMm: 6000,
    heightMm: 3000,
    pixelWidth: 1920,
    pixelHeight: 960,
    xMm: 1000,
    yMm: 500,
    id: 'scr-1'
  })
  screen.mapping = {
    outputId: 'out-main',
    region: { x: 0, y: 120, width: 1920, height: 960 },
    autoRegion: false,
    exportVisible: true,
    scale: 1,
    offsetXPx: 0,
    offsetYPx: 0,
    notes: ''
  }
  project.screens = [screen]
  return project
}

describe('CSV export', () => {
  it('writes the documented header and one row per screen', () => {
    const project = fixture()
    const csv = projectToCsv(project, buildMappingPlan(project), ',')
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines).toHaveLength(2)
  })

  it('contains the true geometry and mapping coordinates', () => {
    const project = fixture()
    const csv = projectToCsv(project, buildMappingPlan(project), ',')
    const header = CSV_COLUMNS as readonly string[]
    const values = csv.trim().split('\r\n')[1].split(',')
    const at = (column: string): string => values[header.indexOf(column)]
    expect(at('screen_id')).toBe('scr-1')
    expect(at('screen_name')).toBe('Upstage LED')
    expect(at('physical_x_mm')).toBe('1000')
    expect(at('physical_y_mm')).toBe('500')
    expect(at('physical_width_mm')).toBe('6000')
    expect(at('physical_height_mm')).toBe('3000')
    expect(at('pixel_width')).toBe('1920')
    expect(at('pixel_height')).toBe('960')
    expect(at('map_region_x')).toBe('0')
    expect(at('map_region_y')).toBe('120')
    expect(at('map_region_width')).toBe('1920')
    expect(at('map_region_height')).toBe('960')
    expect(at('map_right')).toBe('1920')
    expect(at('map_bottom')).toBe('1080')
    expect(at('map_export_visible')).toBe('true')
    expect(at('output_width')).toBe('1920')
    expect(at('output_name')).toBe('Main Output')
  })

  it('honours the requested delimiter', () => {
    const project = fixture()
    const semicolons = projectToCsv(project, buildMappingPlan(project), ';')
    expect(semicolons.trim().split('\r\n')[0]).toBe(CSV_COLUMNS.join(';'))
  })

  it('keeps unassigned screens in the file so nothing is silently lost', () => {
    const project = fixture()
    project.screens[0].mapping.outputId = null
    const csv = projectToCsv(project, buildMappingPlan(project), ',')
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Upstage LED')
  })

  it('escapes values containing the delimiter, quotes or newlines', () => {
    expect(csvEscape('a,b', ',')).toBe('"a,b"')
    expect(csvEscape('say "hi"', ',')).toBe('"say ""hi"""')
    expect(csvEscape('line\nbreak', ',')).toBe('"line\nbreak"')
    expect(csvEscape('plain', ',')).toBe('plain')
  })
})

describe('mapping JSON export', () => {
  it('carries the format identifier and version', () => {
    const project = fixture()
    const json = projectToMappingJson(project, buildMappingPlan(project), { appVersion: '1.0.0' })
    const document = JSON.parse(json)
    expect(document.format).toBe(MAPPING_FORMAT)
    expect(document.formatVersion).toBe(MAPPING_FORMAT_VERSION)
    expect(document.csvFormat).toBe(CSV_FORMAT_LABEL)
    expect(document.generator.version).toBe('1.0.0')
  })

  it('states the coordinate systems and units explicitly', () => {
    const project = fixture()
    const document = JSON.parse(projectToMappingJson(project, buildMappingPlan(project), { appVersion: '1.0.0' }))
    expect(document.units.length).toBe('mm')
    expect(document.coordinateSystems.stageSpace).toMatch(/top-left/i)
    expect(document.coordinateSystems.outputSpace).toMatch(/top-left/i)
    expect(document.coordinateSystems.effectiveRegion).toMatch(/map_region_x/)
  })

  it('preserves millimetre geometry and pixel mapping values', () => {
    const project = fixture()
    const document = JSON.parse(projectToMappingJson(project, buildMappingPlan(project), { appVersion: '1.0.0' }))
    expect(document.outputs).toHaveLength(1)
    const screen = document.outputs[0].screens[0]
    expect(screen.screenId).toBe('scr-1')
    expect(screen.physical).toEqual({ xMm: 1000, yMm: 500, widthMm: 6000, heightMm: 3000, rotationDeg: 0 })
    expect(screen.pixel.width).toBe(1920)
    expect(screen.pixel.height).toBe(960)
    expect(screen.mapping.region).toEqual({ x: 0, y: 120, width: 1920, height: 960 })
    expect(screen.mapping.effectiveRegion.width).toBe(1920)
    expect(screen.mapping.scaled).toBe(false)
  })

  it('respects the indent option', () => {
    const project = fixture()
    const compact = projectToMappingJson(project, buildMappingPlan(project), { appVersion: '1.0.0', jsonIndent: 0 })
    const pretty = projectToMappingJson(project, buildMappingPlan(project), { appVersion: '1.0.0', jsonIndent: 2 })
    expect(compact.split('\n').length).toBeLessThan(pretty.split('\n').length)
    // Each call stamps its own export time, so it is excluded from the comparison — otherwise
    // the assertion would fail whenever the two calls straddle a millisecond boundary.
    const withoutTimestamp = (json: string): Record<string, unknown> => {
      const document = JSON.parse(json) as Record<string, unknown>
      delete document.exportedAt
      return document
    }
    expect(withoutTimestamp(compact)).toEqual(withoutTimestamp(pretty))
  })
})

describe('suggested export names', () => {
  it('sanitises the project name and stamps the time', () => {
    const name = suggestedExportName('Autumn Show / 2026', 'combined-map', 'png')
    expect(name).toMatch(/^Autumn_Show_2026_combined-map_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/)
  })

  it('falls back to a safe name when the project name is empty', () => {
    expect(suggestedExportName('   ', 'csv', 'csv')).toMatch(/^project_csv_/)
  })
})
