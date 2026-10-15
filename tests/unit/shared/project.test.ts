import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  applyDraftToScreen,
  cloneProject,
  cloneScreenWithNewId,
  createDefaultProject,
  createScreen,
  migrateProject,
  nextScreenPosition,
  screenDraftFromScreen,
  screenGeometryRect,
  screensBounds
} from '@shared/project'

/**
 * The project model is the contract every other subsystem depends on. These tests assert the
 * rules the user manual states: physical geometry and pixel resolution are independent, ids
 * are stable, and duplication never shares mutable state.
 */
describe('project model', () => {
  it('creates a stage with the requested dimensions and independent pixel geometry', () => {
    const project = createDefaultProject({
      name: 'School Hall',
      author: 'Operator',
      stageWidthMm: 12_000,
      stageHeightMm: 6000,
      initialScreenCount: 3
    })
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(project.stage.widthMm).toBe(12_000)
    expect(project.screens).toHaveLength(3)
    expect(new Set(project.screens.map((screen) => screen.id)).size).toBe(3)
  })

  it('never derives physical size from pixel resolution', () => {
    const screen = createScreen({ widthMm: 6000, heightMm: 3000, pixelWidth: 1920, pixelHeight: 960 })
    // 6 m x 3 m with 1920x960 native pixels: exactly the case the brief calls out.
    expect(screen.widthMm).toBe(6000)
    expect(screen.heightMm).toBe(3000)
    expect(screen.pixelWidth).toBe(1920)
    expect(screen.pixelHeight).toBe(960)

    const widened = { ...screen, pixelWidth: 3840 }
    expect(widened.widthMm).toBe(6000)
    expect(screenGeometryRect(widened).width).toBe(6000)
  })

  it('gives duplicated screens new ids and independent mapping state', () => {
    const original = createScreen({ name: 'LED Left', pixelWidth: 1920, pixelHeight: 1080 })
    original.mapping.outputId = 'out-1'
    const copy = cloneScreenWithNewId(original, { xMm: 500 })

    expect(copy.id).not.toBe(original.id)
    expect(copy.mapping).not.toBe(original.mapping)
    expect(copy.mapping.region).not.toBe(original.mapping.region)

    copy.mapping.region.x = 999
    copy.mapping.outputId = 'out-2'
    expect(original.mapping.region.x).toBe(0)
    expect(original.mapping.outputId).toBe('out-1')
  })

  it('deep-clones a whole project', () => {
    const project = createDefaultProject({ name: 'Clone', initialScreenCount: 1 })
    const clone = cloneProject(project)
    expect(clone).not.toBe(project)
    expect(clone.screens[0]).not.toBe(project.screens[0])
    clone.screens[0].name = 'Changed'
    expect(project.screens[0].name).not.toBe('Changed')
  })

  it('places additional screens inside the stage bounds', () => {
    const project = createDefaultProject({ name: 'Layout', initialScreenCount: 4 })
    for (const screen of project.screens) {
      expect(screen.xMm).toBeGreaterThanOrEqual(0)
      expect(screen.yMm).toBeGreaterThanOrEqual(0)
    }
    const bounds = screensBounds(project.screens)
    expect(bounds).not.toBeNull()
    const placement = nextScreenPosition(project.stage, project.screens, { widthMm: 2000, heightMm: 1000 })
    expect(placement.x).toBeGreaterThanOrEqual(0)
    expect(placement.y).toBeGreaterThanOrEqual(0)
  })

  it('round-trips a screen through the inspector draft', () => {
    const screen = createScreen({ name: 'Draft', widthMm: 4000, heightMm: 2000, pixelWidth: 1280, pixelHeight: 640 })
    const draft = screenDraftFromScreen(screen)
    draft.widthMm = 4500
    draft.pixelWidth = 1600
    draft.rotationDeg = 15
    const applied = applyDraftToScreen(screen, draft)
    expect(applied.widthMm).toBe(4500)
    expect(applied.pixelWidth).toBe(1600)
    expect(applied.rotationDeg).toBe(15)
    // The original is untouched: the inspector writes through the reducer, not in place.
    expect(screen.widthMm).toBe(4000)
  })
})

describe('schema migration', () => {
  it('migrates a v1 project (metres + nativeWidth) into the current schema', () => {
    const legacy = {
      schemaVersion: 1,
      meta: { id: 'prj-1', name: 'Legacy', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', author: '', notes: '' },
      stage: { name: 'Main Stage', widthM: 10, heightM: 5, canvasPxPerMeter: 40 },
      screens: [
        { id: 'scr-legacy', name: 'Wall', widthM: 6, heightM: 3, nativeWidth: 1920, nativeHeight: 960, xM: 1, yM: 0.5, rotationDeg: 45 }
      ]
    }
    const { project, migrations } = migrateProject(legacy)
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrations.length).toBeGreaterThan(0)
    expect(project.stage.widthMm).toBe(10_000)
    expect(project.stage.heightMm).toBe(5000)
    const screen = project.screens[0]
    expect(screen.widthMm).toBe(6000)
    expect(screen.heightMm).toBe(3000)
    expect(screen.pixelWidth).toBe(1920)
    expect(screen.pixelHeight).toBe(960)
    expect(screen.xMm).toBe(1000)
    expect(screen.rotationDeg).toBe(45)
    expect(screen.id).toBe('scr-legacy')
    expect(project.outputs.length).toBeGreaterThanOrEqual(1)
  })

  it('repairs malformed values instead of throwing, so a damaged project can still be opened', () => {
    const damaged = {
      schemaVersion: SCHEMA_VERSION,
      meta: { id: 'prj', name: 'Damaged', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', author: '', notes: '' },
      stage: { name: 'Stage', widthMm: Number.NaN, heightMm: 6000, canvasPxPerMeter: 40 },
      screens: [{ id: 'a', name: 'A', widthMm: 'wide', heightMm: 1000, xMm: 0, yMm: 0, pixelWidth: 100, pixelHeight: 100 }],
      outputs: [],
      groups: []
    }
    const { project } = migrateProject(damaged)
    expect(Number.isFinite(project.stage.widthMm)).toBe(true)
    expect(project.screens.length).toBe(1)
    expect(Number.isFinite(project.screens[0].widthMm)).toBe(true)
  })

  it('rejects a payload that is not an object', () => {
    expect(() => migrateProject(null)).toThrow()
    expect(() => migrateProject('nope')).toThrow()
  })
})
