import type { NdiFrameMeta } from '@shared/appTypes'

/**
 * Central frame hub.
 *
 * A single `ndi` frame listener is installed once by `AppState`, so NDI frame reception
 * does not depend on which workspace is mounted. Components subscribe to the sources they
 * actually display, and playback targets (the stage recorder) can read the newest frame
 * on demand.
 *
 * Only the newest frame per source is retained. Retaining history would turn a slow
 * consumer into unbounded memory growth, which is exactly the failure mode that makes a
 * live preview tool unusable during a long show.
 */

export interface FramePacket {
  meta: NdiFrameMeta
  buffer: ArrayBuffer
  /** Monotonic receive timestamp on the renderer side, for rendered-FPS measurement. */
  receivedAt: number
}

type Listener = (packet: FramePacket) => void

class FrameHub {
  private frames = new Map<string, FramePacket>()
  private listeners = new Map<string, Set<Listener>>()
  private globalListeners = new Set<Listener>()
  private seen = 0

  push(packet: FramePacket): void {
    this.seen += 1
    this.frames.set(packet.meta.sourceId, packet)
    for (const listener of this.listeners.get(packet.meta.sourceId) ?? []) listener(packet)
    for (const listener of this.globalListeners) listener(packet)
  }

  latest(sourceId: string): FramePacket | undefined {
    return this.frames.get(sourceId)
  }

  totalFramesSeen(): number {
    return this.seen
  }

  subscribe(sourceId: string, listener: Listener): () => void {
    const set = this.listeners.get(sourceId) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(sourceId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(sourceId)
    }
  }

  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener)
    return () => {
      this.globalListeners.delete(listener)
    }
  }

  /** Drops buffered frames for a source, e.g. after a disconnect. */
  clear(sourceId?: string): void {
    if (sourceId) this.frames.delete(sourceId)
    else this.frames.clear()
  }
}

export const frameHub = new FrameHub()

/**
 * Blits an NDI frame into a 2D canvas, letterboxing it to preserve the source aspect.
 * Returns the rendered rectangle in CSS pixels for hit-testing and overlays.
 */
export function blitFrame(
  canvas: HTMLCanvasElement,
  packet: FramePacket,
  format: 'rgba' | 'bgra' | 'uyvy'
): { x: number; y: number; width: number; height: number } | null {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return null
  const { meta, buffer } = packet
  const sourceWidth = meta.width | 0
  const sourceHeight = meta.height | 0
  if (sourceWidth <= 0 || sourceHeight <= 0) return null

  const expected = sourceWidth * sourceHeight * 4
  if (format === 'uyvy') return null

  const stride = meta.lineStrideInBytes > 0 ? meta.lineStrideInBytes : sourceWidth * 4
  const source = new Uint8ClampedArray(buffer)

  const image = context.createImageData(sourceWidth, sourceHeight)
  const target = image.data

  if (stride === sourceWidth * 4 && buffer.byteLength >= expected) {
    if (format === 'bgra') {
      for (let i = 0; i < expected; i += 4) {
        target[i] = source[i + 2]
        target[i + 1] = source[i + 1]
        target[i + 2] = source[i]
        target[i + 3] = 255
      }
    } else {
      for (let i = 0; i < expected; i += 4) {
        target[i] = source[i]
        target[i + 1] = source[i + 1]
        target[i + 2] = source[i + 2]
        target[i + 3] = 255
      }
    }
  } else {
    // Padded rows: copy line by line.
    for (let y = 0; y < sourceHeight; y += 1) {
      const sourceOffset = y * stride
      const targetOffset = y * sourceWidth * 4
      if (sourceOffset + sourceWidth * 4 > source.length) break
      for (let x = 0; x < sourceWidth; x += 1) {
        const si = sourceOffset + x * 4
        const ti = targetOffset + x * 4
        const isBgra = format === 'bgra'
        target[ti] = isBgra ? source[si + 2] : source[si]
        target[ti + 1] = source[si + 1]
        target[ti + 2] = isBgra ? source[si] : source[si + 2]
        target[ti + 3] = 255
      }
    }
  }

  const containerWidth = canvas.width
  const containerHeight = canvas.height
  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight)
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale))
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale))
  const offsetX = Math.round((containerWidth - drawWidth) / 2)
  const offsetY = Math.round((containerHeight - drawHeight) / 2)

  const scratch = document.createElement('canvas')
  scratch.width = sourceWidth
  scratch.height = sourceHeight
  const scratchContext = scratch.getContext('2d')
  if (!scratchContext) return null
  scratchContext.putImageData(image, 0, 0)

  context.fillStyle = '#05070a'
  context.fillRect(0, 0, containerWidth, containerHeight)
  context.imageSmoothingEnabled = scale < 1
  context.drawImage(scratch, 0, 0, sourceWidth, sourceHeight, offsetX, offsetY, drawWidth, drawHeight)

  return { x: offsetX, y: offsetY, width: drawWidth, height: drawHeight }
}
