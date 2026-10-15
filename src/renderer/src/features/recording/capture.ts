import type { RecordingConfig, RecordingEntry } from '@shared/appTypes'
import type { Project, Screen } from '@shared/types'
import { screenGeometryRect } from '@shared/project'
import { blitFrame, frameHub } from '../ndi/frameHub'

/**
 * Capture pipeline.
 *
 * The renderer draws the requested target into an offscreen canvas at the configured
 * resolution and captures it with `MediaRecorder`. Encoded chunks are streamed to the main
 * process, which owns the file and writes chunks in order, so no encoded video is ever
 * buffered in renderer memory.
 *
 * Targets:
 *  - stage  — a clean top-down render of the stored stage layout (screens at their physical
 *             positions) with a burn-in timecode for playback verification.
 *  - screen — a single screen's output frame at its native pixel resolution.
 *  - ndi    — the newest frame received from a connected NDI source.
 *
 * Encoding is performed away from NDI reception: NDI frames are copied into the canvas and
 * the encoder runs on its own thread inside Chromium, so reception is not blocked by the
 * encoder.
 */

export interface CaptureTarget {
  project: Project
  screen?: Screen | null
  ndiSourceId?: string | null
}

export interface CaptureProgress {
  framesCaptured: number
  framesDropped: number
  elapsedMs: number
  estimatedBytes: number
}

export interface CaptureCallbacks {
  onProgress(progress: CaptureProgress): void
  onError(message: string, detail?: string): void
  onLog(message: string): void
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
]

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return null
}

export class CaptureSession {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private sessionId: string | null = null
  private raf = 0
  private framesCaptured = 0
  private framesDropped = 0
  private bytes = 0
  private startedAt = 0
  private pausedMs = 0
  private pausedAt: number | null = null
  private pushChain: Promise<unknown> = Promise.resolve()
  private stopped = false

  constructor(
    private readonly target: CaptureTarget,
    private readonly config: RecordingConfig,
    private readonly callbacks: CaptureCallbacks
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.max(16, Math.round(config.width))
    this.canvas.height = Math.max(16, Math.round(config.height))
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('A 2D canvas context is required to render the recording target.')
    this.context = context
  }

  get session(): string | null {
    return this.sessionId
  }

