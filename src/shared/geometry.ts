import type { CanvasView, Point, Rect, Size, ViewportSize } from './types'
import { clamp } from './units'

/**
 * Geometry core.
 *
 * Coordinate systems
 * ------------------
 * 1. Stage space   — millimetres, origin at the stage's top-left, +x right, +y down.
 * 2. Canvas space  — logical canvas pixels: `mmPerCanvasPx = 1000 / canvasPxPerMeter`.
 *                    Stage space is scaled into canvas space by `canvasPxPerMeter`.
 * 3. View space    — canvas space after zoom/pan. View space is the only place
 *                    zoom and pan exist; stored geometry is never rewritten by them.
 * 4. Output space  — output device pixels used by the mapping engine.
 *
 * A screen is stored as an axis-aligned rect (x, y, width, height) in millimetres plus
 * a rotation about that rect's centre. This keeps the stored model unambiguous while
 * still supporting rotated screens.
 */

export const DEG = Math.PI / 180

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isFiniteRect(rect: Rect): boolean {
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height)
  )
}

export function makeRect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

export function rectWidth(rect: Rect): number {
  return rect.width
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function rectRight(rect: Rect): number {
  return rect.x + rect.width
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.height
}

export function rectArea(rect: Rect): number {
  return rect.width * rect.height
}

export function rectEquals(a: Rect, b: Rect, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  )
}

export function cloneRect(rect: Rect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** A rect containing both inputs (axis-aligned, ignores rotation). */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(rectRight(a), rectRight(b)) - x,
    height: Math.max(rectBottom(a), rectBottom(b)) - y
  }
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  let acc = cloneRect(rects[0])
  for (let i = 1; i < rects.length; i += 1) acc = unionRect(acc, rects[i])
  return acc
}

export function rectsIntersect(a: Rect, b: Rect, epsilon = 0): boolean {
  return (
    a.x + epsilon < rectRight(b) &&
    rectRight(a) - epsilon > b.x &&
    a.y + epsilon < rectBottom(b) &&
    rectBottom(a) - epsilon > b.y
  )
}

export function intersectionRect(a: Rect, b: Rect): Rect | null {
  if (!rectsIntersect(a, b)) return null
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    width: Math.min(rectRight(a), rectRight(b)) - x,
    height: Math.min(rectBottom(a), rectBottom(b)) - y
  }
}

export function inflateRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  }
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rectRight(rect) &&
    point.y >= rect.y &&
    point.y <= rectBottom(rect)
  )
}

export function rectContainsRect(outer: Rect, inner: Rect, epsilon = 1e-6): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    rectRight(inner) <= rectRight(outer) + epsilon &&
    rectBottom(inner) <= rectBottom(outer) + epsilon
  )
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export function normalizeDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  let d = deg % 360
  if (d < 0) d += 360
  return d
}

/** Rotates `point` around `origin` by `deg` degrees clockwise (screen space, +y down). */
export function rotatePoint(point: Point, origin: Point, deg: number): Point {
  if (deg === 0) return { x: point.x, y: point.y }
  const rad = deg * DEG
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos
  }
}

export type RectHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const RECT_HANDLES: readonly RectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** The four corners of a rotated rect, in order nw, ne, se, sw. */
export function rectCorners(rect: Rect, rotationDeg = 0): [Point, Point, Point, Point] {
  const c = rectCenter(rect)
  const nw = { x: rect.x, y: rect.y }
  const ne = { x: rectRight(rect), y: rect.y }
  const se = { x: rectRight(rect), y: rectBottom(rect) }
  const sw = { x: rect.x, y: rectBottom(rect) }
  return [
    rotatePoint(nw, c, rotationDeg),
    rotatePoint(ne, c, rotationDeg),
    rotatePoint(se, c, rotationDeg),
    rotatePoint(sw, c, rotationDeg)
  ]
}

