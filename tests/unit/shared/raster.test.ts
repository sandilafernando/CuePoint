import { describe, expect, it } from 'vitest'
import { getPixel, parseColor, resampleImage } from '@shared/raster/draw'
import { renderCombinedMap, renderOutputMap, renderScreenGuide, renderStageLayout } from '@shared/raster/render'
import { buildCombinedMapPlan, buildMappingPlan, buildStageLayoutPlan } from '@shared/mapping'
import { createDefaultProject, createScreen } from '@shared/project'
import type { OutputDevice, Project } from '@shared/types'

/**
 * Export rendering is verified at pixel level: a mapping tool that draws the right boxes in
 * the wrong place is worse than one that draws nothing, because the operator trusts it.
 */

function fixture(): Project {
  const output: OutputDevice = { id: 'out-1', name: 'Main', width: 1000, height: 500, enabled: true, notes: '' }
  const project = createDefaultProject({ name: 'Render', stageWidthMm: 10_000, stageHeightMm: 5000 })
  project.outputs = [output]
  const left = createScreen({ name: 'Left', widthMm: 4000, heightMm: 2000, pixelWidth: 400, pixelHeight: 200, xMm: 0, yMm: 0, id: 'left' })
  left.color = '#ff0000'
  left.mapping = {
    outputId: 'out-1',
    region: { x: 0, y: 0, width: 400, height: 200 },
    autoRegion: false,
    exportVisible: true,
    scale: 1,
    offsetXPx: 0,
    offsetYPx: 0,
    notes: ''
  }
  const right = createScreen({ name: 'Right', widthMm: 2000, heightMm: 1000, pixelWidth: 200, pixelHeight: 100, xMm: 5000, yMm: 1000, id: 'right' })
  right.color = '#0000ff'
  right.mapping = {
    outputId: 'out-1',
    region: { x: 600, y: 300, width: 200, height: 100 },
    autoRegion: false,
    exportVisible: true,
    scale: 1,
    offsetXPx: 0,
    offsetYPx: 0,
    notes: ''
  }
  project.screens = [left, right]
  return project
}

describe('output map rendering', () => {
  it('renders at exactly the output resolution', () => {
    const project = fixture()
    const image = renderOutputMap(buildMappingPlan(project).outputs[0], { showGrid: false, showLabels: false })
    expect(image.width).toBe(1000)
    expect(image.height).toBe(500)
  })

  it('paints each screen inside its mapped region', () => {
    const project = fixture()
    const image = renderOutputMap(buildMappingPlan(project).outputs[0], { showGrid: false, showLabels: false })
    // Blocks are drawn as a translucent fill of the screen colour, so the assertion is about
    // which channel dominates at each block's centre rather than an exact colour match.
    const leftPixel = getPixel(image, 200, 100)
    const rightPixel = getPixel(image, 700, 350)
    expect(leftPixel.r).toBeGreaterThan(leftPixel.b + 20)
    expect(rightPixel.b).toBeGreaterThan(rightPixel.r + 20)
    // Outside every region stays at the background colour.
    const empty = getPixel(image, 985, 495)
    expect(empty.r).toBeLessThan(40)
    expect(empty.g).toBeLessThan(40)
  })

  it('respects export visibility', () => {
    const project = fixture()
    project.screens[0].mapping.exportVisible = false
    const image = renderOutputMap(buildMappingPlan(project).outputs[0], { showGrid: false, showLabels: false, dimExcluded: false })
    const leftPixel = getPixel(image, 200, 100)
    expect(leftPixel.r).toBeLessThan(60)
  })
})

describe('combined map rendering', () => {
  it('stacks outputs into a single image with the documented size', () => {
    const project = fixture()
    project.outputs.push({ id: 'out-2', name: 'Side', width: 600, height: 300, enabled: true, notes: '' })
    const plan = buildCombinedMapPlan(project, buildMappingPlan(project), { gapPx: 20 })
    const image = renderCombinedMap(plan, { showGrid: false, showLabels: false })
    expect(image.width).toBe(1000)
    expect(image.height).toBe(500 + 300 + 20)
  })
})

describe('screen guide rendering', () => {
  it('renders at the native pixel size of the screen, not the mapping region', () => {
    const project = fixture()
    const screen = project.screens[0]
    screen.mapping.region = { x: 0, y: 0, width: 100, height: 50 }
    const image = renderScreenGuide(project, screen, { showGrid: false, showSafeArea: false })
    expect(image.width).toBe(400)
    expect(image.height).toBe(200)
  })
})

describe('stage layout rendering', () => {
  it('renders the physical layout with a border and screen fills', () => {
    const project = fixture()
    const plan = buildStageLayoutPlan(project, 0)
    const image = renderStageLayout(project, plan, { showGrid: false, showLabels: false, pxPerMeter: 100 })
    expect(image.width).toBeGreaterThan(900)
    expect(image.height).toBeGreaterThan(400)
    // The left screen starts at the stage origin.
    const pixel = getPixel(image, 40, 40)
    expect(pixel.r + pixel.g + pixel.b).toBeGreaterThan(30)
  })
})

describe('resampling', () => {
  it('scales an image, preserving colours', () => {
    const project = fixture()
    const image = renderOutputMap(buildMappingPlan(project).outputs[0], { showGrid: false, showLabels: false })
    const scaled = resampleImage(image, 100, 50)
    expect(scaled.width).toBe(100)
    expect(scaled.height).toBe(50)
    const pixel = getPixel(scaled, 20, 10)
    expect(pixel.r).toBeGreaterThan(pixel.b + 20)
  })

  it('parses the hex colours used by the model', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(parseColor('#00ff0080').a).toBe(128)
    expect(parseColor('#0f0')).toEqual({ r: 0, g: 255, b: 0, a: 255 })
    // Unrecognised input falls back to a neutral grey rather than rendering as black or NaN.
    const fallback = parseColor('not-a-colour')
    expect(Number.isFinite(fallback.r)).toBe(true)
    expect(fallback.r).toBe(fallback.g)
  })
})
