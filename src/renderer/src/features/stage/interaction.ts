import type { Point, Project, Rect, Screen } from '@shared/types'
import {
  gridCandidates,
  handlePoint,
  rectBottom,
  rectRight,
  rotatedBounds,
  rotatedRectContainsPoint,
  screenCandidates,
  stageCandidates,
  viewScale,
  type RectHandle,
  type SnapCandidate
} from '@shared/geometry'
import { screenGeometryRect } from '@shared/project'

/**
 * Stage-canvas hit testing and snap candidate construction.
 *
 * Kept free of React and the DOM so the interaction rules are unit-testable and identical
 * to the ones used by the automated Stage Designer regression suite.
 */

export type SelectionHandle = RectHandle | 'rotate'

export interface HitScreen {
  screen: Screen
  /** Rotated bounds, useful for marquee tests and hover outlines. */
  bounds: Rect
}

/** Topmost screen containing the point. `order` wins ties, later entries draw on top. */
export function hitTestScreens(screens: readonly Screen[], pointMm: Point): Screen | null {
  const candidates = [...screens].sort((a, b) => a.order - b.order)
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const screen = candidates[index]
    if (!screen.visible) continue
    if (rotatedRectContainsPoint(screenGeometryRect(screen), screen.rotationDeg, pointMm)) {
      return screen
    }
  }
  return null
}

/** All visible screens intersecting a marquee rectangle. */
export function marqueeScreens(screens: readonly Screen[], marquee: Rect): Screen[] {
  return screens.filter((screen) => {
    if (!screen.visible) return false
    const bounds = rotatedBounds(screenGeometryRect(screen), screen.rotationDeg)
    return (
      bounds.x < rectRight(marquee) &&
      rectRight(bounds) > marquee.x &&
      bounds.y < rectBottom(marquee) &&
      rectBottom(bounds) > marquee.y
    )
  })
}

/**
 * Handle under the pointer, in view-tolerant stage units.
 *
 * The rotate grip sits 28 view pixels above the top edge and is only offered for a single
 * unlocked selection so it never competes with normal resizing during multi-select work.
 */
export function handleAtPoint(
  screen: Screen,
  pointMm: Point,
  toleranceMm: number,
  viewPixelsPerMm: number
): SelectionHandle | null {
  const rect = screenGeometryRect(screen)
  const handles: RectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  for (const handle of handles) {
    const position = handlePoint(rect, screen.rotationDeg, handle)
    if (Math.hypot(position.x - pointMm.x, position.y - pointMm.y) <= toleranceMm) return handle
  }
  const topCenter = handlePoint(rect, screen.rotationDeg, 'n')
  const rotatePosition = {
    x: topCenter.x,
    y: topCenter.y - (viewPixelsPerMm > 0 ? 28 / viewPixelsPerMm : 0)
  }
  if (Math.hypot(rotatePosition.x - pointMm.x, rotatePosition.y - pointMm.y) <= toleranceMm * 1.4) {
    return 'rotate'
  }
  return null
}

/** View-space position of a handle, used to draw selection chrome. */
export function handleStagePoint(screen: Screen, handle: RectHandle | 'rotate', viewPixelsPerMm: number): Point {
  const rect = screenGeometryRect(screen)
  if (handle === 'rotate') {
    const topCenter = handlePoint(rect, screen.rotationDeg, 'n')
    return { x: topCenter.x, y: topCenter.y - (viewPixelsPerMm > 0 ? 28 / viewPixelsPerMm : 0) }
  }
  return handlePoint(rect, screen.rotationDeg, handle)
}

/** Snap candidates for the screens being moved: grid, other screens and stage edges. */
export function buildSnapCandidates(
  project: Project,
  movingRect: Rect,
  excludeIds: ReadonlySet<string>,
  toleranceMm: number
): SnapCandidate[] {
  const candidates: SnapCandidate[] = []
  const { stage } = project
  const stageRect: Rect = { x: 0, y: 0, width: stage.widthMm, height: stage.heightMm }

  if (stage.snapToGrid && stage.gridVisible !== false) {
    candidates.push(...gridCandidates(movingRect, stageRect, stage.gridSpacingMm, toleranceMm))
  }
  if (stage.snapToScreens) {
    candidates.push(
      ...screenCandidates(
        project.screens.map((screen) => ({
          id: screen.id,
          rect: screenGeometryRect(screen),
          rotationDeg: screen.rotationDeg,
          name: screen.name
        })),
        excludeIds
      )
    )
  }
  if (stage.snapToStage) {
    candidates.push(...stageCandidates(stageRect))
  }
  return candidates
}

/** Converts the configured pixel tolerance into stage millimetres at the current zoom. */
export function toleranceMmFor(
  canvasPxPerMeter: number,
  zoom: number,
  tolerancePx: number
): number {
  const scale = viewScale(canvasPxPerMeter, { zoom, panX: 0, panY: 0 })
  return scale > 0 ? tolerancePx / scale : 0
}

/** Normalises a drag rectangle so width/height are always positive. */
export function normaliseMarquee(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

/** Axis constraint used while Shift is held during a drag. */
export function constrainToAxis(delta: Point): Point {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
}

export const SELECTION_HANDLES: readonly RectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
