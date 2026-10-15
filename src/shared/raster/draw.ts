import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphFor, measureText, sanitizeForFont } from './font'

/**
 * Pure RGBA rasteriser.
 *
 * Deliberately dependency-free so exports can be produced in the main process
 * (and asserted in unit tests) without a DOM, canvas or image library.
 * Colour components are 0-255 integers; alpha is 0-255.
 */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return { r, g, b, a }
}

export const BLACK = rgba(0, 0, 0, 255)
export const WHITE = rgba(255, 255, 255, 255)

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()`-style input. */
export function parseColor(input: string, alpha = 255): Rgba {
  const value = input.trim()
  const hex = value.startsWith('#') ? value.slice(1) : value
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return rgba(
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      alpha
    )
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return rgba(
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      alpha
    )
  }
  if (/^[0-9a-f]{8}$/i.test(hex)) {
    return rgba(
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      parseInt(hex.slice(6, 8), 16)
    )
  }
  return rgba(128, 128, 128, alpha)
}

export function createImage(width: number, height: number, background?: Rgba): RgbaImage {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const data = new Uint8ClampedArray(w * h * 4)
  if (background) {
    for (let i = 0; i < w * h; i += 1) {
      data[i * 4] = background.r
      data[i * 4 + 1] = background.g
      data[i * 4 + 2] = background.b
      data[i * 4 + 3] = background.a
    }
  }
  return { width: w, height: h, data }
}

export function getPixel(image: RgbaImage, x: number, y: number): Rgba {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return rgba(0, 0, 0, 0)
  const i = (y * image.width + x) * 4
  return {
    r: image.data[i],
    g: image.data[i + 1],
    b: image.data[i + 2],
    a: image.data[i + 3]
  }
}

export function setPixel(image: RgbaImage, x: number, y: number, color: Rgba): void {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return
  const i = (py * image.width + px) * 4
  if (color.a >= 255) {
    image.data[i] = color.r
    image.data[i + 1] = color.g
    image.data[i + 2] = color.b
    image.data[i + 3] = 255
    return
  }
  const srcA = color.a / 255
  const dstA = image.data[i + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) {
    image.data[i + 3] = 0
    return
  }
  image.data[i] = (color.r * srcA + image.data[i] * dstA * (1 - srcA)) / outA
  image.data[i + 1] = (color.g * srcA + image.data[i + 1] * dstA * (1 - srcA)) / outA
  image.data[i + 2] = (color.b * srcA + image.data[i + 2] * dstA * (1 - srcA)) / outA
  image.data[i + 3] = outA * 255
}

export interface IntRect {
  x: number
  y: number
  width: number
  height: number
}

export function fillRect(image: RgbaImage, rect: IntRect, color: Rgba): void {
  const x0 = Math.max(0, Math.round(rect.x))
  const y0 = Math.max(0, Math.round(rect.y))
  const x1 = Math.min(image.width, Math.round(rect.x + rect.width))
  const y1 = Math.min(image.height, Math.round(rect.y + rect.height))
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) setPixel(image, x, y, color)
  }
}

export function strokeRect(
  image: RgbaImage,
  rect: IntRect,
  color: Rgba,
  thickness = 1
): void {
  const t = Math.max(1, Math.round(thickness))
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  fillRect(image, { x, y, width: w, height: t }, color)
  fillRect(image, { x, y: y + h - t, width: w, height: t }, color)
  fillRect(image, { x, y, width: t, height: h }, color)
  fillRect(image, { x: x + w - t, y, width: t, height: h }, color)
}

/** Bresenham line with optional thickness (drawn as small squares). */
export function drawLine(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
  thickness = 1
): void {
  let sx = Math.round(x0)
  let sy = Math.round(y0)
  const ex = Math.round(x1)
  const ey = Math.round(y1)
  const dx = Math.abs(ex - sx)
  const dy = Math.abs(ey - sy)
  const stepX = sx < ex ? 1 : -1
  const stepY = sy < ey ? 1 : -1
  let err = dx - dy
  const t = Math.max(1, Math.round(thickness))
  const half = Math.floor(t / 2)
  let guard = 0
  const maxSteps = dx + dy + 4
  while (guard <= maxSteps) {
    guard += 1
    if (t === 1) setPixel(image, sx, sy, color)
    else fillRect(image, { x: sx - half, y: sy - half, width: t, height: t }, color)
    if (sx === ex && sy === ey) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      sx += stepX
    }
    if (e2 < dx) {
      err += dx
      sy += stepY
    }
  }
}

export function drawDashedLine(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
  dash = 4,
  gap = 4,
  thickness = 1
): void {
  const length = Math.hypot(x1 - x0, y1 - y0)
  if (length === 0) return
  const ux = (x1 - x0) / length
  const uy = (y1 - y0) / length
  let cursor = 0
  while (cursor < length) {
    const end = Math.min(cursor + dash, length)
    drawLine(
      image,
      x0 + ux * cursor,
      y0 + uy * cursor,
      x0 + ux * end,
      y0 + uy * end,
      color,
      thickness
    )
    cursor = end + gap
  }
}

export function fillPolygon(image: RgbaImage, points: { x: number; y: number }[], color: Rgba): void {
  if (points.length < 3) return
  const ys = points.map((p) => p.y)
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(...ys)))
  for (let y = minY; y <= maxY; y += 1) {
    const crossings: number[] = []
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      if (a.y === b.y) continue
      const yMin = Math.min(a.y, b.y)
      const yMax = Math.max(a.y, b.y)
      if (y + 0.5 < yMin || y + 0.5 > yMax) continue
      const t = (y + 0.5 - a.y) / (b.y - a.y)
      crossings.push(a.x + t * (b.x - a.x))
    }
    crossings.sort((p, q) => p - q)
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const x0 = Math.round(crossings[i])
      const x1 = Math.round(crossings[i + 1])
      for (let x = x0; x <= x1; x += 1) setPixel(image, x, y, color)
    }
  }
}

/** Filled rotated rectangle, used for rotated screens in layout exports. */
export function fillRotatedRect(
  image: RgbaImage,
  rect: IntRect,
  rotationDeg: number,
  color: Rgba
): void {
  if (rotationDeg % 360 === 0) {
    fillRect(image, rect, color)
    return
  }
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ].map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos
  }))
  fillPolygon(image, corners, color)
}

export function drawRotatedRectOutline(
  image: RgbaImage,
  rect: IntRect,
  rotationDeg: number,
  color: Rgba,
  thickness = 1
): void {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ].map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos
  }))
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    drawLine(image, a.x, a.y, b.x, b.y, color, thickness)
  }
}

/** Draws text with the bundled 5x7 font. `y` is the top of the glyph row. */
export function drawText(
  image: RgbaImage,
  text: string,
  x: number,
  y: number,
  color: Rgba,
  scale = 1,
  letterSpacing = 1
): void {
  const chars = sanitizeForFont(text)
  const s = Math.max(1, Math.round(scale))
  let cursor = Math.round(x)
  const top = Math.round(y)
  for (const char of chars) {
    const rows = glyphFor(char)
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const bits = rows[row] ?? 0
      for (let col = 0; col < GLYPH_WIDTH; col += 1) {
        const on = (bits >> (GLYPH_WIDTH - 1 - col)) & 1
        if (!on) continue
        fillRect(
          image,
          {
            x: cursor + col * s,
            y: top + row * s,
            width: s,
            height: s
          },
          color
        )
      }
    }
    cursor += GLYPH_WIDTH * s + letterSpacing * s
  }
}

/** Text centred inside `rect`; returns the metrics used so callers can detect overflow. */
export function drawTextCentered(
  image: RgbaImage,
  text: string,
  rect: IntRect,
  color: Rgba,
  scale = 1
): { width: number; height: number; truncated: boolean } {
  const metrics = measureText(text, scale, 1)
  const fits = metrics.width <= rect.width - 2
  const label = fits ? sanitizeForFont(text) : text
  const drawn = measureText(label, scale, 1)
  drawText(
    image,
    label,
    Math.round(rect.x + (rect.width - drawn.width) / 2),
    Math.round(rect.y + (rect.height - drawn.height) / 2),
    color,
    scale
  )
  return { width: drawn.width, height: drawn.height, truncated: !fits }
}

/** Nearest-neighbour / box downscale used to build previews of large maps. */
export function resampleImage(image: RgbaImage, targetWidth: number, targetHeight: number): RgbaImage {
  const w = Math.max(1, Math.round(targetWidth))
  const h = Math.max(1, Math.round(targetHeight))
  const out = createImage(w, h)
  const sx = image.width / w
  const sy = image.height / h
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const srcX = Math.min(image.width - 1, Math.floor(x * sx))
      const srcY = Math.min(image.height - 1, Math.floor(y * sy))
      const i = (srcY * image.width + srcX) * 4
      const o = (y * w + x) * 4
      out.data[o] = image.data[i]
      out.data[o + 1] = image.data[i + 1]
      out.data[o + 2] = image.data[i + 2]
      out.data[o + 3] = image.data[i + 3]
    }
  }
  return out
}

export function lighten(color: Rgba, amount: number): Rgba {
  const t = Math.max(0, Math.min(1, amount))
  return rgba(
    Math.round(color.r + (255 - color.r) * t),
    Math.round(color.g + (255 - color.g) * t),
    Math.round(color.b + (255 - color.b) * t),
    color.a
  )
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { ...color, a: Math.max(0, Math.min(255, Math.round(alpha))) }
}

export function containsPoint(rect: IntRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}
