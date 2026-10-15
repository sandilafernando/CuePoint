/**
 * Built-in 5x7 bitmap font.
 *
 * CuePoint renders pixel-map and layout exports in the main process from the stored
 * logical model (never from the viewport). Using a bundled bitmap font keeps those
 * exports pixel-exact and identical on every machine, with no font dependency and no
 * canvas required — which is also what makes them unit-testable.
 *
 * Each glyph is seven row bitmasks; bit 4 (value 16) is the leftmost pixel.
 */
export const GLYPH_WIDTH = 5
export const GLYPH_HEIGHT = 7

const RAW: Record<string, string> = {
  ' ': '0,0,0,0,0,0,0',
  '0': '14,17,19,21,25,17,14',
  '1': '4,12,4,4,4,4,14',
  '2': '14,17,1,2,4,8,31',
  '3': '31,2,4,2,1,17,14',
  '4': '2,6,10,18,31,2,2',
  '5': '31,16,30,1,1,17,14',
  '6': '6,8,16,30,17,17,14',
  '7': '31,1,2,4,8,8,8',
  '8': '14,17,17,14,17,17,14',
  '9': '14,17,17,15,1,2,12',
  A: '14,17,17,31,17,17,17',
  B: '30,17,17,30,17,17,30',
  C: '14,17,16,16,16,17,14',
  D: '30,17,17,17,17,17,30',
  E: '31,16,16,30,16,16,31',
  F: '31,16,16,30,16,16,16',
  G: '14,17,16,23,17,17,15',
  H: '17,17,17,31,17,17,17',
  I: '14,4,4,4,4,4,14',
  J: '7,2,2,2,2,18,12',
  K: '17,18,20,24,20,18,17',
  L: '16,16,16,16,16,16,31',
  M: '17,27,21,21,17,17,17',
  N: '17,25,21,19,17,17,17',
  O: '14,17,17,17,17,17,14',
  P: '30,17,17,30,16,16,16',
  Q: '14,17,17,17,21,18,13',
  R: '30,17,17,30,20,18,17',
  S: '15,16,16,14,1,1,30',
  T: '31,4,4,4,4,4,4',
  U: '17,17,17,17,17,17,14',
  V: '17,17,17,17,17,10,4',
  W: '17,17,17,21,21,27,17',
  X: '17,17,10,4,10,17,17',
  Y: '17,17,10,4,4,4,4',
  Z: '31,1,2,4,8,16,31',
  '-': '0,0,0,31,0,0,0',
  '.': '0,0,0,0,0,12,12',
  ',': '0,0,0,0,12,12,8',
  ':': '0,12,12,0,12,12,0',
  '/': '1,2,2,4,8,8,16',
  '%': '17,18,4,4,8,9,17',
  '(': '2,4,8,8,8,4,2',
  ')': '8,4,2,2,2,4,8',
  '+': '0,4,4,31,4,4,0',
  '=': '0,0,31,0,31,0,0',
  '#': '10,10,31,10,31,10,10',
  '<': '2,4,8,16,8,4,2',
  '>': '8,4,2,1,2,4,8',
  _: '0,0,0,0,0,0,31',
  '?': '14,17,1,2,4,0,4',
  '!': '4,4,4,4,4,0,4',
  '&': '12,18,20,8,21,18,13',
  '*': '0,10,4,31,4,10,0',
  '°': '6,9,9,6,0,0,0',
  '×': '0,0,17,10,4,10,17',
  '"': '10,10,0,0,0,0,0',
  "'": '4,4,0,0,0,0,0',
  '@': '14,17,23,21,23,16,14'
}

const GLYPHS = new Map<string, number[]>()
for (const [char, encoded] of Object.entries(RAW)) {
  GLYPHS.set(char, encoded.split(',').map(Number))
}

export function glyphFor(char: string): readonly number[] {
  return GLYPHS.get(char) ?? GLYPHS.get('?')!
}

/** Normalises arbitrary text into characters the font can render. */
export function sanitizeForFont(text: string): string {
  const upper = text.toUpperCase()
  let out = ''
  for (const char of upper) {
    out += GLYPHS.has(char) ? char : '?'
  }
  return out
}

export interface TextMetrics {
  width: number
  height: number
}

/** Pixel size of `text` at the given integer scale and letter spacing. */
export function measureText(text: string, scale = 1, letterSpacing = 1): TextMetrics {
  const chars = sanitizeForFont(text).length
  if (chars === 0) return { width: 0, height: GLYPH_HEIGHT * scale }
  const width = chars * GLYPH_WIDTH * scale + (chars - 1) * letterSpacing * scale
  return { width, height: GLYPH_HEIGHT * scale }
}

/** Truncates text with a trailing "..." so it fits inside `maxWidth` pixels. */
export function fitText(text: string, maxWidth: number, scale = 1, letterSpacing = 1): string {
  const clean = sanitizeForFont(text)
  if (measureText(clean, scale, letterSpacing).width <= maxWidth) return clean
  const ellipsis = '...'
  const ellipsisWidth = measureText(ellipsis, scale, letterSpacing).width
  let candidate = clean
  while (candidate.length > 0) {
    candidate = candidate.slice(0, -1)
    if (measureText(candidate, scale, letterSpacing).width + ellipsisWidth <= maxWidth) {
      return `${candidate}${ellipsis}`
    }
  }
  return ''
}
