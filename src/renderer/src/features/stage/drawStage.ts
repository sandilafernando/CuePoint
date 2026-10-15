import type { CanvasView, Project, Rect, Size } from '@shared/types'
import {
  handlePoint,
  mmToView,
  rectCenter,
  rotatedBounds,
  type SnapCandidate
} from '@shared/geometry'
import { screenGeometryRect } from '@shared/project'
import { SELECTION_HANDLES } from './interaction'

/**
 * Stage canvas painter.
 *
 * Everything is drawn from the stored model plus the current view transform: the canvas is
 * a pure projection of project state, which is what keeps zoom, pan and window resizing
 * from ever touching saved geometry.
 */

export interface StageDrawState {
  project: Project
  view: CanvasView
  viewport: Size
  selection: readonly string[]
  hoveredId: string | null
  guides: readonly SnapCandidate[]
  marquee: Rect | null
  background: HTMLImageElement | null
  missingBackground: boolean
  devicePixelRatio: number
  showRulers: boolean
}

const COLORS = {
  canvasBackground: '#0f1216',
  stageFill: '#151a20',
  stageBorder: '#39424e',
  gridMinor: 'rgba(255,255,255,0.045)',
  gridMajor: 'rgba(255,255,255,0.1)',
  screenStroke: 'rgba(0,0,0,0.45)',
  selection: '#4c9aff',
  handleFill: '#0f1216',
  hover: 'rgba(76,154,255,0.55)',
  guide: '#f2b544',
  label: 'rgba(255,255,255,0.82)',
  muted: 'rgba(255,255,255,0.35)',
  marquee: 'rgba(76,154,255,0.16)',
  ruler: 'rgba(255,255,255,0.28)'
}

function viewPointOf(xMm: number, yMm: number, state: StageDrawState): { x: number; y: number } {
  return mmToView({ x: xMm, y: yMm }, state.project.stage.canvasPxPerMeter, state.view)
}

function traceRect(
  context: CanvasRenderingContext2D,
  rect: Rect,
  state: StageDrawState,
  rotationDeg = 0
): void {
  const topLeft = viewPointOf(rect.x, rect.y, state)
  const width = rect.width * (state.project.stage.canvasPxPerMeter / 1000) * state.view.zoom
  const height = rect.height * (state.project.stage.canvasPxPerMeter / 1000) * state.view.zoom
  context.beginPath()
  if (rotationDeg === 0) {
    context.rect(topLeft.x, topLeft.y, width, height)
    return
  }
  const center = rectCenter(rect)
  const centerView = viewPointOf(center.x, center.y, state)
  context.save()
  context.translate(centerView.x, centerView.y)
  context.rotate((rotationDeg * Math.PI) / 180)
  context.rect(-width / 2, -height / 2, width, height)
  context.restore()
}

