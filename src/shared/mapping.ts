import type { OutputDevice, Project, Rect, Screen, Size } from './types'
import {
  cloneRect,
  rectArea,
  rectBottom,
  rectRight,
  rectsIntersect,
  intersectionRect,
  rotatedBounds,
  unionRects
} from './geometry'
import { LIMITS, isValidOutputSize } from './validation'

/**
 * Pixel mapping engine.
 *
 * A screen's *effective mapping region* is its stored region translated by the
 * mapping offsets and scaled about the region's top-left corner:
 *
 *   x = region.x + offsetXPx
 *   y = region.y + offsetYPx
 *   w = region.width  * scale
 *   h = region.height * scale
 *
 * Regions are expressed in the target output's pixel space. Everything in this module
 * is pure: it is used by the UI, by the exporters and by the test suite.
 */

export type MappingIssueLevel = 'error' | 'warning' | 'info'

export type MappingIssueCode =
  | 'unassigned'
  | 'missing-output'
  | 'output-disabled'
  | 'out-of-bounds'
  | 'duplicate-region'
  | 'overlap'
  | 'resolution-mismatch'
  | 'hidden'
  | 'invalid-region'

export interface MappingIssue {
  level: MappingIssueLevel
  code: MappingIssueCode
  message: string
  screenId?: string
  outputId?: string
}

export interface MapBlock {
  screenId: string
  name: string
  color: string
  /** Effective region inside the output, rounded to whole pixels. */
  rect: Rect
  /** Native pixel size of the screen. */
  native: Size
  /** True when the mapping region size differs from the native pixel size. */
  scaled: boolean
  /** True when the block is included in exported maps. */
  exportVisible: boolean
  screenVisible: boolean
  locked: boolean
}

export interface OutputMapPlan {
  output: OutputDevice
  blocks: MapBlock[]
  /** Sum of the mapped pixel areas (may exceed the output area when overlapped). */
  mappedPixels: number
  /** Distinct pixels covered by at least one block. */
  coveredPixels: number
  coveragePercent: number
  unusedPixels: number
}

export interface MappingPlan {
  outputs: OutputMapPlan[]
  unassigned: Screen[]
  issues: MappingIssue[]
  totals: {
    screens: number
    mappedScreens: number
    outputs: number
    mappedPixels: number
    totalOutputPixels: number
  }
}

export interface MappingSettings {
  region: Rect
  scale: number
  offsetXPx: number
  offsetYPx: number
}

export function effectiveRegion(mapping: MappingSettings): Rect {
  const scale = Number.isFinite(mapping.scale) && mapping.scale > 0 ? mapping.scale : 1
  return {
    x: mapping.region.x + (Number.isFinite(mapping.offsetXPx) ? mapping.offsetXPx : 0),
    y: mapping.region.y + (Number.isFinite(mapping.offsetYPx) ? mapping.offsetYPx : 0),
    width: Math.max(1, mapping.region.width * scale),
    height: Math.max(1, mapping.region.height * scale)
  }
}

export function roundRegion(region: Rect): Rect {
  return {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.max(1, Math.round(region.width)),
    height: Math.max(1, Math.round(region.height))
  }
}

export function blockForScreen(screen: Screen): MapBlock | null {
  if (!screen.mapping.outputId) return null
  return {
    screenId: screen.id,
    name: screen.name,
    color: screen.color,
    rect: roundRegion(effectiveRegion(screen.mapping)),
    native: { width: screen.pixelWidth, height: screen.pixelHeight },
    scaled:
      screen.mapping.region.width !== screen.pixelWidth ||
      screen.mapping.region.height !== screen.pixelHeight ||
      screen.mapping.scale !== 1,
    exportVisible: screen.mapping.exportVisible,
    screenVisible: screen.visible,
    locked: screen.locked
  }
}

