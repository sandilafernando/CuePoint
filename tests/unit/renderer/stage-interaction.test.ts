import { describe, expect, it } from 'vitest'
import {
  buildSnapCandidates,
  constrainToAxis,
  handleAtPoint,
  handleStagePoint,
  hitTestScreens,
  marqueeScreens,
  normaliseMarquee,
  toleranceMmFor
} from '@renderer/features/stage/interaction'
import { createDefaultProject, createScreen } from '@shared/project'
import type { Screen } from '@shared/types'

/**
 * Canvas interaction rules.
 *
 * These are the gestures an operator repeats hundreds of times in a session: picking a
 * screen, lassoing several, grabbing a resize handle. Mistakes here are felt immediately, so
 * the rules are pinned by tests rather than only by manual use.
 */

function screen(overrides: Partial<Screen> & { id: string }): Screen {
  const base = createScreen({ name: overrides.id, widthMm: 2000, heightMm: 1000, pixelWidth: 800, pixelHeight: 400 })
  return { ...base, ...overrides }
}

describe('hit testing', () => {
  const lower = screen({ id: 'lower', xMm: 0, yMm: 0, order: 0 })
  const upper = screen({ id: 'upper', xMm: 1000, yMm: 0, order: 1 })
  const screens = [lower, upper]

  it('selects the screen under the point', () => {
    expect(hitTestScreens(screens, { x: 500, y: 500 })?.id).toBe('lower')
    expect(hitTestScreens(screens, { x: 1500, y: 500 })?.id).toBe('upper')
  })

  it('returns the topmost screen where two overlap', () => {
    const overlapping = [lower, screen({ id: 'top', xMm: 0, yMm: 0, order: 5 })]
    expect(hitTestScreens(overlapping, { x: 500, y: 500 })?.id).toBe('top')
  })

  it('ignores hidden screens', () => {
    const hidden = [screen({ id: 'hidden', xMm: 0, yMm: 0, visible: false })]
    expect(hitTestScreens(hidden, { x: 500, y: 500 })).toBeNull()
  })

  it('accounts for rotation', () => {
    const rotated = [screen({ id: 'rot', xMm: 0, yMm: 0, widthMm: 4000, heightMm: 500, rotationDeg: 90 })]
    // After rotating about the centre the tall axis is vertical.
    expect(hitTestScreens(rotated, { x: 2000, y: 2200 })).not.toBeNull()
    expect(hitTestScreens(rotated, { x: 3800, y: 250 })).toBeNull()
  })

  it('finds every screen intersecting a marquee', () => {
    // The marquee spans -100..700, which reaches only the lower screen (0..2000).
    const found = marqueeScreens(screens, { x: -100, y: -100, width: 800, height: 1200 })
    expect(found.map((item) => item.id)).toEqual(['lower'])
    expect(marqueeScreens(screens, { x: -100, y: -100, width: 3400, height: 1200 })).toHaveLength(2)
    expect(marqueeScreens(screens, { x: 5000, y: 5000, width: 100, height: 100 })).toHaveLength(0)
  })
})

describe('handles', () => {
  const target = screen({ id: 'handle-target', xMm: 0, yMm: 0, widthMm: 2000, heightMm: 1000 })
  // 1 view pixel per millimetre keeps the arithmetic easy to read.
  const pixelsPerMm = 1

  it('finds a corner handle when the pointer is on it', () => {
    expect(handleAtPoint(target, { x: 4, y: 4 }, 6, pixelsPerMm)).toBe('nw')
    expect(handleAtPoint(target, { x: 1998, y: 998 }, 6, pixelsPerMm)).toBe('se')
  })

  it('finds an edge handle only along that edge', () => {
    expect(handleAtPoint(target, { x: 1000, y: 2 }, 6, pixelsPerMm)).toBe('n')
    expect(handleAtPoint(target, { x: 1000, y: 500 }, 6, pixelsPerMm)).toBeNull()
  })

  it('offers the rotate grip above the top edge', () => {
    const grip = handleStagePoint(target, 'rotate', pixelsPerMm)
    expect(grip.x).toBeCloseTo(1000, 6)
    expect(grip.y).toBeCloseTo(-28, 6)
    expect(handleAtPoint(target, grip, 6, pixelsPerMm)).toBe('rotate')
  })

  it('does not mistake the screen centre for a handle', () => {
    expect(handleAtPoint(target, { x: 1000, y: 500 }, 8, pixelsPerMm)).toBeNull()
  })

  it('scales the rotate grip with zoom so it stays a constant size on screen', () => {
    const zoomedIn = handleStagePoint(target, 'rotate', 4) // 4 view px per mm
    const zoomedOut = handleStagePoint(target, 'rotate', 0.5)
    expect(zoomedIn.y).toBeCloseTo(-7, 6)
    expect(zoomedOut.y).toBeCloseTo(-56, 6)
  })
})

describe('snap candidates', () => {
  const project = createDefaultProject({ name: 'Snap', stageWidthMm: 10_000, stageHeightMm: 5000, initialScreenCount: 1 })

  it('offers grid, screen and stage lines by default', () => {
    const candidates = buildSnapCandidates(project, { x: 0, y: 0, width: 1000, height: 1000 }, new Set(), 50)
    const kinds = new Set(candidates.map((candidate) => candidate.kind))
    expect(kinds.has('grid')).toBe(true)
    expect(kinds.has('screen')).toBe(true)
    expect(kinds.has('stage')).toBe(true)
  })

  it('excludes the screens being moved', () => {
    const moving = project.screens[0].id
    const candidates = buildSnapCandidates(project, { x: 0, y: 0, width: 1000, height: 1000 }, new Set([moving]), 50)
    expect(candidates.filter((candidate) => candidate.kind === 'screen')).toHaveLength(0)
  })

  it('honours the per-project snap switches', () => {
    project.stage.snapToGrid = false
    project.stage.snapToScreens = false
    project.stage.snapToStage = true
    const candidates = buildSnapCandidates(project, { x: 0, y: 0, width: 1000, height: 1000 }, new Set(), 50)
    expect(new Set(candidates.map((candidate) => candidate.kind))).toEqual(new Set(['stage', 'center']))
  })

  it('converts the pixel tolerance into stage millimetres at the current zoom', () => {
    // 40 canvas px per metre at zoom 1 is 0.04 view px per mm, so 8 px ≈ 200 mm.
    expect(toleranceMmFor(40, 1, 8)).toBeCloseTo(200, 6)
    // Zooming in halves the physical tolerance, keeping it constant on screen.
    expect(toleranceMmFor(40, 2, 8)).toBeCloseTo(100, 6)
  })
})

describe('drag helpers', () => {
  it('normalises a marquee drawn in any direction', () => {
    expect(normaliseMarquee({ x: 100, y: 200 }, { x: 50, y: 150 })).toEqual({
      x: 50,
      y: 150,
      width: 50,
      height: 50
    })
  })

  it('constrains a drag to the dominant axis', () => {
    expect(constrainToAxis({ x: 120, y: 30 })).toEqual({ x: 120, y: 0 })
    expect(constrainToAxis({ x: -20, y: 90 })).toEqual({ x: 0, y: 90 })
  })
})
