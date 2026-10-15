import { describe, expect, it } from 'vitest'
import {
  autoArrangeRegions,
  buildCombinedMapPlan,
  buildMappingPlan,
  coveredPixelCount,
  defaultRegionFor,
  effectiveRegion,
  issuesByLevel,
  roundRegion
} from '@shared/mapping'
import { createDefaultProject, createScreen } from '@shared/project'
import type { OutputDevice, Project, Screen } from '@shared/types'

/**
 * Mapping is where a stage design becomes something an LED processor can consume, so the
 * coordinates are checked numerically rather than only structurally.
 */

function projectWith(screens: Partial<Screen>[], outputs?: OutputDevice[]): Project {
  const project = createDefaultProject({ name: 'Mapping test' })
  project.screens = screens.map((partial, index) =>
    Object.assign(createScreen({ name: `S${index + 1}`, colorIndex: index }), partial)
  )
  if (outputs) project.outputs = outputs
  return project
}

describe('effective regions', () => {
  it('applies scale and offsets to the stored region', () => {
    const region = effectiveRegion({ region: { x: 10, y: 20, width: 100, height: 50 }, scale: 2, offsetXPx: 5, offsetYPx: -5 })
    expect(region).toEqual({ x: 15, y: 15, width: 200, height: 100 })
  })

  it('ignores a zero or negative scale instead of producing a collapsed region', () => {
    const region = effectiveRegion({ region: { x: 0, y: 0, width: 100, height: 50 }, scale: 0, offsetXPx: 0, offsetYPx: 0 })
    expect(region.width).toBe(100)
    expect(region.height).toBe(50)
  })

  it('rounds to whole pixels with a minimum of one', () => {
    expect(roundRegion({ x: 10.4, y: 10.6, width: 0.2, height: -3 })).toEqual({ x: 10, y: 11, width: 1, height: 1 })
  })

  it('counts covered pixels exactly, without double-counting overlap', () => {
    const output = { width: 1920, height: 1080 }
    expect(coveredPixelCount([{ x: 0, y: 0, width: 10, height: 10 }], output)).toBe(100)
    // Two 10x10 rects overlapping by half cover 150 distinct pixels, not 200.
    expect(
      coveredPixelCount(
        [
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 5, y: 0, width: 10, height: 10 }
        ],
        output
      )
    ).toBe(150)
    // Pixels outside the output are ignored.
    expect(coveredPixelCount([{ x: 1915, y: 1075, width: 100, height: 100 }], output)).toBe(25)
  })
})

describe('mapping plan', () => {
  it('places screens at their native size and reports coverage', () => {
    const output: OutputDevice = { id: 'out-1', name: 'Main', width: 1920, height: 1080, enabled: true, notes: '' }
    const project = projectWith(
      [
        { pixelWidth: 960, pixelHeight: 540, mapping: { outputId: 'out-1', region: { x: 0, y: 0, width: 960, height: 540 }, autoRegion: true, exportVisible: true, scale: 1, offsetXPx: 0, offsetYPx: 0, notes: '' } },
        { pixelWidth: 960, pixelHeight: 540, mapping: { outputId: 'out-1', region: { x: 960, y: 0, width: 960, height: 540 }, autoRegion: true, exportVisible: true, scale: 1, offsetXPx: 0, offsetYPx: 0, notes: '' } }
      ],
      [output]
    )
    const plan = buildMappingPlan(project)
    expect(plan.outputs).toHaveLength(1)
    expect(plan.outputs[0].blocks).toHaveLength(2)
    expect(plan.outputs[0].mappedPixels).toBe(960 * 540 * 2)
    expect(plan.outputs[0].coveredPixels).toBe(960 * 540 * 2)
    expect(plan.outputs[0].coveragePercent).toBeCloseTo(50, 6)
    expect(plan.totals.mappedScreens).toBe(2)
    expect(plan.issues.filter((issue) => issue.level === 'error')).toHaveLength(0)
  })

  it('flags screens without an output assignment', () => {
    const project = projectWith([{ mapping: { outputId: null, region: { x: 0, y: 0, width: 100, height: 100 }, autoRegion: true, exportVisible: true, scale: 1, offsetXPx: 0, offsetYPx: 0, notes: '' } }])
    const plan = buildMappingPlan(project)
    expect(plan.unassigned).toHaveLength(1)
    expect(plan.issues.some((issue) => issue.code === 'unassigned')).toBe(true)
  })

  it('flags a region that extends beyond the output and warns about overlap', () => {
    const output: OutputDevice = { id: 'out-1', name: 'Main', width: 1920, height: 1080, enabled: true, notes: '' }
    const project = projectWith(
      [
        { pixelWidth: 1920, pixelHeight: 1080, mapping: { outputId: 'out-1', region: { x: 0, y: 0, width: 1920, height: 1080 }, autoRegion: false, exportVisible: true, scale: 1, offsetXPx: 0, offsetYPx: 0, notes: '' } },
        { pixelWidth: 960, pixelHeight: 540, mapping: { outputId: 'out-1', region: { x: 1800, y: 900, width: 960, height: 540 }, autoRegion: false, exportVisible: true, scale: 1, offsetXPx: 0, offsetYPx: 0, notes: '' } }
      ],
      [output]
    )
    const plan = buildMappingPlan(project)
    const codes = plan.issues.map((issue) => issue.code)
    expect(codes).toContain('out-of-bounds')
    expect(codes).toContain('overlap')
  })

  it('notes a deliberate 1:1 region as a resolution mismatch warning', () => {
    const output: OutputDevice = { id: 'out-1', name: 'Main', width: 1920, height: 1080, enabled: true, notes: '' }
    const project = projectWith(
      [
        {
          pixelWidth: 960,
          pixelHeight: 540,
          mapping: { outputId: 'out-1', region: { x: 0, y: 0, width: 1920, height: 1080 }, autoRegion: false, exportVisible: true, scale: 1, offsetXPx: 0, offsetYPx: 0, notes: '' }
        }
      ],
      [output]
    )
    const plan = buildMappingPlan(project)
    expect(plan.outputs[0].blocks[0].scaled).toBe(true)
    expect(plan.issues.some((issue) => issue.code === 'resolution-mismatch')).toBe(true)
  })

  it('adds up issue counts by level', () => {
    const project = projectWith([{ mapping: { outputId: null, region: { x: 0, y: 0, width: 10, height: 10 }, autoRegion: true, exportVisible: true, scale: 1, offsetXPx: 0, offsetYPx: 0, notes: '' } }])
    const counts = issuesByLevel(buildMappingPlan(project))
    expect(counts.warning + counts.error + counts.info).toBeGreaterThan(0)
  })
})