/** Counts distinct pixels covered by a set of rects, clamped to the output bounds. */
export function coveredPixelCount(rects: readonly Rect[], output: Size): number {
  const clamped = rects
    .map((rect) => intersectionRect(rect, { x: 0, y: 0, width: output.width, height: output.height }))
    .filter((rect): rect is Rect => rect !== null)
  if (clamped.length === 0) return 0
  if (clamped.length > 512) {
    // Guard against pathological inputs; fall back to a bounding-box estimate.
    const union = unionRects(clamped)
    return union ? Math.round(rectArea(union)) : 0
  }

  // Sweep-line area union (exact, no double counting of overlapped pixels).
  const xs = new Set<number>()
  for (const rect of clamped) {
    xs.add(rect.x)
    xs.add(rectRight(rect))
  }
  const columns = [...xs].sort((a, b) => a - b)
  let total = 0
  for (let i = 0; i < columns.length - 1; i += 1) {
    const x0 = columns[i]
    const x1 = columns[i + 1]
    if (x1 <= x0) continue
    const spans = clamped
      .filter((rect) => rect.x <= x0 && rectRight(rect) >= x1)
      .map((rect) => [rect.y, rectBottom(rect)] as [number, number])
      .sort((a, b) => a[0] - b[0])
    let coveredY = 0
    let currentStart = Number.NaN
    let currentEnd = Number.NaN
    for (const [start, end] of spans) {
      if (Number.isNaN(currentStart)) {
        currentStart = start
        currentEnd = end
      } else if (start <= currentEnd) {
        currentEnd = Math.max(currentEnd, end)
      } else {
        coveredY += currentEnd - currentStart
        currentStart = start
        currentEnd = end
      }
    }
    if (!Number.isNaN(currentStart)) coveredY += currentEnd - currentStart
    total += coveredY * (x1 - x0)
  }
  return Math.round(total)
}

