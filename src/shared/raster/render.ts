import type { OutputDevice, Project, Screen } from '../types'
import type { CombinedMapPlan, MapBlock, OutputMapPlan, StageLayoutPlan } from '../mapping'
import {
  BLACK,
  WHITE,
  createImage,
  drawDashedLine,
  drawRotatedRectOutline,
  drawText,
  fillRect,
  fillRotatedRect,
  lighten,
  parseColor,
  strokeRect,
  withAlpha,
  type IntRect,
  type Rgba,
  type RgbaImage
} from './draw'
import { fitText, measureText } from './font'

/**
 * Export renderers.
 *
 * All renderers are pure functions of the *stored model* and render at the exact
 * export resolution, so zoom, pan and window size can never influence an export.
 * Images are returned as RGBA buffers; PNG encoding happens in
 * `src/main/services/pngEncoder.ts`.
 */

export interface MapRenderOptions {
  showLabels?: boolean
  showGrid?: boolean
  gridStepPx?: number
  showBorders?: boolean
  background?: Rgba
  labelScale?: number
  /** Dim blocks that are visible on the stage but excluded from exports. */
  dimExcluded?: boolean
}

const DEFAULTS: Required<MapRenderOptions> = {
  showLabels: true,
  showGrid: true,
  gridStepPx: 100,
  showBorders: true,
  background: BLACK,
  labelScale: 2,
  dimExcluded: true
}

function resolveOptions(options: MapRenderOptions): Required<MapRenderOptions> {
  return { ...DEFAULTS, ...options }
}

function drawGrid(image: RgbaImage, step: number, color: Rgba): void {
  if (step <= 1) return
  for (let x = step; x < image.width; x += step) {
    drawDashedLine(image, x, 0, x, image.height, color, 6, 6, 1)
  }
  for (let y = step; y < image.height; y += step) {
    drawDashedLine(image, 0, y, image.width, y, color, 6, 6, 1)
  }
}

function drawBlock(
  image: RgbaImage,
  block: MapBlock,
  offsetX: number,
  offsetY: number,
  options: Required<MapRenderOptions>
): void {
  const rect: IntRect = {
    x: block.rect.x + offsetX,
    y: block.rect.y + offsetY,
    width: block.rect.width,
    height: block.rect.height
  }
  const base = parseColor(block.color)
  const included = block.exportVisible
  const alphaScale = included || !options.dimExcluded ? 1 : 0.35
  fillRect(image, rect, withAlpha(base, 58 * alphaScale))

  if (options.showBorders) {
    strokeRect(image, rect, withAlpha(base, included ? 255 : 110), 2)
  }

  if (!options.showLabels) return

  const inner: IntRect = {
    x: rect.x + 6,
    y: rect.y + 6,
    width: rect.width - 12,
    height: rect.height - 12
  }
  if (inner.width < 24 || inner.height < 10) return

  const scale = Math.max(1, Math.round(options.labelScale * (rect.width >= 320 ? 2 : 1)))
  const name = fitText(block.name, inner.width, scale, 1)
  if (name) {
    drawText(image, name, inner.x, inner.y, withAlpha(WHITE, included ? 255 : 150), scale)
  }
  const detail = `${block.native.width}x${block.native.height}`
  const detailScale = Math.max(1, scale - 1)
  const detailHeight = measureText(detail, detailScale, 1).height
  if (inner.height >= 10 + scale * 8 + detailHeight + 4) {
    drawText(
      image,
      fitText(detail, inner.width, detailScale, 1),
      inner.x,
      inner.y + scale * 8 + 4,
      withAlpha(WHITE, included ? 200 : 120),
      detailScale
    )
  }
}

/** Renders one output device as a full-resolution pixel map. */
export function renderOutputMap(
  outputPlan: OutputMapPlan,
  options: MapRenderOptions = {}
): RgbaImage {
  const opts = resolveOptions(options)
  const output: OutputDevice = outputPlan.output
  const image = createImage(output.width, output.height, opts.background)
  if (opts.showGrid) drawGrid(image, opts.gridStepPx, withAlpha(WHITE, 26))
  for (const block of outputPlan.blocks) drawBlock(image, block, 0, 0, opts)
  return image
}

/**
 * Renders the combined pixel map: every output as a stacked band.
 * Image size is `max(output widths) x sum(output heights + gaps)`.
 */