/** World position of a resize handle on a rotated rect. */
export function handlePoint(rect: Rect, rotationDeg: number, handle: RectHandle): Point {
  const c = rectCenter(rect)
  const local: Point = {
    x: handle.includes('w') ? rect.x : handle.includes('e') ? rectRight(rect) : c.x,
    y: handle.includes('n') ? rect.y : handle.includes('s') ? rectBottom(rect) : c.y
  }
  return rotatePoint(local, c, rotationDeg)
}

/** Axis-aligned bounding box of a rotated rect. */
export function rotatedBounds(rect: Rect, rotationDeg = 0): Rect {
  if (!rotationDeg) return cloneRect(rect)
  const corners = rectCorners(rect, rotationDeg)
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY
  }
}

/**
 * Point-in-rect test that accounts for rotation: the point is mapped into the
 * rect's local (unrotated) frame before testing.
 */
export function rotatedRectContainsPoint(rect: Rect, rotationDeg: number, point: Point): boolean {
  const local = rotatePoint(point, rectCenter(rect), -rotationDeg)
  return rectContainsPoint(rect, local)
}

/** Distance from the point to the rect edge, negative when inside. */
export function distanceToRotatedRect(rect: Rect, rotationDeg: number, point: Point): number {
  const local = rotatePoint(point, rectCenter(rect), -rotationDeg)
  const dx = Math.max(rect.x - local.x, local.x - rectRight(rect))
  const dy = Math.max(rect.y - local.y, local.y - rectBottom(rect))
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
}

// ---------------------------------------------------------------------------
// Canvas / view transforms
// ---------------------------------------------------------------------------

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 40

/** Stage millimetres -> logical canvas pixels (zoom/pan independent). */
export function mmToCanvas(mm: number, canvasPxPerMeter: number): number {
  return (mm / 1000) * canvasPxPerMeter
}

export function canvasToMm(px: number, canvasPxPerMeter: number): number {
  return (px / canvasPxPerMeter) * 1000
}

/** Logical canvas pixels -> view pixels (zoom + pan applied). */
export function canvasToView(px: Point, view: CanvasView): Point {
  return { x: px.x * view.zoom + view.panX, y: px.y * view.zoom + view.panY }
}

export function viewToCanvas(point: Point, view: CanvasView): Point {
  return { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom }
}

/** Stage millimetres -> view pixels. */
export function mmToView(
  point: Point,
  canvasPxPerMeter: number,
  view: CanvasView
): Point {
  return canvasToView(
    { x: mmToCanvas(point.x, canvasPxPerMeter), y: mmToCanvas(point.y, canvasPxPerMeter) },
    view
  )
}

/** View pixels -> stage millimetres. */
export function viewToMm(
  point: Point,
  canvasPxPerMeter: number,
  view: CanvasView
): Point {
  const c = viewToCanvas(point, view)
  return { x: canvasToMm(c.x, canvasPxPerMeter), y: canvasToMm(c.y, canvasPxPerMeter) }
}

/** Combined view-space scale factor: view pixels per stage millimetre. */
export function viewScale(canvasPxPerMeter: number, view: CanvasView): number {
  return (canvasPxPerMeter / 1000) * view.zoom
}

/** Vertical/horizontal flip detection — the model never mirrors, but helpers exist for exports. */
export function stageRectToCanvasRect(rect: Rect, canvasPxPerMeter: number): Rect {
  return {
    x: mmToCanvas(rect.x, canvasPxPerMeter),
    y: mmToCanvas(rect.y, canvasPxPerMeter),
    width: mmToCanvas(rect.width, canvasPxPerMeter),
    height: mmToCanvas(rect.height, canvasPxPerMeter)
  }
}

export interface FitViewOptions {
  paddingPx?: number
  maxZoom?: number
}