function drawStageSurface(context: CanvasRenderingContext2D, state: StageDrawState): void {
  const { stage } = state.project
  const stageRect: Rect = { x: 0, y: 0, width: stage.widthMm, height: stage.heightMm }
  traceRect(context, stageRect, state)
  context.fillStyle = COLORS.stageFill
  context.fill()

  // Drop shadow so the stage reads as a surface above the workspace.
  context.save()
  context.strokeStyle = 'rgba(0,0,0,0.5)'
  context.lineWidth = 6
  context.stroke()
  context.restore()

  const topLeft = viewPointOf(0, 0, state)
  const width = (stage.widthMm / 1000) * stage.canvasPxPerMeter * state.view.zoom
  const height = (stage.heightMm / 1000) * stage.canvasPxPerMeter * state.view.zoom

  if (stage.gridVisible) {
    const spacing = stage.gridSpacingMm > 0 ? stage.gridSpacingMm : 500
    const subdivisions = Math.max(1, Math.round(stage.gridSubdivisions || 1))
    const minorStep = spacing / subdivisions
    const pixelsPerMm = (stage.canvasPxPerMeter / 1000) * state.view.zoom
    const shouldDrawMinor = minorStep * pixelsPerMm >= 4

    context.save()
    context.beginPath()
    context.rect(topLeft.x, topLeft.y, width, height)
    context.clip()

    if (shouldDrawMinor) {
      context.strokeStyle = COLORS.gridMinor
      context.lineWidth = 1
      context.beginPath()
      for (let x = minorStep; x < stage.widthMm; x += minorStep) {
        const point = viewPointOf(x, 0, state)
        context.moveTo(point.x, topLeft.y)
        context.lineTo(point.x, topLeft.y + height)
      }
      for (let y = minorStep; y < stage.heightMm; y += minorStep) {
        const point = viewPointOf(0, y, state)
        context.moveTo(topLeft.x, point.y)
        context.lineTo(topLeft.x + width, point.y)
      }
      context.stroke()
    }

    context.strokeStyle = COLORS.gridMajor
    context.beginPath()
    for (let x = spacing; x < stage.widthMm; x += spacing) {
      const point = viewPointOf(x, 0, state)
      context.moveTo(point.x, topLeft.y)
      context.lineTo(point.x, topLeft.y + height)
    }
    for (let y = spacing; y < stage.heightMm; y += spacing) {
      const point = viewPointOf(0, y, state)
      context.moveTo(topLeft.x, point.y)
      context.lineTo(topLeft.x + width, point.y)
    }
    context.stroke()
    context.restore()
  }

  context.strokeStyle = COLORS.stageBorder
  context.lineWidth = 1.5
  context.strokeRect(topLeft.x + 0.75, topLeft.y + 0.75, width - 1.5, height - 1.5)

  if (state.showRulers && width > 120 && height > 80) {
    context.fillStyle = COLORS.ruler
    context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace'
    context.textBaseline = 'top'
    const spacing = stage.gridSpacingMm >= 500 ? stage.gridSpacingMm : 1000
    for (let x = spacing; x < stage.widthMm; x += spacing) {
      const point = viewPointOf(x, 0, state)
      context.fillText(`${Math.round(x / 10)}cm`, point.x + 4, topLeft.y + 4)
    }
    for (let y = spacing; y < stage.heightMm; y += spacing) {
      const point = viewPointOf(0, y, state)
      context.fillText(`${Math.round(y / 10)}cm`, topLeft.x + 4, point.y + 4)
    }
  }
}

function drawBackground(context: CanvasRenderingContext2D, state: StageDrawState): void {
  const { background } = state.project.stage
  const image = state.background
  if (!background.visible) return
  if (!image && !state.missingBackground) return

  const stage = state.project.stage
  const stageRect: Rect = { x: 0, y: 0, width: stage.widthMm, height: stage.heightMm }
  context.save()
  traceRect(context, stageRect, state)
  context.clip()

  if (!image) {
    context.fillStyle = 'rgba(242,181,68,0.08)'
    context.fill()
    context.strokeStyle = 'rgba(242,181,68,0.5)'
    context.setLineDash([6, 4])
    context.lineWidth = 2
    context.stroke()
    context.restore()
    const point = viewPointOf(stage.widthMm / 2, stage.heightMm / 2, state)
    context.fillStyle = COLORS.muted
    context.font = '12px ui-sans-serif, system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillText('Stage background image is missing', point.x, point.y)
    context.textAlign = 'left'
    return
  }

  const sourceWidth = background.sourceWidth ?? image.naturalWidth ?? 1
  const sourceHeight = background.sourceHeight ?? image.naturalHeight ?? 1
  const fitScaleX = stage.widthMm / sourceWidth
  const fitScaleY = stage.heightMm / sourceHeight
  let scale = 1
  switch (background.fit) {
    case 'contain':
      scale = Math.min(fitScaleX, fitScaleY)
      break
    case 'cover':
      scale = Math.max(fitScaleX, fitScaleY)
      break
    case 'stretch':
      scale = 0
      break
    case 'none':
      scale = 1000 / 96 // 1 image pixel ≈ 1/96 inch, matching typical photo DPI metadata.
      break
    default:
      scale = Math.min(fitScaleX, fitScaleY)
  }
  scale *= background.scale > 0 ? background.scale : 1

  const drawWidthPx = background.fit === 'stretch' ? stage.widthMm : sourceWidth * scale
  const drawHeightPx = background.fit === 'stretch' ? stage.heightMm : sourceHeight * scale
  const originXMm = background.fit === 'stretch' ? 0 : (stage.widthMm - drawWidthPx) / 2
  const originYMm = background.fit === 'stretch' ? 0 : (stage.heightMm - drawHeightPx) / 2

  const origin = viewPointOf(
    originXMm + background.offsetXMm,
    originYMm + background.offsetYMm,
    state
  )
  const pixelsPerMm = (stage.canvasPxPerMeter / 1000) * state.view.zoom
  const drawWidth = drawWidthPx * pixelsPerMm
  const drawHeight = drawHeightPx * pixelsPerMm

  context.globalAlpha = Math.min(1, Math.max(0.02, background.opacity))
  if (background.rotationDeg) {
    context.save()
    const center = viewPointOf(stage.widthMm / 2, stage.heightMm / 2, state)
    context.translate(center.x, center.y)
    context.rotate((background.rotationDeg * Math.PI) / 180)
    context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    context.restore()
  } else {
    context.drawImage(image, origin.x, origin.y, drawWidth, drawHeight)
  }
  context.globalAlpha = 1
  context.restore()
}