export function buildMappingPlan(project: Project): MappingPlan {
  const issues: MappingIssue[] = []
  const byOutput = new Map<string, MapBlock[]>()
  const unassigned: Screen[] = []
  const outputIds = new Set(project.outputs.map((o) => o.id))

  for (const screen of project.screens) {
    const outputId = screen.mapping.outputId
    if (!outputId) {
      unassigned.push(screen)
      continue
    }
    if (!outputIds.has(outputId)) {
      issues.push({
        level: 'error',
        code: 'missing-output',
        message: `"${screen.name}" is assigned to an output that no longer exists. Reassign it to a valid output.`,
        screenId: screen.id
      })
      continue
    }
    const block = blockForScreen(screen)
    if (!block) continue
    const list = byOutput.get(outputId) ?? []
    list.push(block)
    byOutput.set(outputId, list)

    if (block.rect.width < 1 || block.rect.height < 1) {
      issues.push({
        level: 'error',
        code: 'invalid-region',
        message: `"${screen.name}" has an invalid mapping region (${block.rect.width} × ${block.rect.height} px).`,
        screenId: screen.id,
        outputId
      })
    }
    if (block.scaled) {
      issues.push({
        level: 'info',
        code: 'resolution-mismatch',
        message: `"${screen.name}" is mapped at ${block.rect.width} × ${block.rect.height} px but its native resolution is ${screen.pixelWidth} × ${screen.pixelHeight} px. The output will need scaling.`,
        screenId: screen.id,
        outputId
      })
    }
    if (!screen.visible) {
      issues.push({
        level: 'info',
        code: 'hidden',
        message: `"${screen.name}" is hidden on the stage but still mapped to an output.`,
        screenId: screen.id,
        outputId
      })
    }
    if (!screen.mapping.exportVisible) {
      issues.push({
        level: 'info',
        code: 'hidden',
        message: `"${screen.name}" is excluded from exported maps.`,
        screenId: screen.id,
        outputId
      })
    }
  }

  const outputs: OutputMapPlan[] = project.outputs.map((output) => {
    const blocks = (byOutput.get(output.id) ?? []).sort(
      (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x
    )

    if (!isValidOutputSize(output.width, output.height)) {
      issues.push({
        level: 'error',
        code: 'invalid-region',
        message: `Output "${output.name}" has an invalid resolution (${output.width} × ${output.height} px).`,
        outputId: output.id
      })
    }
    if (!output.enabled) {
      issues.push({
        level: 'warning',
        code: 'output-disabled',
        message: `Output "${output.name}" is disabled but still has ${blocks.length} mapped screen(s).`,
        outputId: output.id
      })
    }

    for (const block of blocks) {
      const outside =
        block.rect.x < 0 ||
        block.rect.y < 0 ||
        rectRight(block.rect) > output.width ||
        rectBottom(block.rect) > output.height
      if (outside) {
        issues.push({
          level: 'error',
          code: 'out-of-bounds',
          message: `"${block.name}" maps to x ${block.rect.x}..${rectRight(block.rect)}, y ${block.rect.y}..${rectBottom(block.rect)} which extends outside output "${output.name}" (${output.width} × ${output.height}).`,
          screenId: block.screenId,
          outputId: output.id
        })
      }
    }

    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i]
        const b = blocks[j]
        const intersect = intersectionRect(a.rect, b.rect)
        if (!intersect) continue
        const identical =
          a.rect.x === b.rect.x &&
          a.rect.y === b.rect.y &&
          a.rect.width === b.rect.width &&
          a.rect.height === b.rect.height
        if (identical) {
          issues.push({
            level: 'error',
            code: 'duplicate-region',
            message: `"${a.name}" and "${b.name}" occupy the exact same ${a.rect.width} × ${a.rect.height} px region on output "${output.name}". Assign one of them a different region.`,
            screenId: b.screenId,
            outputId: output.id
          })
        } else {
          issues.push({
            level: 'warning',
            code: 'overlap',
            message: `"${a.name}" and "${b.name}" overlap by ${Math.round(intersect.width)} × ${Math.round(intersect.height)} px on output "${output.name}". This is valid if the overlap is intentional (e.g. blended panels), otherwise adjust the regions.`,
            screenId: b.screenId,
            outputId: output.id
          })
        }
      }
    }

    const mappedPixels = blocks
      .filter((b) => b.exportVisible)
      .reduce((sum, b) => sum + Math.round(rectArea(b.rect)), 0)
    const coveredPixels = coveredPixelCount(
      blocks.filter((b) => b.exportVisible).map((b) => b.rect),
      output
    )
    const total = Math.max(1, output.width * output.height)

    return {
      output,
      blocks,
      mappedPixels,
      coveredPixels,
      coveragePercent: Math.round((coveredPixels / total) * 1000) / 10,
      unusedPixels: Math.max(0, total - coveredPixels)
    }
  })

  for (const screen of unassigned) {
    issues.push({
      level: 'info',
      code: 'unassigned',
      message: `"${screen.name}" is not assigned to any output yet.`,
      screenId: screen.id
    })
  }

  const order: Record<MappingIssueLevel, number> = { error: 0, warning: 1, info: 2 }
  issues.sort((a, b) => order[a.level] - order[b.level])

  return {
    outputs,
    unassigned,
    issues,
    totals: {
      screens: project.screens.length,
      mappedScreens: project.screens.length - unassigned.length,
      outputs: project.outputs.length,
      mappedPixels: outputs.reduce((sum, o) => sum + o.mappedPixels, 0),
      totalOutputPixels: outputs.reduce((sum, o) => sum + o.output.width * o.output.height, 0)
    }
  }
}

export function issuesByLevel(plan: MappingPlan): Record<MappingIssueLevel, number> {
  return plan.issues.reduce(
    (acc, issue) => {
      acc[issue.level] += 1
      return acc
    },
    { error: 0, warning: 0, info: 0 } as Record<MappingIssueLevel, number>
  )
}

// ---------------------------------------------------------------------------
// Export plans
// ---------------------------------------------------------------------------

export interface CombinedBand {
  outputId: string
  outputName: string
  /** Band offset inside the combined image. */
  y: number
  height: number
  width: number
}

export interface CombinedMapPlan {
  width: number
  height: number
  bands: CombinedBand[]
  blocks: (MapBlock & { outputId: string; offsetY: number; offsetX: number })[]
}

export interface CombinedMapOptions {
  /** Vertical gap between output bands, in pixels. */
  gapPx?: number
}

/**
 * Combined pixel map: every output is drawn as a horizontal band, stacked top to
 * bottom in output order. The image is `max(output width)` wide and
 * `sum(output heights) + gaps` tall. Outputs are left-aligned inside their band.
 */