  /** Creates the destination file through the main process, then starts capturing. */
  async start(): Promise<void> {
    const api = window.cuepoint
    if (!api) throw new Error('The CuePoint bridge is unavailable.')
    const mimeType = pickMimeType()
    if (!mimeType) {
      throw new Error(
        'This build of Chromium cannot encode video (MediaRecorder is unavailable), so recording cannot start.'
      )
    }

    this.drawFrame(0)
    const label = this.describeTarget()
    const beginResult = await api.recording.begin({
      mimeType,
      container: this.config.container,
      width: this.canvas.width,
      height: this.canvas.height,
      fps: this.config.fps,
      label
    })
    if (!beginResult.ok) throw new Error(beginResult.error.message)
    this.sessionId = beginResult.data.sessionId
    this.callbacks.onLog(`Writing ${beginResult.data.filePath}`)

    this.stream = this.canvas.captureStream(this.config.fps)
    const recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: Math.max(250_000, Math.round(this.config.bitrateMbps * 1_000_000))
    })
    this.recorder = recorder

    recorder.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return
      void event.data.arrayBuffer().then((buffer) => {
        this.bytes += buffer.byteLength
        // Chunks must reach the file in order; the chain guarantees that.
        this.pushChain = this.pushChain.then(async () => {
          if (!this.sessionId) return
          const result = await api.recording.push(this.sessionId, buffer)
          if (!result.ok) {
            this.callbacks.onError('A recording chunk could not be written', result.error.message)
          }
        })
      })
    }

    recorder.onerror = (event: Event) => {
      const error = (event as unknown as { error?: DOMException }).error
      this.callbacks.onError('The video encoder reported an error', error?.message)
    }

    this.startedAt = performance.now()
    recorder.start(1000)
    this.loop()
  }

  pause(): void {
    if (!this.recorder || this.recorder.state !== 'recording') return
    this.recorder.pause()
    this.pausedAt = performance.now()
  }

  resume(): void {
    if (!this.recorder || this.recorder.state !== 'paused') return
    this.recorder.resume()
    if (this.pausedAt !== null) {
      this.pausedMs += performance.now() - this.pausedAt
      this.pausedAt = null
    }
  }

  /** Stops capture, waits for the final chunk, then asks the core to finalise the file. */
  async stop(): Promise<RecordingEntry | null> {
    const api = window.cuepoint
    if (!api || !this.sessionId || !this.recorder) return null
    this.stopped = true
    window.cancelAnimationFrame(this.raf)

    const recorder = this.recorder
    await new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve()
        return
      }
      recorder.onstop = () => resolve()
      recorder.stop()
    })
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.pushChain

    const durationMs = this.elapsed()
    const result = await api.recording.finish(this.sessionId, {
      durationMs,
      framesCaptured: this.framesCaptured,
      framesDropped: this.framesDropped
    })
    this.sessionId = null
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  /** Aborts the session, keeping any bytes already written and marking the file failed. */
  async cancel(reason: string): Promise<void> {
    const api = window.cuepoint
    this.stopped = true
    window.cancelAnimationFrame(this.raf)
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      // Ignore: the recorder may already be torn down.
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    if (api && this.sessionId) {
      await this.pushChain.catch(() => undefined)
      await api.recording.abort(this.sessionId, reason)
      this.sessionId = null
    }
  }

  private elapsed(): number {
    if (this.startedAt === 0) return 0
    const paused = this.pausedMs + (this.pausedAt !== null ? performance.now() - this.pausedAt : 0)
    return Math.max(0, performance.now() - this.startedAt - paused)
  }

  private loop = (): void => {
    if (this.stopped) return
    const frameInterval = 1000 / Math.max(1, this.config.fps)
    let lastDraw = 0
    const tick = (): void => {
      if (this.stopped) return
      this.raf = window.requestAnimationFrame(tick)
      const now = performance.now()
      if (this.recorder?.state === 'paused') return
      if (now - lastDraw < frameInterval) return
      lastDraw = now
      const index = this.framesCaptured + 1
      try {
        this.drawFrame(index)
        this.framesCaptured = index
      } catch (error) {
        this.framesDropped += 1
        if (this.framesDropped === 1) {
          this.callbacks.onError('A recording frame could not be rendered', String(error))
        }
      }
      const elapsedMs = this.elapsed()
      // Estimate from the configured bitrate; measured bytes are reported separately.
      const estimatedBytes = Math.max(
        this.bytes,
        Math.round((this.config.bitrateMbps * 1_000_000 * elapsedMs) / 8000)
      )
      this.callbacks.onProgress({
        framesCaptured: this.framesCaptured,
        framesDropped: this.framesDropped,
        elapsedMs,
        estimatedBytes
      })
    }
    this.raf = window.requestAnimationFrame(tick)
  }

  private describeTarget(): string {
    switch (this.config.target) {
      case 'screen':
        return `Screen – ${this.target.screen?.name ?? 'unselected'}`
      case 'ndi':
        return `NDI – ${this.config.ndiSourceId ?? 'unselected'}`
      default:
        return `Stage – ${this.target.project.meta.name}`
    }
  }

  private drawFrame(index: number): void {
    const { context } = this
    const width = this.canvas.width
    const height = this.canvas.height
    context.fillStyle = '#05070a'
    context.fillRect(0, 0, width, height)

    switch (this.config.target) {
      case 'ndi':
        this.drawNdiFrame()
        break
      case 'screen':
        this.drawScreenFrame(width, height)
        break
      default:
        this.drawStageFrame(width, height)
    }

    // Burn-in timecode: makes playback verification unambiguous.
    const elapsed = index / Math.max(1, this.config.fps)
    const timecode = formatTimecode(elapsed)
    context.font = `${Math.max(11, Math.round(height / 54))}px ui-monospace, Consolas, monospace`
    context.textBaseline = 'bottom'
    context.textAlign = 'right'
    const padding = Math.max(8, Math.round(height / 90))
    context.fillStyle = 'rgba(0,0,0,0.55)'
    const metrics = context.measureText(timecode)
    context.fillRect(
      width - metrics.width - padding * 2,
      height - metrics.width * 0 - padding * 2 - Math.max(11, Math.round(height / 54)),
      metrics.width + padding * 1.4,
      Math.max(11, Math.round(height / 54)) + padding
    )
    context.fillStyle = 'rgba(255,255,255,0.85)'
    context.fillText(timecode, width - padding, height - padding)
    context.textAlign = 'left'
  }

  private drawStageFrame(width: number, height: number): void {
    const project = this.target.project
    const { stage } = project
    const margin = 24
    const usableWidth = width - margin * 2
    const usableHeight = height - margin * 2
    const scale = Math.min(usableWidth / stage.widthMm, usableHeight / stage.heightMm)
    const stageWidth = stage.widthMm * scale
    const stageHeight = stage.heightMm * scale
    const originX = (width - stageWidth) / 2
    const originY = (height - stageHeight) / 2

    this.context.fillStyle = '#101418'
    this.context.fillRect(originX, originY, stageWidth, stageHeight)
    this.context.strokeStyle = 'rgba(255,255,255,0.35)'
    this.context.lineWidth = 1.5
    this.context.strokeRect(originX, originY, stageWidth, stageHeight)

    for (const screen of [...project.screens].sort((a, b) => a.order - b.order)) {
      if (!screen.visible) continue
      const rect = screenGeometryRect(screen)
      const x = originX + rect.x * scale
      const y = originY + rect.y * scale
      const w = rect.width * scale
      const h = rect.height * scale
      if (w < 1 || h < 1) continue

      this.context.save()
      this.context.translate(x + w / 2, y + h / 2)
      this.context.rotate((screen.rotationDeg * Math.PI) / 180)
      this.context.fillStyle = withAlpha(screen.color, 0.72)
      this.context.fillRect(-w / 2, -h / 2, w, h)
      if (w > 40 && h > 20) {
        this.context.fillStyle = 'rgba(255,255,255,0.92)'
        this.context.font = `${Math.max(11, Math.min(28, Math.round(h / 5)))}px ui-sans-serif, system-ui, sans-serif`
        this.context.textAlign = 'center'
        this.context.textBaseline = 'middle'
        this.context.fillText(screen.name, 0, 0, Math.max(10, w - 8))
        this.context.font = `${Math.max(10, Math.min(20, Math.round(h / 7)))}px ui-monospace, Consolas, monospace`
        this.context.fillText(`${screen.pixelWidth}×${screen.pixelHeight}`, 0, Math.min(20, h / 4), Math.max(10, w - 8))
      }
      this.context.restore()
    }

    this.context.fillStyle = 'rgba(255,255,255,0.55)'
    this.context.font = `${Math.max(11, Math.round(height / 60))}px ui-sans-serif, system-ui, sans-serif`
    this.context.textAlign = 'left'
    this.context.textBaseline = 'top'
    this.context.fillText(`${project.meta.name} · ${stage.name}`, margin, margin)
    this.context.fillText(
      `${(stage.widthMm / 1000).toFixed(2)} m × ${(stage.heightMm / 1000).toFixed(2)} m`,
      margin,
      margin + Math.max(14, height / 44)
    )
  }

  private drawScreenFrame(width: number, height: number): void {
    const screen = this.target.screen
    this.context.fillStyle = '#0b0f14'
    this.context.fillRect(0, 0, width, height)
    if (!screen) {
      this.context.fillStyle = 'rgba(255,255,255,0.7)'
      this.context.font = '16px ui-sans-serif, system-ui, sans-serif'
      this.context.fillText('No screen selected for recording.', 24, 40)
      return
    }
    this.context.strokeStyle = withAlpha(screen.color, 0.9)
    this.context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 260))
    this.context.strokeRect(
      this.context.lineWidth,
      this.context.lineWidth,
      width - this.context.lineWidth * 2,
      height - this.context.lineWidth * 2
    )
    // Centre cross and safe area, so a processor feed can be aligned.
    this.context.strokeStyle = 'rgba(255,255,255,0.25)'
    this.context.lineWidth = 1
    this.context.beginPath()
    this.context.moveTo(width / 2, 0)
    this.context.lineTo(width / 2, height)
    this.context.moveTo(0, height / 2)
    this.context.lineTo(width, height / 2)
    this.context.stroke()
    this.context.fillStyle = 'rgba(255,255,255,0.8)'
    this.context.font = `${Math.max(12, Math.round(height / 40))}px ui-sans-serif, system-ui, sans-serif`
    this.context.textAlign = 'center'
    this.context.textBaseline = 'middle'
    this.context.fillText(screen.name, width / 2, height / 2 - Math.max(14, height / 30), width - 40)
    this.context.font = `${Math.max(11, Math.round(height / 52))}px ui-monospace, Consolas, monospace`
    this.context.fillText(
      `${screen.pixelWidth} × ${screen.pixelHeight} px`,
      width / 2,
      height / 2 + Math.max(14, height / 30),
      width - 40
    )
    this.context.textAlign = 'left'
    this.context.textBaseline = 'top'
  }

  private drawNdiFrame(): void {
    const sourceId = this.config.ndiSourceId
    if (!sourceId) return
    const packet = frameHub.latest(sourceId)
    if (!packet) {
      this.context.fillStyle = 'rgba(255,255,255,0.6)'
      this.context.font = '16px ui-sans-serif, system-ui, sans-serif'
      this.context.fillText('Waiting for the NDI source…', 24, 40)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = this.canvas.width
    canvas.height = this.canvas.height
    const result = blitFrame(canvas, packet, 'rgba')
    if (!result) return
    this.context.fillStyle = '#000'
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.context.drawImage(canvas, 0, 0)
  }
}

export function formatTimecode(seconds: number): string {
  const total = Math.max(0, seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const wholeSeconds = Math.floor(total % 60)
  const frames = Math.floor((total % 1) * 25)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const value = Number.parseInt(full.slice(0, 6), 16)
    if (!Number.isNaN(value)) {
      return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
    }
  }
  return color
}
