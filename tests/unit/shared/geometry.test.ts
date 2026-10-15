import { describe, expect, it } from 'vitest'
import {
  alignRects,
  computeSnap,
  distributeRects,
  fitViewToBounds,
  geometryToRect,
  gridCandidates,
  handlePoint,
  mmToView,
  moveScreen,
  normalizeDegrees,
  resizeScreen,
  rotatePoint,
  rotatedBounds,
  rotatedRectContainsPoint,
  screenCandidates,
  stageCandidates,
  unionRects,
  viewToMm,
  zoomAtViewPoint,
  type ScreenGeometryInput
} from '@shared/geometry'
import type { Rect } from '@shared/types'

const screen: ScreenGeometryInput = {
  xMm: 1000,
  yMm: 2000,
  widthMm: 6000,
  heightMm: 3000,
  rotationDeg: 0
}

describe('coordinate transforms', () => {
  it('maps stage millimetres into view pixels and back', () => {
    const view = { zoom: 1.5, panX: 40, panY: 25 }
    const point = mmToView({ x: 6000, y: 3000 }, 40, view)
    // 6000 mm at 40 canvas px per metre = 240 canvas px, scaled by 1.5 and panned.
    expect(point.x).toBeCloseTo(240 * 1.5 + 40, 6)
    expect(point.y).toBeCloseTo(120 * 1.5 + 25, 6)
    const back = viewToMm(point, 40, view)
    expect(back.x).toBeCloseTo(6000, 6)
    expect(back.y).toBeCloseTo(3000, 6)
  })

  it('keeps stage geometry invariant across zoom and pan', () => {
    const original = { ...screen }
    for (const zoom of [0.1, 0.5, 1, 2.5, 8]) {
      for (const pan of [0, 137, -512]) {
        const view = { zoom, panX: pan, panY: pan }
        const centreMm = { x: original.xMm + original.widthMm / 2, y: original.yMm + original.heightMm / 2 }
        const roundTripped = viewToMm(mmToView(centreMm, 40, view), 40, view)
        expect(roundTripped.x).toBeCloseTo(centreMm.x, 6)
        expect(roundTripped.y).toBeCloseTo(centreMm.y, 6)
      }
    }
    expect(original).toEqual(screen)
  })

  it('fits a stage into a viewport and centres it', () => {
    const stage: Rect = { x: 0, y: 0, width: 12_000, height: 6_000 }
    const view = fitViewToBounds(stage, { width: 1000, height: 600 }, 40, { paddingPx: 50 })
    const topLeft = mmToView({ x: 0, y: 0 }, 40, view)
    const bottomRight = mmToView({ x: 12_000, y: 6_000 }, 40, view)
    expect(topLeft.x).toBeGreaterThanOrEqual(0)
    expect(topLeft.y).toBeGreaterThanOrEqual(0)
    expect(bottomRight.x).toBeLessThanOrEqual(1000)
    expect(bottomRight.y).toBeLessThanOrEqual(600)
    // Centre of the stage lands in the centre of the viewport.
    const centre = mmToView({ x: 6000, y: 3000 }, 40, view)
    expect(centre.x).toBeCloseTo(500, 6)
    expect(centre.y).toBeCloseTo(300, 6)
  })

  it('zooms about a fixed point so the content under the cursor stays put', () => {
    const view = { zoom: 1, panX: 0, panY: 0 }
    const anchor = { x: 300, y: 200 }
    const before = viewToMm(anchor, 40, view)
    const zoomed = zoomAtViewPoint(view, anchor, 2.5)
    const after = viewToMm(anchor, 40, zoomed)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
})

describe('rotation and hit testing', () => {
  it('normalises rotation into [0, 360)', () => {
    expect(normalizeDegrees(-90)).toBeCloseTo(270, 6)
    expect(normalizeDegrees(450)).toBeCloseTo(90, 6)
    expect(normalizeDegrees(360)).toBeCloseTo(0, 6)
  })

  it('rotates a point about a centre', () => {
    const rotated = rotatePoint({ x: 2, y: 0 }, { x: 0, y: 0 }, 90)
    expect(rotated.x).toBeCloseTo(0, 6)
    expect(rotated.y).toBeCloseTo(2, 6)
  })

  it('expands the axis-aligned bounds of a rotated rectangle', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 }
    const bounds = rotatedBounds(rect, 45)
    expect(bounds.width).toBeCloseTo(Math.SQRT2 * 100, 6)
    expect(bounds.height).toBeCloseTo(Math.SQRT2 * 100, 6)
    // 90 degrees keeps the size but swaps the visual footprint about the centre.
    const quarter = rotatedBounds({ x: 0, y: 0, width: 200, height: 100 }, 90)
    expect(quarter.width).toBeCloseTo(100, 6)
    expect(quarter.height).toBeCloseTo(200, 6)
  })

  it('hit-tests inside and outside a rotated screen', () => {
    const rect: Rect = { x: 0, y: 0, width: 200, height: 100 }
    expect(rotatedRectContainsPoint(rect, 0, { x: 100, y: 50 })).toBe(true)
    expect(rotatedRectContainsPoint(rect, 0, { x: 300, y: 50 })).toBe(false)
    // After a 90 degree rotation about the centre (100, 50) the long axis is vertical:
    // the shape spans x 50..150 and y -50..150.
    expect(rotatedRectContainsPoint(rect, 90, { x: 100, y: 140 })).toBe(true)
    expect(rotatedRectContainsPoint(rect, 90, { x: 100, y: 210 })).toBe(false)
    expect(rotatedRectContainsPoint(rect, 90, { x: 20, y: 50 })).toBe(false)
  })

  it('places handles on the rectangle edges', () => {
    const rect: Rect = { x: 100, y: 200, width: 400, height: 200 }
    expect(handlePoint(rect, 0, 'nw')).toEqual({ x: 100, y: 200 })
    expect(handlePoint(rect, 0, 'se')).toEqual({ x: 500, y: 400 })
    expect(handlePoint(rect, 0, 'n')).toEqual({ x: 300, y: 200 })
  })
})