export function buildCombinedMapPlan(
  project: Project,
  plan?: MappingPlan,
  options: CombinedMapOptions = {}
): CombinedMapPlan {
  const mappingPlan = plan ?? buildMappingPlan(project)
  const gap = Math.max(0, Math.round(options.gapPx ?? 0))
  const width = Math.max(1, ...mappingPlan.outputs.map((o) => o.output.width))
  const bands: CombinedBand[] = []
  const blocks: CombinedMapPlan['blocks'] = []

  let cursor = 0
  for (const outputPlan of mappingPlan.outputs) {
    const band: CombinedBand = {
      outputId: outputPlan.output.id,
      outputName: outputPlan.output.name,
      y: cursor,
      height: outputPlan.output.height,
      width: outputPlan.output.width
    }
    bands.push(band)
    for (const block of outputPlan.blocks) {
      if (!block.exportVisible) continue
      blocks.push({ ...block, outputId: outputPlan.output.id, offsetY: cursor, offsetX: 0 })
    }
    cursor += outputPlan.output.height + gap
  }

  return { width, height: Math.max(1, cursor - (bands.length ? gap : 0)), bands, blocks }
}

export interface StageLayoutBlock {
  screenId: string
  name: string
  color: string
  /** Stage-millimetre rect (unrotated). */
  rect: Rect
  rotationDeg: number
  /** Bounding box used for layout bounds. */
  bounds: Rect
  pixelWidth: number
  pixelHeight: number
}

export interface StageLayoutPlan {
  /** Stage millimetres covered by the layout, including a margin. */
  bounds: Rect
  blocks: StageLayoutBlock[]
}

export function buildStageLayoutPlan(project: Project, marginMm = 0): StageLayoutPlan {
  const stageRect: Rect = {
    x: 0,
    y: 0,
    width: project.stage.widthMm,
    height: project.stage.heightMm
  }
  const blocks: StageLayoutBlock[] = project.screens.map((screen) => {
    const rect: Rect = {
      x: screen.xMm,
      y: screen.yMm,
      width: screen.widthMm,
      height: screen.heightMm
    }
    return {
      screenId: screen.id,
      name: screen.name,
      color: screen.color,
      rect,
      rotationDeg: screen.rotationDeg,
      bounds: rotatedBounds(rect, screen.rotationDeg),
      pixelWidth: screen.pixelWidth,
      pixelHeight: screen.pixelHeight
    }
  })
  const withMargin = project.screens.length
    ? unionRects([stageRect, ...blocks.map((b) => b.bounds)]) ?? stageRect
    : stageRect
  return {
    bounds: {
      x: withMargin.x - marginMm,
      y: withMargin.y - marginMm,
      width: withMargin.width + marginMm * 2,
      height: withMargin.height + marginMm * 2
    },
    blocks
  }
}

// ---------------------------------------------------------------------------
// Auto-arrange
// ---------------------------------------------------------------------------

export interface AutoArrangeOptions {
  /** Gap in output pixels between packed regions. */
  gapPx?: number
  /** Use the screen's native pixel size (true) or its current region size (false). */
  useNativeSize?: boolean
  /** Scale every region down uniformly if they cannot all fit. */
  allowScaleDown?: boolean
}

export interface AutoArrangeResult {
  regions: Map<string, Rect>
  /** Applied uniform scale (1 when nothing had to shrink). */
  scale: number
  fits: boolean
  warnings: string[]
}

/**
 * Shelf-packs screens into an output, largest first, wrapping to a new row when the
 * current row is full. Deterministic, so the result can be asserted in tests.
 */
