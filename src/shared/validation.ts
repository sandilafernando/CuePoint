import type { Project, Screen, ScreenDraft, OutputDevice, Rect } from './types'
import { isFiniteRect } from './geometry'

/**
 * Validation limits.
 *
 * These are deliberate engineering limits that protect the application from values
 * which would produce meaningless geometry or trigger enormous allocations. They are
 * documented in the user manual ("Known limits").
 */
export const LIMITS = {
  /** 1 mm .. 200 m per screen edge. */
  minDimensionMm: 1,
  maxDimensionMm: 200_000,
  /** Stage itself may be up to 500 m. */
  minStageMm: 100,
  maxStageMm: 500_000,
  /** ±1 km from the stage origin. */
  maxCoordinateMm: 1_000_000,
  /** 1 .. 32768 px per edge (matches the largest practical LED wall resolution). */
  minPixel: 1,
  maxPixel: 32_768,
  /** Refuse any screen whose pixel count would exceed this (guards allocations). */
  maxPixelCount: 67_108_864, // 8192 x 8192
  /** LED pitch in millimetres. */
  minPixelPitchMm: 0.05,
  maxPixelPitchMm: 200,
  /** Rotation is normalised to [0, 360). */
  minRotationDeg: -3600,
  maxRotationDeg: 3600,
  /** Output device resolution. */
  minOutputPixel: 16,
  maxOutputPixel: 32_768,
  /** 1000 .. 32000 logical canvas pixels per metre. */
  minCanvasPxPerMeter: 1000,
  maxCanvasPxPerMeter: 32_000,
  /** Background opacity is a fraction. */
  minOpacity: 0,
  maxOpacity: 1,
  /** Grid spacing in millimetres. */
  minGridSpacingMm: 1,
  maxGridSpacingMm: 100_000,
  /** Snap tolerance in view pixels. */
  minSnapTolerancePx: 0,
  maxSnapTolerancePx: 60,
  /** Autosave interval. */
  minAutosaveMs: 5_000,
  maxAutosaveMs: 3_600_000,
  minBackupRetention: 1,
  maxBackupRetention: 200,
  /** Project name length. */
  maxNameLength: 120,
  maxNotesLength: 4_000
} as const

export type ScreenField =
  | 'name'
  | 'xMm'
  | 'yMm'
  | 'widthMm'
  | 'heightMm'
  | 'rotationDeg'
  | 'pixelWidth'
  | 'pixelHeight'
  | 'pixelPitchMm'
  | 'opacity'
  | 'notes'

export type ValidationErrors = Partial<Record<ScreenField, string>>

export interface ValidationResult {
  ok: boolean
  errors: ValidationErrors
}

export const OK: ValidationResult = { ok: true, errors: {} }

function fail(errors: ValidationErrors): ValidationResult {
  return { ok: false, errors }
}

export function isFiniteInt(value: number): boolean {
  return Number.isInteger(value) && Number.isFinite(value)
}

function numError(label: string, value: number, min: number, max: number, unit = ''): string | null {
  if (!Number.isFinite(value)) return `${label} must be a finite number.`
  if (Number.isNaN(value)) return `${label} must be a number.`
  if (value < min || value > max) {
    return `${label} must be between ${min}${unit} and ${max}${unit}.`
  }
  return null
}

/**
 * Validates a single screen. Every rule reports a message next to the offending
 * field so the inspector can place it inline.
 */
export function validateScreen(screen: Screen): ValidationResult {
  const errors: ValidationErrors = {}

  const name = screen.name?.trim() ?? ''
  if (name.length === 0) errors.name = 'Screen name is required.'
  else if (name.length > LIMITS.maxNameLength) {
    errors.name = `Screen name must be ${LIMITS.maxNameLength} characters or fewer.`
  }

  const dimErrors: [ScreenField, string, number, number][] = [
    ['widthMm', 'Width', screen.widthMm, LIMITS.maxDimensionMm],
    ['heightMm', 'Height', screen.heightMm, LIMITS.maxDimensionMm]
  ]
  for (const [field, label, value, max] of dimErrors) {
    const message = numError(label, value, LIMITS.minDimensionMm, max, ' mm')
    if (message) errors[field] = message
  }

  if (numError('X', screen.xMm, -LIMITS.maxCoordinateMm, LIMITS.maxCoordinateMm, ' mm')) {
    errors.xMm = `X must be a finite value within ±${LIMITS.maxCoordinateMm} mm.`
  }
  if (numError('Y', screen.yMm, -LIMITS.maxCoordinateMm, LIMITS.maxCoordinateMm, ' mm')) {
    errors.yMm = `Y must be a finite value within ±${LIMITS.maxCoordinateMm} mm.`
  }
  if (
    numError(
      'Rotation',
      screen.rotationDeg,
      LIMITS.minRotationDeg,
      LIMITS.maxRotationDeg,
      '°'
    )
  ) {
    errors.rotationDeg = `Rotation must be a finite value between ${LIMITS.minRotationDeg}° and ${LIMITS.maxRotationDeg}°.`
  }

  if (!isFiniteInt(screen.pixelWidth)) {
    errors.pixelWidth = 'Pixel width must be a whole number.'
  } else if (screen.pixelWidth < LIMITS.minPixel || screen.pixelWidth > LIMITS.maxPixel) {
    errors.pixelWidth = `Pixel width must be between ${LIMITS.minPixel} and ${LIMITS.maxPixel}.`
  }

  if (!isFiniteInt(screen.pixelHeight)) {
    errors.pixelHeight = 'Pixel height must be a whole number.'
  } else if (screen.pixelHeight < LIMITS.minPixel || screen.pixelHeight > LIMITS.maxPixel) {
    errors.pixelHeight = `Pixel height must be between ${LIMITS.minPixel} and ${LIMITS.maxPixel}.`
  }

  if (
    screen.pixelWidth > 0 &&
    screen.pixelHeight > 0 &&
    screen.pixelWidth * screen.pixelHeight > LIMITS.maxPixelCount
  ) {
    errors.pixelHeight = `Total pixel count exceeds ${LIMITS.maxPixelCount.toLocaleString()} px (${screen.pixelWidth} × ${screen.pixelHeight}).`
  }

  if (screen.pixelPitchMm !== null) {
    if (!Number.isFinite(screen.pixelPitchMm)) {
      errors.pixelPitchMm = 'Pixel pitch must be a finite number.'
    } else if (
      screen.pixelPitchMm < LIMITS.minPixelPitchMm ||
      screen.pixelPitchMm > LIMITS.maxPixelPitchMm
    ) {
      errors.pixelPitchMm = `Pixel pitch must be between ${LIMITS.minPixelPitchMm} mm and ${LIMITS.maxPixelPitchMm} mm.`
    }
  }

  if ((screen.notes?.length ?? 0) > LIMITS.maxNotesLength) {
    errors.notes = `Notes must be ${LIMITS.maxNotesLength} characters or fewer.`
  }

  return Object.keys(errors).length ? fail(errors) : OK
}

