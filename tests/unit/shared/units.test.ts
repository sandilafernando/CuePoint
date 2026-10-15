import { describe, expect, it } from 'vitest'
import {
  MM_PER_UNIT,
  convertLength,
  formatFeetInches,
  formatLength,
  fromMm,
  mmPerCanvasPx,
  parseLengthMm,
  precisionForUnit,
  toMm
} from '@shared/units'

/**
 * Unit conversion is a correctness-critical layer: every physical value in the project is
 * stored in millimetres and converted only for display, so a mistake here silently corrupts
 * a stage design.
 */
describe('unit conversion', () => {
  it('stores a canonical millimetre value for every supported unit', () => {
    expect(toMm(1, 'mm')).toBe(1)
    expect(toMm(1, 'cm')).toBe(10)
    expect(toMm(1, 'm')).toBe(1000)
    expect(toMm(1, 'in')).toBeCloseTo(25.4, 10)
    expect(toMm(1, 'ft')).toBeCloseTo(304.8, 10)
  })

  it('round-trips every unit without drift', () => {
    for (const unit of Object.keys(MM_PER_UNIT) as (keyof typeof MM_PER_UNIT)[]) {
      const mm = 1234.5
      expect(toMm(fromMm(mm, unit), unit)).toBeCloseTo(mm, 6)
    }
  })

  it('converts between arbitrary units', () => {
    expect(convertLength(1, 'm', 'mm')).toBeCloseTo(1000, 9)
    expect(convertLength(36, 'in', 'ft')).toBeCloseTo(3, 9)
    expect(convertLength(2.5, 'm', 'cm')).toBeCloseTo(250, 9)
  })

  it('reports precision appropriate to each unit', () => {
    expect(precisionForUnit('mm')).toBeLessThanOrEqual(1)
    expect(precisionForUnit('m')).toBeGreaterThanOrEqual(2)
  })

  it('formats lengths with the unit label', () => {
    expect(formatLength(6000, 'm')).toBe('6 m')
    expect(formatLength(1500, 'm')).toContain('1.5')
    expect(formatLength(304.8, 'ft')).toBe('1 ft')
  })

  it('formats feet and inches together', () => {
    expect(formatFeetInches(toMm(6, 'ft') + toMm(3, 'in'))).toContain('6')
    expect(formatFeetInches(toMm(6, 'ft') + toMm(3, 'in'))).toContain('3')
  })

  it('parses operator input, including unit suffixes', () => {
    // A bare number is interpreted in the supplied unit.
    expect(parseLengthMm('6', 'm')).toBeCloseTo(6000, 6)
    expect(parseLengthMm('6000 mm', 'm')).toBeCloseTo(6000, 6)
    expect(parseLengthMm('1.5 m', 'mm')).toBeCloseTo(1500, 6)
    expect(parseLengthMm('236.22in', 'm')).toBeCloseTo(6000, 1)
    // Malformed input must not silently become a real measurement.
    expect(parseLengthMm('not a length', 'm')).toBeNull()
    expect(parseLengthMm('', 'm')).toBeNull()
  })

  it('derives the canvas scale from the configured canvas resolution', () => {
    // 40 canvas pixels per metre means one canvas pixel is 25 mm.
    expect(mmPerCanvasPx(40)).toBeCloseTo(25, 9)
    expect(mmPerCanvasPx(1000)).toBeCloseTo(1, 9)
  })
})