export function autoArrangeRegions(
  screens: readonly Screen[],
  output: OutputDevice,
  options: AutoArrangeOptions = {}
): AutoArrangeResult {
  const gap = Math.max(0, Math.round(options.gapPx ?? 8))
  const useNative = options.useNativeSize !== false
  const allowScaleDown = options.allowScaleDown !== false
  const warnings: string[] = []
  const regions = new Map<string, Rect>()
  if (screens.length === 0) return { regions, scale: 1, fits: true, warnings }

  // Tallest first, then widest, then by id so the packing is fully deterministic.
  const sizes = screens
    .map((screen) => ({
      id: screen.id,
      name: screen.name,
      width: useNative ? screen.pixelWidth : Math.round(screen.mapping.region.width),
      height: useNative ? screen.pixelHeight : Math.round(screen.mapping.region.height)
    }))
    .sort((a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id))

  const pack = (scale: number): { regions: Map<string, Rect>; fits: boolean } => {
    const packed = new Map<string, Rect>()
    let x = 0
    let y = 0
    let rowHeight = 0
    let fits = true
    for (const item of sizes) {
      const w = Math.max(1, Math.round(item.width * scale))
      const h = Math.max(1, Math.round(item.height * scale))
      if (w > output.width || h > output.height) {
        fits = false
        return { regions: packed, fits }
      }
      if (x + w > output.width) {
        x = 0
        y += rowHeight + gap
        rowHeight = 0
      }
      if (y + h > output.height) {
        fits = false
        return { regions: packed, fits }
      }
      packed.set(item.id, { x, y, width: w, height: h })
      x += w + gap
      rowHeight = Math.max(rowHeight, h)
    }
    return { regions: packed, fits }
  }

  const direct = pack(1)
  if (direct.fits) {
    for (const [id, rect] of direct.regions) regions.set(id, rect)
    return { regions, scale: 1, fits: true, warnings }
  }

  if (!allowScaleDown) {
    warnings.push('Screens do not fit inside this output. Enlarge the output or reduce screen resolutions.')
    return { regions, scale: 1, fits: false, warnings }
  }

  let scale = 1
  let result = direct
  for (let attempt = 0; attempt < 40; attempt += 1) {
    scale *= 0.9
    result = pack(scale)
    if (result.fits) break
  }
  if (!result.fits) {
    warnings.push('Screens do not fit inside this output even after scaling down to 1.5% of their native size.')
    return { regions, scale, fits: false, warnings }
  }
  warnings.push(
    `Regions were scaled to ${(scale * 100).toFixed(1)}% so that every screen fits inside "${output.name}".`
  )
  for (const item of sizes) {
    const rect = result.regions.get(item.id)
    if (rect) regions.set(item.id, rect)
  }
  return { regions, scale, fits: true, warnings }
}

/** Sensible default region for a newly assigned screen, placed after existing blocks. */
export function defaultRegionFor(
  output: OutputDevice,
  existing: readonly Rect[],
  size: Size
): Rect {
  const native: Rect = { x: 0, y: 0, width: size.width, height: size.height }
  if (native.width > output.width || native.height > output.height) {
    const fit = Math.min(output.width / native.width, output.height / native.height)
    return {
      x: 0,
      y: 0,
      width: Math.max(1, Math.floor(native.width * fit)),
      height: Math.max(1, Math.floor(native.height * fit))
    }
  }
  let x = 0
  let y = 0
  let guard = 0
  while (guard < 500) {
    guard += 1
    const probe: Rect = { x, y, width: native.width, height: native.height }
    if (!existing.some((rect) => rectsIntersect(rect, probe))) return cloneRect(probe)
    if (x + native.width * 2 + 16 <= output.width) {
      x += native.width + 16
    } else {
      x = 0
      y += native.height + 16
    }
    if (y + native.height > output.height) return { x: 0, y: 0, width: native.width, height: native.height }
  }
  return { x: 0, y: 0, width: native.width, height: native.height }
}

/** Reads and validates a region typed by the operator. */
export function parseRegionInput(
  values: { x: string; y: string; width: string; height: string },
  fallback: Rect
): { region: Rect; errors: Partial<Record<'x' | 'y' | 'width' | 'height', string>> } {
  const errors: Partial<Record<'x' | 'y' | 'width' | 'height', string>> = {}
  const parse = (raw: string, field: 'x' | 'y' | 'width' | 'height', min: number) => {
    const trimmed = raw.trim()
    const n = trimmed === '' ? Number.NaN : Number(trimmed)
    if (!Number.isFinite(n)) {
      errors[field] = 'Must be a whole number of pixels.'
      return fallback[field]
    }
    if (n < min || n > LIMITS.maxOutputPixel * 4) {
      errors[field] = `Must be between ${min} and ${LIMITS.maxOutputPixel * 4}.`
      return fallback[field]
    }
    return Math.round(n)
  }
  const region: Rect = {
    x: parse(values.x, 'x', -LIMITS.maxOutputPixel),
    y: parse(values.y, 'y', -LIMITS.maxOutputPixel),
    width: parse(values.width, 'width', 1),
    height: parse(values.height, 'height', 1)
  }
  return { region, errors }
}