export function renderCombinedMap(
  plan: CombinedMapPlan,
  options: MapRenderOptions = {}
): RgbaImage {
  const opts = resolveOptions(options)
  const image = createImage(plan.width, plan.height, opts.background)

  for (const band of plan.bands) {
    const bandRect: IntRect = { x: 0, y: band.y, width: band.width, height: band.height }
    if (opts.showGrid) {
      for (let x = opts.gridStepPx; x < band.width; x += opts.gridStepPx) {
        drawDashedLine(image, x, band.y, x, band.y + band.height, withAlpha(WHITE, 22), 6, 6, 1)
      }
      for (let y = opts.gridStepPx; y < band.height; y += opts.gridStepPx) {
        drawDashedLine(image, 0, band.y + y, band.width, band.y + y, withAlpha(WHITE, 22), 6, 6, 1)
      }
    }
    strokeRect(image, bandRect, withAlpha(WHITE, 48), 1)
    const label = fitText(band.outputName, Math.max(40, band.width - 16), 2, 1)
    if (label) {
      const metrics = measureText(label, 2, 1)
      fillRect(
        image,
        {
          x: 6,
          y: band.y + 6,
          width: metrics.width + 10,
          height: metrics.height + 8
        },
        withAlpha(BLACK, 190)
      )
      drawText(image, label, 11, band.y + 10, WHITE, 2)
    }
  }

  for (const block of plan.blocks) {
    drawBlock(image, block, block.offsetX, block.offsetY, opts)
  }

  if (plan.bands.length > 1) {
    for (const band of plan.bands.slice(1)) {
      fillRect(image, { x: 0, y: band.y - 1, width: image.width, height: 2 }, withAlpha(WHITE, 90))
    }
  }

  return image
}

export interface ScreenGuideOptions {
  showCenterCross?: boolean
  showSafeArea?: boolean
  safeAreaPercent?: number
  showCornerMarks?: boolean
  showInfoPanel?: boolean
  showGrid?: boolean
  gridStepPx?: number
  background?: Rgba
  subtitle?: string
}

/**
 * Native-resolution content guide for one screen.
 *
 * Produced at exactly `screen.pixelWidth x screen.pixelHeight`, independent of the
 * mapping region, so a content author can build artwork at the true native size.
 */
export function renderScreenGuide(
  project: Project,
  screen: Screen,
  options: ScreenGuideOptions = {}
): RgbaImage {
  const width = Math.max(1, Math.round(screen.pixelWidth))
  const height = Math.max(1, Math.round(screen.pixelHeight))
  const image = createImage(width, height, options.background ?? BLACK)
  const accent = lighten(parseColor(screen.color), 0.15)
  const guide = withAlpha(WHITE, 120)

  if (options.showGrid) {
    const step = options.gridStepPx ?? Math.max(50, Math.round(Math.min(width, height) / 12))
    drawGrid(image, step, withAlpha(WHITE, 18))
  }

  strokeRect(image, { x: 0, y: 0, width, height }, withAlpha(WHITE, 200), 2)

  if (options.showSafeArea) {
    const pct = Math.max(0, Math.min(45, options.safeAreaPercent ?? 10)) / 100
    const inset: IntRect = {
      x: Math.round(width * pct),
      y: Math.round(height * pct),
      width: Math.round(width * (1 - pct * 2)),
      height: Math.round(height * (1 - pct * 2))
    }
    drawDashedLine(image, inset.x, inset.y, inset.x + inset.width, inset.y, guide, 8, 6, 1)
    drawDashedLine(
      image,
      inset.x + inset.width,
      inset.y,
      inset.x + inset.width,
      inset.y + inset.height,
      guide,
      8,
      6,
      1
    )
    drawDashedLine(
      image,
      inset.x + inset.width,
      inset.y + inset.height,
      inset.x,
      inset.y + inset.height,
      guide,
      8,
      6,
      1
    )
    drawDashedLine(image, inset.x, inset.y + inset.height, inset.x, inset.y, guide, 8, 6, 1)
  }

  if (options.showCenterCross !== false) {
    const cx = Math.floor(width / 2)
    const cy = Math.floor(height / 2)
    const arm = Math.max(12, Math.round(Math.min(width, height) * 0.04))
    drawDashedLine(image, cx - arm, cy, cx + arm, cy, withAlpha(accent, 200), 6, 4, 1)
    drawDashedLine(image, cx, cy - arm, cx, cy + arm, withAlpha(accent, 200), 6, 4, 1)
  }

  if (options.showCornerMarks !== false) {
    const len = Math.max(16, Math.round(Math.min(width, height) * 0.06))
    const t = Math.max(2, Math.round(Math.min(width, height) / 400))
    const marks: [number, number, number, number][] = [
      [0, 0, len, len],
      [width, 0, -len, len],
      [width, height, -len, -len],
      [0, height, len, -len]
    ]
    for (const [x, y, dx, dy] of marks) {
      drawDashedLine(image, x, y, x + dx, y, accent, 4, 3, t)
      drawDashedLine(image, x, y, x, y + dy, accent, 4, 3, t)
    }
  }

  if (options.showInfoPanel !== false) {
    const scale = Math.max(1, Math.round(Math.min(width, height) / 400))
    const lines = [
      screen.name,
      `${screen.pixelWidth} x ${screen.pixelHeight} ${screen.pixelPitchMm ? `· P${screen.pixelPitchMm}` : ''}`.trim(),
      `${(screen.widthMm / 1000).toFixed(3)} m x ${(screen.heightMm / 1000).toFixed(3)} m`,
      options.subtitle ?? `PROJECT ${project.meta.name}`
    ].filter((line) => line.length > 0)
    const lineHeight = 8 * scale + 3 * scale
    const panelWidth = Math.max(...lines.map((line) => measureText(line, scale, 1).width)) + 16
    const panelHeight = lines.length * lineHeight + 10
    if (panelWidth < width - 8 && panelHeight < height - 8) {
      fillRect(image, { x: 6, y: 6, width: panelWidth, height: panelHeight }, withAlpha(BLACK, 200))
      strokeRect(image, { x: 6, y: 6, width: panelWidth, height: panelHeight }, withAlpha(accent, 160), 1)
      lines.forEach((line, index) => {
        drawText(
          image,
          fitText(line, panelWidth - 12, scale, 1),
          12,
          11 + index * lineHeight,
          index === 0 ? WHITE : withAlpha(WHITE, 190),
          scale,
          1
        )
      })
    }
  }

  return image
}