/** View transform that shows `bounds` (stage mm) centred inside `viewport`. */
export function fitViewToBounds(
  bounds: Rect,
  viewport: ViewportSize,
  canvasPxPerMeter: number,
  options: FitViewOptions = {}
): CanvasView {
  const padding = options.paddingPx ?? 48
  const maxZoom = options.maxZoom ?? MAX_ZOOM
  const availW = Math.max(1, viewport.width - padding * 2)
  const availH = Math.max(1, viewport.height - padding * 2)
  const boundsCanvas = stageRectToCanvasRect(bounds, canvasPxPerMeter)
  const width = Math.max(boundsCanvas.width, 1e-6)
  const height = Math.max(boundsCanvas.height, 1e-6)
  const zoom = clamp(Math.min(availW / width, availH / height), MIN_ZOOM, maxZoom)
  const centerCanvas = {
    x: boundsCanvas.x + boundsCanvas.width / 2,
    y: boundsCanvas.y + boundsCanvas.height / 2
  }
  return {
    zoom,
    panX: viewport.width / 2 - centerCanvas.x * zoom,
    panY: viewport.height / 2 - centerCanvas.y * zoom
  }
}

/** Zooms about a fixed view-space point, so the content under the cursor stays put. */
export function zoomAtViewPoint(
  view: CanvasView,
  viewPoint: Point,
  factor: number,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM
): CanvasView {
  const nextZoom = clamp(view.zoom * factor, minZoom, maxZoom)
  if (nextZoom === view.zoom) return { ...view }
  const canvasPoint = viewToCanvas(viewPoint, view)
  return {
    zoom: nextZoom,
    panX: viewPoint.x - canvasPoint.x * nextZoom,
    panY: viewPoint.y - canvasPoint.y * nextZoom
  }
}

export function viewScalePercent(view: CanvasView): number {
  return Math.round(view.zoom * 100)
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export interface SnapCandidate {
  axis: 'x' | 'y'
  value: number
  /** Stage coordinates of the line to draw as a guide. */
  from: number
  to: number
  kind: 'grid' | 'screen' | 'stage' | 'guide' | 'center'
  label?: string
}

export interface SnapResult {
  delta: Point
  guides: SnapCandidate[]
}

export interface SnapOptions {
  toleranceMm: number
  /** Stage-mm x/y candidate lines. */
  candidates: SnapCandidate[]
  /** Snap the rect's left/centre/right and top/middle/bottom edges. */
  edges?: ('start' | 'center' | 'end')[]
}

function edgesFor(rect: Rect, axis: 'x' | 'y', edges: ('start' | 'center' | 'end')[]): number[] {
  const start = axis === 'x' ? rect.x : rect.y
  const size = axis === 'x' ? rect.width : rect.height
  return edges.map((e) => (e === 'start' ? start : e === 'center' ? start + size / 2 : start + size))
}

/**
 * Computes the translation that snaps a rect to nearby candidate lines.
 * When both edges and centre are within tolerance the closest wins; ties prefer the
 * move with the smallest magnitude so nudging stays predictable.
 */
export function computeSnap(rect: Rect, options: SnapOptions): SnapResult {
  const edges = options.edges ?? ['start', 'center', 'end']
  const delta: Point = { x: 0, y: 0 }
  const guides: SnapCandidate[] = []

  for (const axis of ['x', 'y'] as const) {
    const rectEdges = edgesFor(rect, axis, edges)
    let best: { delta: number; candidate: SnapCandidate } | null = null
    for (const candidate of options.candidates) {
      if (candidate.axis !== axis) continue
      for (const edge of rectEdges) {
        const diff = candidate.value - edge
        if (Math.abs(diff) > options.toleranceMm) continue
        if (!best || Math.abs(diff) < Math.abs(best.delta)) {
          best = { delta: diff, candidate }
        }
      }
    }
    if (best) {
      if (axis === 'x') delta.x = best.delta
      else delta.y = best.delta
      guides.push(best.candidate)
    }
  }

  return { delta, guides }
}

export function snapValueToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value
  return Math.round(value / step) * step
}