describe('auto-arrange and combined map', () => {
  const output: OutputDevice = { id: 'out-1', name: 'Main', width: 1920, height: 1080, enabled: true, notes: '' }

  it('packs regions without overlapping when they fit', () => {
    const screens = [
      createScreen({ name: 'A', pixelWidth: 960, pixelHeight: 540 }),
      createScreen({ name: 'B', pixelWidth: 960, pixelHeight: 540 })
    ]
    const result = autoArrangeRegions(screens, output, { gapPx: 0, useNativeSize: true })
    const [a, b] = [result.regions.get(screens[0].id)!, result.regions.get(screens[1].id)!]
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    expect(overlap).toBe(false)
  })

  it('scales down and warns when the screens cannot fit at native size', () => {
    const screens = [
      createScreen({ name: 'A', pixelWidth: 1920, pixelHeight: 1080 }),
      createScreen({ name: 'B', pixelWidth: 1920, pixelHeight: 1080 })
    ]
    const result = autoArrangeRegions(screens, output, { gapPx: 0, useNativeSize: true })
    expect(result.scale).toBeLessThan(1)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toMatch(/scaled/i)
    for (const screen of screens) {
      const region = result.regions.get(screen.id)
      expect(region).toBeTruthy()
      expect(region!.x + region!.width).toBeLessThanOrEqual(output.width)
      expect(region!.y + region!.height).toBeLessThanOrEqual(output.height)
    }
  })

  it('refuses to place regions when scaling is not allowed', () => {
    const screens = [
      createScreen({ name: 'A', pixelWidth: 1920, pixelHeight: 1080 }),
      createScreen({ name: 'B', pixelWidth: 1920, pixelHeight: 1080 })
    ]
    const result = autoArrangeRegions(screens, output, { gapPx: 0, useNativeSize: true, allowScaleDown: false })
    expect(result.fits).toBe(false)
    expect(result.regions.size).toBe(0)
    expect(result.warnings.join(' ')).toMatch(/do not fit/i)
  })

  it('stacks outputs into a combined map of the expected size', () => {
    const second: OutputDevice = { id: 'out-2', name: 'Side', width: 1280, height: 720, enabled: true, notes: '' }
    const project = projectWith([], [output, second])
    const plan = buildCombinedMapPlan(project, undefined, { gapPx: 10 })
    expect(plan.width).toBe(1920)
    expect(plan.height).toBe(1080 + 720 + 10)
    expect(plan.bands).toHaveLength(2)
    expect(plan.bands[1].y).toBe(1080 + 10)
  })

  it('chooses a default region that does not collide with occupied space', () => {
    const size = { width: 800, height: 400 }
    const first = defaultRegionFor(output, [], size)
    const second = defaultRegionFor(output, [first], size)
    expect(first.x === second.x && first.y === second.y).toBe(false)
    // Side by side inside the output, with no overlap.
    const overlap = first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height
    expect(overlap).toBe(false)
  })

  it('scales a screen down when it is larger than the output', () => {
    const region = defaultRegionFor(output, [], { width: 3840, height: 2160 })
    expect(region.width).toBeLessThanOrEqual(output.width)
    expect(region.height).toBeLessThanOrEqual(output.height)
    expect(region.width / region.height).toBeCloseTo(3840 / 2160, 2)
  })
})