export interface StageLayoutOptions {
  pxPerMeter?: number
  showGrid?: boolean
  showLabels?: boolean
  showDimensions?: boolean
  background?: Rgba
  marginMm?: number
}

/**
 * Physical stage layout export (top view). Rendered from stored millimetres at a
 * fixed px-per-metre scale, so the viewport has no influence on the result.
 */
export function renderStageLayout(
  project: Project,
  plan: StageLayoutPlan,
  options: StageLayoutOptions = {}
): RgbaImage {
  const bounds = plan.bounds
  const defaultPxPerMeter = Math.max(4, Math.min(240, 2048 / Math.max(bounds.width / 1000, 0.001)))
  const pxPerMeter = options.pxPerMeter ?? defaultPxPerMeter
  const pxPerMm = pxPerMeter / 1000
  const width = Math.max(16, Math.round(bounds.width * pxPerMm))
  const height = Math.max(16, Math.round(bounds.height * pxPerMm))
  const image = createImage(width, height, options.background ?? BLACK)

  const toPx = (xMm: number, yMm: number) => ({
    x: (xMm - bounds.x) * pxPerMm,
    y: (yMm - bounds.y) * pxPerMm
  })

  if (options.showGrid !== false) {
    const stepM = pxPerMeter > 60 ? 0.5 : 1
    for (let m = 0; m <= bounds.width / 1000; m += stepM) {
      const x = Math.round((m * 1000 - bounds.x) * pxPerMm)
      if (x >= 0 && x < width) drawDashedLine(image, x, 0, x, height, withAlpha(WHITE, 24), 4, 6, 1)
    }
    for (let m = 0; m <= bounds.height / 1000; m += stepM) {
      const y = Math.round((m * 1000 - bounds.y) * pxPerMm)
      if (y >= 0 && y < height) drawDashedLine(image, 0, y, width, y, withAlpha(WHITE, 24), 4, 6, 1)
    }
  }

  const stageTopLeft = toPx(0, 0)
  const stageRect: IntRect = {
    x: stageTopLeft.x,
    y: stageTopLeft.y,
    width: project.stage.widthMm * pxPerMm,
    height: project.stage.heightMm * pxPerMm
  }
  strokeRect(image, stageRect, withAlpha(WHITE, 140), 1)

  for (const block of plan.blocks) {
    const topLeft = toPx(block.rect.x, block.rect.y)
    const rect: IntRect = {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.max(1, block.rect.width * pxPerMm),
      height: Math.max(1, block.rect.height * pxPerMm)
    }
    const color = parseColor(block.color)
    fillRotatedRect(image, rect, block.rotationDeg, withAlpha(color, 70))
    drawRotatedRectOutline(image, rect, block.rotationDeg, withAlpha(color, 235), 2)

    if (options.showLabels !== false && rect.width > 40 && rect.height > 14) {
      const scale = Math.max(1, Math.round(Math.min(rect.width / 90, rect.height / 30)))
      const label = fitText(block.name, rect.width - 8, scale, 1)
      if (label) {
        drawText(image, label, rect.x + 4, rect.y + 4, WHITE, scale)
      }
      if (options.showDimensions !== false && rect.height > 30) {
        const detail = `${(block.rect.width / 1000).toFixed(2)}x${(block.rect.height / 1000).toFixed(2)}M`
        if (measureText(detail, 1, 1).width <= rect.width - 8) {
          drawText(image, detail, rect.x + 4, rect.y + 4 + scale * 9, withAlpha(WHITE, 190), 1)
        }
      }
    }
  }

  return image
}