/** Builds grid candidate lines covering `rect` within the tolerance window. */
export function gridCandidates(
  rect: Rect,
  stage: Rect,
  stepMm: number,
  toleranceMm: number
): SnapCandidate[] {
  if (!Number.isFinite(stepMm) || stepMm <= 0) return []
  const out: SnapCandidate[] = []
  const startX = Math.max(stage.x, rect.x - toleranceMm)
  const endX = Math.min(rectRight(stage), rectRight(rect) + toleranceMm)
  const startY = Math.max(stage.y, rect.y - toleranceMm)
  const endY = Math.min(rectBottom(stage), rectBottom(rect) + toleranceMm)
  for (let x = Math.ceil(startX / stepMm) * stepMm; x <= endX; x += stepMm) {
    out.push({ axis: 'x', value: x, from: stage.y, to: rectBottom(stage), kind: 'grid' })
  }
  for (let y = Math.ceil(startY / stepMm) * stepMm; y <= endY; y += stepMm) {
    out.push({ axis: 'y', value: y, from: stage.x, to: rectRight(stage), kind: 'grid' })
  }
  return out
}

/** Candidate lines derived from other screens (their edges and centres). */
export function screenCandidates(
  rects: { id: string; rect: Rect; rotationDeg: number; name: string }[],
  excludeIds: ReadonlySet<string>
): SnapCandidate[] {
  const out: SnapCandidate[] = []
  for (const item of rects) {
    if (excludeIds.has(item.id)) continue
    const b = rotatedBounds(item.rect, item.rotationDeg)
    const xs = [b.x, b.x + b.width / 2, rectRight(b)]
    const ys = [b.y, b.y + b.height / 2, rectBottom(b)]
    for (const x of xs) {
      out.push({ axis: 'x', value: x, from: b.y, to: rectBottom(b), kind: 'screen', label: item.name })
    }
    for (const y of ys) {
      out.push({ axis: 'y', value: y, from: b.x, to: rectRight(b), kind: 'screen', label: item.name })
    }
  }
  return out
}

export function stageCandidates(stage: Rect): SnapCandidate[] {
  return [
    { axis: 'x', value: stage.x, from: stage.y, to: rectBottom(stage), kind: 'stage' },
    { axis: 'x', value: rectRight(stage), from: stage.y, to: rectBottom(stage), kind: 'stage' },
    { axis: 'x', value: rectCenter(stage).x, from: stage.y, to: rectBottom(stage), kind: 'center' },
    { axis: 'y', value: stage.y, from: stage.x, to: rectRight(stage), kind: 'stage' },
    { axis: 'y', value: rectBottom(stage), from: stage.x, to: rectRight(stage), kind: 'stage' },
    { axis: 'y', value: rectCenter(stage).y, from: stage.x, to: rectRight(stage), kind: 'center' }
  ]
}

// ---------------------------------------------------------------------------
// Alignment & distribution
// ---------------------------------------------------------------------------

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Moves `rect` so it aligns with `target` (both stage mm). */
export function alignRect(rect: Rect, target: Rect, mode: AlignMode): Rect {
  const out = cloneRect(rect)
  switch (mode) {
    case 'left':
      out.x = target.x
      break
    case 'hcenter':
      out.x = target.x + target.width / 2 - rect.width / 2
      break
    case 'right':
      out.x = rectRight(target) - rect.width
      break
    case 'top':
      out.y = target.y
      break
    case 'vcenter':
      out.y = target.y + target.height / 2 - rect.height / 2
      break
    case 'bottom':
      out.y = rectBottom(target) - rect.height
      break
  }
  return out
}

export interface AlignableItem {
  id: string
  rect: Rect
}

/**
 * Aligns a set of items to the union bounds of the selection, or to `reference`
 * when a single item is supplied.
 */
export function alignRects(
  items: readonly AlignableItem[],
  mode: AlignMode,
  reference?: Rect
): Map<string, Rect> {
  const out = new Map<string, Rect>()
  if (items.length === 0) return out
  const target = reference ?? unionRects(items.map((i) => i.rect))
  if (!target) return out
  for (const item of items) out.set(item.id, alignRect(item.rect, target, mode))
  return out
}