function drawScreens(context: CanvasRenderingContext2D, state: StageDrawState): void {
  const { stage } = state.project
  const pixelsPerMm = (stage.canvasPxPerMeter / 1000) * state.view.zoom
  const ordered = [...state.project.screens].sort((a, b) => a.order - b.order)
  const selection = new Set(state.selection)

  for (const screen of ordered) {
    const rect = screenGeometryRect(screen)
    const selected = selection.has(screen.id)
    const hovered = state.hoveredId === screen.id
    const alpha = screen.visible ? 1 : 0.32

    context.save()
    context.globalAlpha = alpha
    traceRect(context, rect, state, screen.rotationDeg)
    context.fillStyle = withAlpha(screen.color, screen.visible ? 0.62 : 0.2)
    context.fill()
    context.strokeStyle = selected ? COLORS.selection : hovered ? COLORS.hover : COLORS.screenStroke
    context.lineWidth = selected ? 2 : hovered ? 1.8 : 1.2
    context.stroke()

    if (!screen.visible) {
      context.setLineDash([5, 4])
      context.strokeStyle = COLORS.muted
      context.lineWidth = 1
      context.stroke()
      context.setLineDash([])
    }

    const topLeft = viewPointOf(rect.x, rect.y, state)
    const width = rect.width * pixelsPerMm
    const height = rect.height * pixelsPerMm

    if (width > 46 && height > 26) {
      context.save()
      context.translate(topLeft.x + width / 2, topLeft.y + height / 2)
      context.rotate((screen.rotationDeg * Math.PI) / 180)
      context.fillStyle = COLORS.label
      context.font = '12px ui-sans-serif, system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(screen.name, 0, width > 120 ? -6 : 0, Math.max(20, width - 12))
      if (width > 120) {
        context.fillStyle = withAlpha(screen.color, 0.95)
        context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace'
        context.fillText(
          `${screen.pixelWidth}×${screen.pixelHeight}`,
          0,
          9,
          Math.max(20, width - 12)
        )
      }
      context.restore()
    }

    if (screen.locked) {
      const bounds = rotatedBounds(rect, screen.rotationDeg)
      const pad = viewPointOf(bounds.x - 60, bounds.y - 60, state)
      context.fillStyle = 'rgba(255,255,255,0.5)'
      context.font = '11px ui-sans-serif, system-ui, sans-serif'
      context.fillText('🔒', pad.x + 6, pad.y + 18)
    }

    context.restore()
  }
}

