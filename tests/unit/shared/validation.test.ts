import { describe, expect, it } from 'vitest'
import { LIMITS, isValidOutputSize, isValidRegion, validateDraft, validateOutput, validateProject, validateScreen } from '@shared/validation'
import { createDefaultProject, createScreen, projectSummary } from '@shared/project'
import { buildMappingPlan } from '@shared/mapping'

function screen(overrides: Parameters<typeof createScreen>[0] = {}) {
  return createScreen({ name: 'Test', widthMm: 6000, heightMm: 3000, pixelWidth: 1920, pixelHeight: 960, ...overrides })
}

describe('screen validation', () => {
  it('accepts a well-formed screen', () => {
    expect(validateScreen(screen()).ok).toBe(true)
  })

  it('rejects non-finite and non-positive geometry', () => {
    expect(validateScreen(screen({ widthMm: Number.NaN })).ok).toBe(false)
    expect(validateScreen(screen({ heightMm: Number.POSITIVE_INFINITY })).ok).toBe(false)
    expect(validateScreen(screen({ widthMm: 0 })).ok).toBe(false)
    expect(validateScreen(screen({ heightMm: -100 })).ok).toBe(false)
  })

  it('rejects pixel resolutions outside the documented limits', () => {
    expect(validateScreen(screen({ pixelWidth: 0 })).ok).toBe(false)
    expect(validateScreen(screen({ pixelWidth: LIMITS.maxPixel + 1 })).ok).toBe(false)
    expect(validateScreen(screen({ pixelHeight: -1 })).ok).toBe(false)
  })

  it('rejects a pixel count that could trigger huge allocations', () => {
    const result = validateScreen(screen({ pixelWidth: 16_384, pixelHeight: 16_384 }))
    expect(result.ok).toBe(false)
    expect(Object.values(result.errors).join(' ')).toMatch(/67,108,864|exceed/i)
  })

  it('reports the offending field so the inspector can place the message inline', () => {
    const broken = screen()
    broken.rotationDeg = Number.NaN
    const result = validateScreen(broken)
    expect(result.ok).toBe(false)
    expect(result.errors.rotationDeg).toBeTruthy()
  })

  it('validates a property draft before it is committed', () => {
    const draft = { ...screen(), widthMm: 0 }
    const result = validateDraft(draft)
    expect(result.ok).toBe(false)
    expect(result.errors.widthMm).toBeTruthy()
  })
})

describe('output and region validation', () => {
  it('checks output sizes against the documented range', () => {
    expect(isValidOutputSize(1920, 1080)).toBe(true)
    expect(isValidOutputSize(0, 1080)).toBe(false)
    expect(isValidOutputSize(1920.5, 1080)).toBe(false)
    expect(isValidOutputSize(LIMITS.maxOutputPixel + 1, 1080)).toBe(false)
    expect(validateOutput({ id: 'o', name: 'Main', width: 1920, height: 1080, enabled: true, notes: '' })).toBeNull()
    expect(validateOutput({ id: 'o', name: 'Main', width: 1, height: 1080, enabled: true, notes: '' })).toBeTruthy()
  })

  it('rejects invalid mapping regions', () => {
    expect(isValidRegion({ x: 0, y: 0, width: 1920, height: 1080 })).toBe(true)
    expect(isValidRegion({ x: 0, y: 0, width: 0, height: 1080 })).toBe(false)
    expect(isValidRegion({ x: Number.NaN, y: 0, width: 10, height: 10 })).toBe(false)
  })
})

describe('project validation', () => {
  it('warns when a project has no screens', () => {
    const project = createDefaultProject({ name: 'Empty' })
    const result = validateProject(project)
    expect(result.ok).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/no screens/i)
  })

  it('detects duplicate screen ids', () => {
    const project = createDefaultProject({ name: 'Dupe', initialScreenCount: 2 })
    project.screens[1].id = project.screens[0].id
    const result = validateProject(project)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/Duplicate screen id/i)
  })

  it('detects a screen assigned to an output that no longer exists', () => {
    const project = createDefaultProject({ name: 'Orphan', initialScreenCount: 1 })
    project.screens[0].mapping.outputId = 'output-that-was-deleted'
    const result = validateProject(project)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/no longer exists/i)
  })

  it('reports a missing background asset as a warning, not an error', () => {
    const project = createDefaultProject({ name: 'Bg' })
    project.stage.background.assetMissing = true
    const result = validateProject(project)
    expect(result.ok).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/background image/i)
  })

  it('surfaces mapping problems through the mapping plan', () => {
    const project = createDefaultProject({ name: 'Mapping', initialScreenCount: 1 })
    project.screens[0].mapping.region = { x: 1900, y: 1000, width: 800, height: 600 }
    const plan = buildMappingPlan(project)
    const summary = projectSummary(project, 'Mapping.cuepoint')
    expect(summary.screenCount).toBe(1)
    expect(plan.issues.some((issue) => issue.code === 'out-of-bounds')).toBe(true)
  })
})