/** Distributes items so the gaps between them are equal. Needs three or more items. */
export function distributeRects(
  items: readonly AlignableItem[],
  axis: 'horizontal' | 'vertical'
): Map<string, Rect> {
  const out = new Map<string, Rect>()
  if (items.length < 3) return out
  const key = axis === 'horizontal' ? 'x' : 'y'
  const sizeKey = axis === 'horizontal' ? 'width' : 'height'
  const sorted = [...items].sort((a, b) => a.rect[key] - b.rect[key])
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = last.rect[key] + last.rect[sizeKey] - first.rect[key]
  const totalSize = sorted.reduce((sum, item) => sum + item.rect[sizeKey], 0)
  const gap = (span - totalSize) / (sorted.length - 1)

  let cursor = first.rect[key]
  for (const item of sorted) {
    const rect = cloneRect(item.rect)
    rect[key] = cursor
    out.set(item.id, rect)
    cursor += item.rect[sizeKey] + gap
  }
  return out
}

// ---------------------------------------------------------------------------
// Screen transforms (move / resize / rotate)
// ---------------------------------------------------------------------------

export interface ScreenGeometryInput {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  rotationDeg: number
}

export function geometryToRect(geom: ScreenGeometryInput): Rect {
  return { x: geom.xMm, y: geom.yMm, width: geom.widthMm, height: geom.heightMm }
}

export function applyRectToGeometry(geom: ScreenGeometryInput, rect: Rect): ScreenGeometryInput {
  return { ...geom, xMm: rect.x, yMm: rect.y, widthMm: rect.width, heightMm: rect.height }
}

export interface ResizeOptions {
  minWidthMm: number
  minHeightMm: number
  /** Keep the aspect ratio of the free axis to the dragged axis. */
  keepAspect?: boolean
  /** Fractional aspect ratio (width / height) used with `keepAspect`. */
  aspectRatio?: number
  /** Optional snap callback applied in the screen's local frame (rotation 0 only). */
  snapLocal?: (rect: Rect) => Rect
}

const HANDLE_AXIS: Record<RectHandle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 }
}

function anchorLocalPoint(rect: Rect, handle: RectHandle): Point {
  const axis = HANDLE_AXIS[handle]
  const c = rectCenter(rect)
  return {
    x: axis.x === -1 ? rectRight(rect) : axis.x === 1 ? rect.x : c.x,
    y: axis.y === -1 ? rectBottom(rect) : axis.y === 1 ? rect.y : c.y
  }
}

/**
 * Resizes a screen by dragging `handle` to `pointerMm` (stage space).
 *
 * Works in the screen's local frame so rotated screens resize along their own axes,
 * and keeps the opposite handle pinned in world space.
 */
export function resizeScreen(
  geom: ScreenGeometryInput,
  handle: RectHandle,
  pointerMm: Point,
  options: ResizeOptions
): ScreenGeometryInput {
  const rect = geometryToRect(geom)
  const center = rectCenter(rect)
  const axis = HANDLE_AXIS[handle]

  // Anchor (opposite handle) in local frame + its world position, both pre-resize.
  const anchorLocal = anchorLocalPoint(rect, handle)
  const anchorWorld = rotatePoint(anchorLocal, center, geom.rotationDeg)

  // Pointer in the screen's local frame.
  const pointerLocal = rotatePoint(pointerMm, center, -geom.rotationDeg)

  let width = rect.width
  let height = rect.height
  const deltaX = pointerLocal.x - anchorLocal.x
  const deltaY = pointerLocal.y - anchorLocal.y

  if (axis.x !== 0) width = Math.max(Math.abs(deltaX), options.minWidthMm)
  if (axis.y !== 0) height = Math.max(Math.abs(deltaY), options.minHeightMm)

  if (options.keepAspect && options.aspectRatio && options.aspectRatio > 0) {
    const ratio = options.aspectRatio
    if (axis.x !== 0 && axis.y !== 0) {
      // Dominant axis wins so dragging feels predictable.
      if (Math.abs(deltaX) / Math.max(rect.width, 1e-6) > Math.abs(deltaY) / Math.max(rect.height, 1e-6)) {
        height = Math.max(width / ratio, options.minHeightMm)
        width = height * ratio
      } else {
        width = Math.max(height * ratio, options.minWidthMm)
        height = width / ratio
      }
    } else if (axis.x !== 0) {
      height = Math.max(width / ratio, options.minHeightMm)
      width = height * ratio
    } else {
      width = Math.max(height * ratio, options.minWidthMm)
      height = width / ratio
    }
  }

  let newRect: Rect = { x: 0, y: 0, width, height }
  if (options.snapLocal && geom.rotationDeg === 0) {
    const snapped = options.snapLocal({ x: rect.x, y: rect.y, width, height })
    width = snapped.width
    height = snapped.height
  }

  // Place the rect so the anchor stays where it was in world space.
  const newAxis = {
    x: axis.x === -1 ? width : axis.x === 1 ? 0 : width / 2,
    y: axis.y === -1 ? height : axis.y === 1 ? 0 : height / 2
  }
  // local position of the anchor inside the *new* rect, expressed relative to its centre
  const anchorOffsetLocal = { x: newAxis.x - width / 2, y: newAxis.y - height / 2 }
  const rotated = rotatePoint(anchorOffsetLocal, { x: 0, y: 0 }, geom.rotationDeg)
  const newCenter = { x: anchorWorld.x - rotated.x, y: anchorWorld.y - rotated.y }

  newRect = {
    x: newCenter.x - width / 2,
    y: newCenter.y - height / 2,
    width,
    height
  }

  return applyRectToGeometry(geom, newRect)
}