describe('snapping', () => {
  const stage: Rect = { x: 0, y: 0, width: 12_000, height: 6000 }

  it('snaps an edge to the nearest grid line within tolerance', () => {
    const rect: Rect = { x: 1490, y: 200, width: 1000, height: 500 }
    const candidates = gridCandidates(rect, stage, 500, 40)
    const result = computeSnap(rect, { toleranceMm: 40, candidates })
    expect(result.delta.x).toBeCloseTo(10, 6)
    expect(result.guides.some((guide) => guide.axis === 'x')).toBe(true)
  })

  it('does nothing when the nearest line is outside tolerance', () => {
    const rect: Rect = { x: 1200, y: 1200, width: 1000, height: 500 }
    const candidates = gridCandidates(rect, stage, 500, 10)
    const result = computeSnap(rect, { toleranceMm: 10, candidates })
    expect(result.delta.x).toBe(0)
    expect(result.delta.y).toBe(0)
    expect(result.guides).toHaveLength(0)
  })

  it('uses other screens as snap targets', () => {
    const rect: Rect = { x: 2995, y: 0, width: 1000, height: 500 }
    const candidates = screenCandidates(
      [{ id: 'other', rect: { x: 1000, y: 0, width: 2000, height: 500 }, rotationDeg: 0, name: 'Other' }],
      new Set(['self'])
    )
    const result = computeSnap(rect, { toleranceMm: 8, candidates })
    expect(result.delta.x).toBeCloseTo(5, 6)
  })

  it('offers stage edges and the stage centre', () => {
    const candidates = stageCandidates(stage)
    const values = candidates.filter((candidate) => candidate.axis === 'x').map((candidate) => candidate.value)
    expect(values).toContain(0)
    expect(values).toContain(12_000)
    expect(values).toContain(6000)
  })
})

describe('resize, move and alignment', () => {
  it('moves a screen by a delta', () => {
    const moved = moveScreen(screen, { x: 250, y: -125 })
    expect(moved.xMm).toBe(1250)
    expect(moved.yMm).toBe(1875)
    expect(moved.widthMm).toBe(screen.widthMm)
  })

  it('resizes from the south-east handle without moving the north-west corner', () => {
    const resized = resizeScreen(screen, 'se', { x: screen.xMm + 4000, y: screen.yMm + 2000 }, {
      minWidthMm: 50,
      minHeightMm: 50
    })
    expect(resized.xMm).toBeCloseTo(screen.xMm, 6)
    expect(resized.yMm).toBeCloseTo(screen.yMm, 6)
    expect(resized.widthMm).toBeCloseTo(4000, 6)
    expect(resized.heightMm).toBeCloseTo(2000, 6)
  })

  it('keeps the opposite corner pinned for a rotated screen', () => {
    const rotated = { ...screen, rotationDeg: 45 }
    const resized = resizeScreen(rotated, 'se', { x: 5000, y: 3500 }, { minWidthMm: 50, minHeightMm: 50 })
    // The north-west corner must not move in world space.
    const anchorBefore = handlePoint(geometryToRect(rotated), rotated.rotationDeg, 'nw')
    const anchorAfter = handlePoint(geometryToRect(resized), resized.rotationDeg, 'nw')
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6)
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6)
  })

  it('never produces a zero or negative size', () => {
    const resized = resizeScreen(screen, 'se', { x: screen.xMm - 5000, y: screen.yMm - 5000 }, {
      minWidthMm: 100,
      minHeightMm: 100
    })
    expect(resized.widthMm).toBeGreaterThanOrEqual(100)
    expect(resized.heightMm).toBeGreaterThanOrEqual(100)
  })

  it('aligns the left edges of a set of rects', () => {
    const items = [
      { id: 'a', rect: { x: 100, y: 0, width: 100, height: 100 } },
      { id: 'b', rect: { x: 500, y: 200, width: 100, height: 100 } },
      { id: 'c', rect: { x: 900, y: 400, width: 100, height: 100 } }
    ]
    const aligned = alignRects(items, 'left')
    for (const id of ['a', 'b', 'c']) {
      expect(aligned.get(id)?.x).toBe(100)
    }
  })

  it('distributes three rects with equal gaps', () => {
    const items = [
      { id: 'a', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'b', rect: { x: 150, y: 0, width: 100, height: 100 } },
      { id: 'c', rect: { x: 1000, y: 0, width: 100, height: 100 } }
    ]
    const distributed = distributeRects(items, 'horizontal')
    const xs = ['a', 'b', 'c'].map((id) => distributed.get(id)?.x ?? 0)
    expect(xs[0]).toBe(0)
    expect(xs[2]).toBe(1000)
    // Equal spacing between the outer edges.
    expect(xs[1]).toBeCloseTo((0 + 1000) / 2, 6)
  })

  it('unions rectangles and ignores empty input', () => {
    expect(unionRects([])).toBeNull()
    const union = unionRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 10 }
    ])
    expect(union).toEqual({ x: 0, y: 0, width: 30, height: 15 })
  })
})