function drawSelectionChrome(context: CanvasRenderingContext2D, state: StageDrawState): void {
  const selected = state.project.screens.filter((screen) => state.selection.includes(screen.id))
  if (selected.length === 0) return
  const pixelsPerMm = (state.project.stage.canvasPxPerMeter / 1000) * state.view.zoom

  for (const screen of selected) {
    const rect = screenGeometryRect(screen)
    context.save()
    traceRect(context, rect, state, screen.rotationDeg)
    context.strokeStyle = COLORS.selection
    context.lineWidth = 2
    context.stroke()
    context.restore()

    if (selected.length === 1 && !screen.locked) {
      // Rotation grip stem.
      const topCenter = handlePoint(rect, screen.rotationDeg, 'n')
      const center = rectCenter(rect)
      const direction = {
        x: (topCenter.x - center.x) / Math.max(1, rect.height / 2),
        y: (topCenter.y - center.y) / Math.max(1, rect.height / 2)
      }
      const stemMm = 28 / Math.max(pixelsPerMm, 1e-6)
      const gripMm = {
        x: topCenter.x + direction.x * stemMm,
        y: topCenter.y + direction.y * stemMm
      }
      const topView = viewPointOf(topCenter.x, topCenter.y, state)
      const gripView = viewPointOf(gripMm.x, gripMm.y, state)
      context.save()
      context.strokeStyle = COLORS.selection
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(topView.x, topView.y)
      context.lineTo(gripView.x, gripView.y)
      context.stroke()
      context.beginPath()
      context.arc(gripView.x, gripView.y, 5, 0, Math.PI * 2)
      context.fillStyle = COLORS.handleFill
      context.fill()
      context.stroke()
      context.restore()
    }
  }

  if (selected.length === 1 && !selected[0].locked) {
    const rect = screenGeometryRect(selected[0])
    for (const handle of SELECTION_HANDLES) {
      const point = handlePoint(rect, selected[0].rotationDeg, handle)
      const view = viewPointOf(point.x, point.y, state)
      context.beginPath()
      context.rect(view.x - 4, view.y - 4, 8, 8)
      context.fillStyle = COLORS.handleFill
      context.fill()
      context.strokeStyle = COLORS.selection
      context.lineWidth = 1.5
      context.stroke()
    }
  }
}

function drawGuides(context: CanvasRenderingContext2D, state: StageDrawState): void {
  if (state.guides.length === 0) return
  context.save()
  context.strokeStyle = COLORS.guide
  context.lineWidth = 1
  context.setLineDash([5, 3])
  for (const guide of state.guides) {
    const from = viewPointOf(
      guide.axis === 'x' ? guide.value : guide.from,
      guide.axis === 'x' ? guide.from : guide.value,
      state
    )
    const to = viewPointOf(
      guide.axis === 'x' ? guide.value : guide.to,
      guide.axis === 'x' ? guide.to : guide.value,
      state
    )
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }
  context.restore()
}

function drawMarquee(context: CanvasRenderingContext2D, state: StageDrawState): void {
  if (!state.marquee) return
  const topLeft = viewPointOf(state.marquee.x, state.marquee.y, state)
  const pixelsPerMm = (state.project.stage.canvasPxPerMeter / 1000) * state.view.zoom
  context.save()
  context.fillStyle = COLORS.marquee
  context.fillRect(topLeft.x, topLeft.y, state.marquee.width * pixelsPerMm, state.marquee.height * pixelsPerMm)
  context.strokeStyle = COLORS.selection
  context.lineWidth = 1
  context.setLineDash([4, 3])
  context.strokeRect(topLeft.x, topLeft.y, state.marquee.width * pixelsPerMm, state.marquee.height * pixelsPerMm)
  context.restore()
}

export function drawStage(context: CanvasRenderingContext2D, state: StageDrawState): void {
  const { viewport, devicePixelRatio } = state
  context.save()
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  context.fillStyle = COLORS.canvasBackground
  context.fillRect(0, 0, viewport.width, viewport.height)
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'

  drawStageSurface(context, state)
  drawBackground(context, state)
  drawScreens(context, state)
  drawSelectionChrome(context, state)
  drawGuides(context, state)
  drawMarquee(context, state)
  context.restore()
}

/** Screen colour with variable alpha, accepting both hex and rgb() inputs. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const value = Number.parseInt(full.slice(0, 6), 16)
    if (Number.isNaN(value)) return `rgba(76,154,255,${alpha})`
    const r = (value >> 16) & 255
    const g = (value >> 8) & 255
    const b = value & 255
    return `rgba(${r},${g},${b},${alpha})`
  }
  return color
}