/** Moves a screen by a stage-space delta. */
export function moveScreen(geom: ScreenGeometryInput, deltaMm: Point): ScreenGeometryInput {
  return { ...geom, xMm: geom.xMm + deltaMm.x, yMm: geom.yMm + deltaMm.y }
}

/**
 * Alignment "bake": when a rotated screen is resized we keep rotation, but the
 * helper converts a rotation-only change about a different pivot.
 */
export function rotateScreenAbout(
  geom: ScreenGeometryInput,
  newRotationDeg: number,
  pivotMm?: Point
): ScreenGeometryInput {
  const rect = geometryToRect(geom)
  const center = pivotMm ?? rectCenter(rect)
  const oldCenter = rectCenter(rect)
  const newCenter = rotatePoint(oldCenter, center, newRotationDeg - geom.rotationDeg)
  return {
    ...geom,
    rotationDeg: normalizeDegrees(newRotationDeg),
    xMm: newCenter.x - rect.width / 2,
    yMm: newCenter.y - rect.height / 2
  }
}

/** Corner order helpers used for drawing selection UI. */
export function rectCornerForHandle(rect: Rect, rotationDeg: number, handle: RectHandle): Point {
  return handlePoint(rect, rotationDeg, handle)
}

export function distanceMm(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function scaleRect(rect: Rect, factor: number, origin?: Point): Rect {
  const o = origin ?? rectCenter(rect)
  return {
    x: o.x + (rect.x - o.x) * factor,
    y: o.y + (rect.y - o.y) * factor,
    width: rect.width * factor,
    height: rect.height * factor
  }
}

export function sizeToAspect(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return 0
  return width / height
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

/** Simplifies a pixel resolution into a display aspect string, e.g. "16:9". */
export function aspectRatioLabel(width: number, height: number, maxTerms = 40): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '—'
  const d = gcd(width, height)
  const w = width / d
  const h = height / d
  if (w > maxTerms || h > maxTerms) {
    const ratio = width / height
    const common: [number, number][] = [
      [64, 27],
      [32, 9],
      [21, 9],
      [16, 9],
      [16, 10],
      [3, 2],
      [4, 3],
      [5, 4],
      [1, 1],
      [9, 16],
      [9, 21]
    ]
    let best = common[0]
    let bestErr = Infinity
    for (const pair of common) {
      const err = Math.abs(ratio - pair[0] / pair[1])
      if (err < bestErr) {
        bestErr = err
        best = pair
      }
    }
    return `${best[0]}:${best[1]} (~)`
  }
  return `${w}:${h}`
}

export function aspectDecimal(width: number, height: number): number {
  if (!height) return 0
  return width / height
}

export function sizeFromAspect(width: number, ratio: number): Size {
  return { width, height: ratio > 0 ? width / ratio : 0 }
}