export function validateDraft(draft: ScreenDraft): ValidationResult {
  return validateScreen({
    id: 'draft',
    name: draft.name,
    type: draft.type,
    color: draft.color,
    visible: draft.visible,
    locked: draft.locked,
    notes: draft.notes,
    order: 0,
    groupId: draft.groupId,
    xMm: draft.xMm,
    yMm: draft.yMm,
    widthMm: draft.widthMm,
    heightMm: draft.heightMm,
    rotationDeg: draft.rotationDeg,
    pixelWidth: draft.pixelWidth,
    pixelHeight: draft.pixelHeight,
    pixelPitchMm: draft.pixelPitchMm,
    mapping: {
      outputId: null,
      region: { x: 0, y: 0, width: draft.pixelWidth, height: draft.pixelHeight },
      autoRegion: true,
      exportVisible: true,
      scale: 1,
      offsetXPx: 0,
      offsetYPx: 0,
      notes: ''
    }
  })
}

export function isValidOutputSize(width: number, height: number): boolean {
  return (
    isFiniteInt(width) &&
    isFiniteInt(height) &&
    width >= LIMITS.minOutputPixel &&
    width <= LIMITS.maxOutputPixel &&
    height >= LIMITS.minOutputPixel &&
    height <= LIMITS.maxOutputPixel &&
    width * height <= LIMITS.maxPixelCount
  )
}

export function validateOutput(output: OutputDevice): string | null {
  if (!output.name.trim()) return 'Output name is required.'
  if (!isValidOutputSize(output.width, output.height)) {
    return `Output resolution must be between ${LIMITS.minOutputPixel} and ${LIMITS.maxOutputPixel} px per edge.`
  }
  return null
}

export function isValidRegion(region: Rect): boolean {
  return (
    isFiniteRect(region) &&
    region.width >= 1 &&
    region.height >= 1 &&
    region.x >= -LIMITS.maxOutputPixel &&
    region.y >= -LIMITS.maxOutputPixel &&
    region.x + region.width <= LIMITS.maxOutputPixel * 4 &&
    region.y + region.height <= LIMITS.maxOutputPixel * 4
  )
}

export interface ProjectValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** Whole-project sanity check, surfaced by Tools -> Validate Project. */
export function validateProject(project: Project): ProjectValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (project.screens.length === 0) warnings.push('This project has no screens yet.')

  if (
    !Number.isFinite(project.stage.widthMm) ||
    !Number.isFinite(project.stage.heightMm) ||
    project.stage.widthMm < LIMITS.minStageMm ||
    project.stage.heightMm < LIMITS.minStageMm
  ) {
    errors.push(
      `Stage dimensions must be at least ${LIMITS.minStageMm} mm and finite. Current: ${project.stage.widthMm} × ${project.stage.heightMm} mm.`
    )
  }
  if (
    project.stage.widthMm > LIMITS.maxStageMm ||
    project.stage.heightMm > LIMITS.maxStageMm
  ) {
    errors.push(`Stage dimensions may not exceed ${LIMITS.maxStageMm} mm.`)
  }

  const ids = new Set<string>()
  for (const screen of project.screens) {
    if (ids.has(screen.id)) errors.push(`Duplicate screen identifier detected: ${screen.id}.`)
    ids.add(screen.id)
    const result = validateScreen(screen)
    if (!result.ok) {
      const fields = Object.entries(result.errors)
        .map(([field, message]) => `${field}: ${message}`)
        .join(' ')
      errors.push(`Screen "${screen.name || screen.id}" is invalid. ${fields}`)
    }
  }

  const outputIds = new Set(project.outputs.map((o) => o.id))
  for (const output of project.outputs) {
    const message = validateOutput(output)
    if (message) errors.push(`Output "${output.name}": ${message}`)
  }
  for (const screen of project.screens) {
    const outputId = screen.mapping.outputId
    if (outputId && !outputIds.has(outputId)) {
      errors.push(
        `Screen "${screen.name}" is assigned to a mapping output that no longer exists. Reassign it in Pixel Mapping.`
      )
    }
  }

  if (project.stage.background.assetMissing) {
    warnings.push('The stage background image could not be found on disk.')
  }

  return { ok: errors.length === 0, errors, warnings }
}
