import type { LengthUnit } from './types'

/**
 * Unit conversion.
 *
 * The canonical internal unit for every physical length in CuePoint is the
 * millimetre. Conversion only ever happens at the display boundary, which is what
 * keeps stored geometry stable when the operator switches units.
 */

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft']

export const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8
}

export const UNIT_LABEL: Record<LengthUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
  ft: 'ft'
}

export const UNIT_NAME: Record<LengthUnit, string> = {
  mm: 'Millimetres',
  cm: 'Centimetres',
  m: 'Metres',
  in: 'Inches',
  ft: 'Feet'
}

/** Millimetres per logical canvas pixel for a given canvas resolution. */
export function mmPerCanvasPx(canvasPxPerMeter: number): number {
  return 1000 / canvasPxPerMeter
}

export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit]
}

export function fromMm(mm: number, unit: LengthUnit): number {
  return mm / MM_PER_UNIT[unit]
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return fromMm(toMm(value, from), to)
}

/**
 * Rounds to a sensible display precision per unit so that inspector fields do not
 * show binary floating point noise (e.g. 6.000000000000001).
 */
export function precisionForUnit(unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return 1
    case 'cm':
      return 2
    case 'm':
      return 4
    case 'in':
      return 3
    case 'ft':
      return 3
  }
}

export function roundForDisplay(value: number, unit: LengthUnit): number {
  const p = 10 ** precisionForUnit(unit)
  return Math.round(value * p) / p
}

export function formatLength(mm: number, unit: LengthUnit): string {
  if (!Number.isFinite(mm)) return '—'
  const v = roundForDisplay(fromMm(mm, unit), unit)
  return `${v} ${UNIT_LABEL[unit]}`
}

/**
 * Human readable dual-unit formatting used in tooltips and reports,
 * e.g. "6 m (19 ft 8.4 in)".
 */
export function formatLengthDetailed(mm: number, unit: LengthUnit): string {
  const primary = formatLength(mm, unit)
  const secondaryUnit: LengthUnit = unit === 'm' || unit === 'cm' || unit === 'mm' ? 'ft' : 'm'
  if (secondaryUnit === 'ft') {
    return `${primary} (${formatFeetInches(mm)})`
  }
  return `${primary} (${formatLength(mm, 'm')})`
}

export function formatFeetInches(mm: number): string {
  if (!Number.isFinite(mm)) return '—'
  const totalInches = mm / MM_PER_UNIT.in
  const negative = totalInches < 0
  const abs = Math.abs(totalInches)
  let feet = Math.floor(abs / 12)
  let inches = abs - feet * 12
  // Guard against 11.9999" rounding to 12"
  inches = Math.round(inches * 10) / 10
  if (inches >= 12) {
    feet += 1
    inches -= 12
  }
  const sign = negative ? '-' : ''
  return `${sign}${feet} ft ${inches} in`
}

const NUMERIC = /^-?\d+(\.\d+)?$/
const FEET_INCHES = /^(-?\d+)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?$/i
const INCHES_ONLY = /^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/i

/**
 * Parses operator input into millimetres.
 *
 * Accepted forms (case-insensitive):
 *   "6000", "6000mm", "600 cm", "6m", "236.22in", "19ft8.4in", "19' 8.4\"", "19'8\""
 *
 * Bare numbers are interpreted in `unit`. Returns `null` for anything unparsable.
 */
export function parseLengthMm(input: string, unit: LengthUnit): number | null {
  const raw = input.trim().replace(/\u00a0/g, ' ')
  if (raw === '') return null

  const lower = raw.toLowerCase()

  // Explicit unit suffix
  const suffix = LENGTH_UNITS.find((u) => lower.endsWith(u)) ?? null
  if (suffix && suffix !== 'in' && suffix !== 'ft') {
    const body = raw.slice(0, raw.length - suffix.length).trim()
    if (NUMERIC.test(body)) return toMm(Number(body), suffix)
  }

  const feetInches = FEET_INCHES.exec(raw)
  if (feetInches && /['"]|ft|feet|in|inch/i.test(raw)) {
    const feet = Number(feetInches[1])
    const inches = feetInches[2] ? Number(feetInches[2]) : 0
    const sign = feet < 0 || raw.trim().startsWith('-') ? -1 : 1
    return sign * (Math.abs(feet) * MM_PER_UNIT.ft + inches * MM_PER_UNIT.in)
  }

  const inchesOnly = INCHES_ONLY.exec(raw)
  if (inchesOnly) return Number(inchesOnly[1]) * MM_PER_UNIT.in

  if (NUMERIC.test(raw)) return toMm(Number(raw), unit)
  return null
}

/** Parses a plain dimensionless number (rotation, pixel counts, opacity). */
export function parseNumber(input: string): number | null {
  const raw = input.trim()
  if (raw === '') return null
  if (!NUMERIC.test(raw)) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function roundTo(value: number, decimals: number): number {
  const p = 10 ** decimals
  return Math.round(value * p) / p
}
