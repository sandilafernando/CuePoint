import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { MessageChannelMain, type MessagePortMain, type WebContents } from 'electron'
import type {
  NdiFrameMeta,
  NdiRuntimeStatus,
  NdiSettings,
  NdiSourceInfo,
  NdiSourceStats
} from '@shared/appTypes'
import { findNdiLibrary, describeNdiSearch } from '../ndi/detect'
import type { HelperOutboundMessage } from '../ndi/protocol'
import { fourCCLabel } from '../ndi/protocol'
import { getLogger } from './logger'
import { AppError } from './errors'

export interface NdiManagerEvents {
  onRuntime: (status: NdiRuntimeStatus) => void
  onSources: (sources: NdiSourceInfo[]) => void
  onStats: (stats: NdiSourceStats[]) => void
}

/**
 * Supervises the NDI helper process and transports frames to the renderer.
 *
 * Frames reach the UI over a dedicated MessagePort, bypassing the JSON-RPC path. Electron
 * only allows MessagePorts to be *transferred*, so each frame is structured-cloned once
 * per process hop (helper thread -> helper -> main -> renderer); that cost is bounded by
 * throttling preview frames inside the helper and by capping the preview resolution. The
 * NDI connection itself is never throttled — only the frames sent to the UI are.
 *
 * Obsolete frames are dropped rather than queued, which keeps memory bounded.
 */
export class NdiManager extends EventEmitter {
  private helper: ChildProcess | null = null
  private settings: NdiSettings
  private logger = getLogger()
  private framePort: MessagePortMain | null = null
  private webContents: WebContents | null = null
  private stopping = false
  private restartTimes: number[] = []
  private status: NdiRuntimeStatus = {
    available: false,
    dllPath: null,
    runtimeVersion: null,
    reason: null,
    helperRunning: false,
    helperPid: null,
    helperStartedAt: null,
    lastError: null,
    restartCount: 0
  }
  private sources: NdiSourceInfo[] = []
  private stats = new Map<string, NdiSourceStats>()
  private events: NdiManagerEvents
  private helperPath: string
  private previewMaxWidth = 1920

  private pendingFramePort: boolean = false

  constructor(settings: NdiSettings, helperPath: string, events: NdiManagerEvents) {
    super()
    this.settings = settings
    this.helperPath = helperPath
    this.events = events
    const detected = findNdiLibrary(settings.dllPathOverride)
    this.status.dllPath = detected.path
    this.status.available = Boolean(detected.path)
    this.status.reason = detected.path ? null : describeNdiSearch(detected)
  }

  attachWebContents(webContents: WebContents): void {
    this.webContents = webContents
  }

  /**
   * Requests the main process to create the MessagePort that carries NDI frames to the
   * renderer. The preload script already waits for this port over `ndi:framePort`, so we
   * create it as soon as the renderer is attached and we have a helper that has reported
   * `ready`.
   */
  requestFramePort(): boolean {
    if (!this.helper || !this.helper.connected) {
      this.pendingFramePort = true
      this.logger.warn('ndi', 'Frame port request deferred: NDI helper is not connected.')
      return false
    }
    return this.createFramePort()
  }

  updateSettings(settings: NdiSettings): void {
    this.settings = settings
    if (this.helper?.connected) {
      this.command({ type: 'setPreviewFps', fps: settings.previewFps })
      if (this.status.available) {
        this.command({
          type: 'init',
          dllPath: settings.dllPathOverride ?? this.status.dllPath ?? null,
          previewFps: settings.previewFps,
          colorFormat: settings.colorFormat,
          bandwidth: settings.bandwidth,
          allowVideoFields: false,
          maxPreviewWidth: this.previewMaxWidth
        })
      }
    }
  }

  getStatus(): NdiRuntimeStatus {
    return { ...this.status }
  }

  getSources(): NdiSourceInfo[] {
    return [...this.sources]
  }

  getStats(): NdiSourceStats[] {
    return [...this.stats.values()]
  }

  get connectedCount(): number {
    return [...this.stats.values()].filter((entry) => entry.connected).length
  }

  // -------------------------------------------------------------------------
  // Helper lifecycle
  // -------------------------------------------------------------------------

  start(): NdiRuntimeStatus {
    if (this.helper) return this.getStatus()
    this.stopping = false

    if (!existsSync(this.helperPath)) {
      this.status.lastError = `The NDI helper is missing at ${this.helperPath}. Reinstall CuePoint.`
      this.logger.error('ndi', this.status.lastError)
      this.emitStatus()
      return this.getStatus()
    }

    let child: ChildProcess
    try {
      child = fork(this.helperPath, [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CUEPOINT_NDI_HELPER: '1' },
        execArgv: [],
        serialization: 'advanced',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
    } catch (error) {
      this.status.lastError = `The NDI helper could not be started: ${String(error)}`
      this.logger.error('ndi', this.status.lastError)
      this.emitStatus()
      return this.getStatus()
    }

    this.helper = child
    this.status.helperRunning = true
    this.status.helperPid = child.pid ?? null
    this.status.helperStartedAt = new Date().toISOString()
    this.logger.info('ndi', `NDI helper started (pid ${child.pid ?? 'unknown'}).`, this.helperPath)

    child.on('message', (message: HelperOutboundMessage) => this.handleHelperMessage(message))

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) this.logger.debug('ndi-helper', text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) this.logger.warn('ndi-helper', text)
    })

    child.on('exit', (code, signal) => {
      const wasRunning = this.status.helperRunning
      this.helper = null
      this.status.helperRunning = false
      this.status.helperPid = null
      this.closeFramePort()
      for (const [id, entry] of this.stats) {
        this.stats.set(id, { ...entry, connected: false, error: 'The NDI helper stopped.' })
      }
      this.emitStats()
      if (this.stopping) {
        this.logger.info('ndi', `NDI helper stopped (code ${code ?? 'null'}).`)
        this.emitStatus()
        return
      }
      this.status.lastError = `The NDI helper exited unexpectedly (code ${code ?? 'null'}${
        signal ? `, signal ${signal}` : ''
      }).`
      this.logger.error('ndi', this.status.lastError)
      if (wasRunning) this.scheduleRestart()
      this.emitStatus()
    })

    child.on('error', (error) => {
      this.status.lastError = `NDI helper process error: ${error.message}`
      this.logger.error('ndi', this.status.lastError, error.stack)
      this.emitStatus()
    })

    this.sendInit()
    this.tryEnsureFramePort()
    this.emitStatus()
    return this.getStatus()
  }

  private scheduleRestart(): void {
    const now = Date.now()
    this.restartTimes = this.restartTimes.filter((time) => now - time < 60_000)
    if (this.restartTimes.length >= 3) {
      this.status.lastError =
        'The NDI helper crashed 3 times within a minute and was not restarted automatically. Use NDI Studio → Start NDI runtime to try again.'
      this.logger.error('ndi', this.status.lastError)
      this.emitStatus()
      return
    }
    this.restartTimes.push(now)
    this.status.restartCount += 1
    const delay = 1_000 * this.restartTimes.length
    this.logger.warn('ndi', `Restarting the NDI helper in ${delay} ms.`)
    setTimeout(() => {
      if (!this.stopping) this.start()
    }, delay).unref?.()
  }

  stop(): void {
    this.stopping = true
    if (!this.helper) return
    this.command({ type: 'shutdown' })
    const child = this.helper
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill()
      }
    }, 1_500).unref?.()
  }

  async restart(): Promise<NdiRuntimeStatus> {
    this.stop()
    await new Promise((resolve) => setTimeout(resolve, 600))
    this.helper = null
    this.status.helperRunning = false
    return this.start()
  }

  private sendInit(): void {
    if (!this.helper?.connected) return
    this.command({
      type: 'init',
      dllPath: this.settings.dllPathOverride ?? this.status.dllPath ?? null,
      previewFps: this.settings.previewFps,
      colorFormat: this.settings.colorFormat,
      bandwidth: this.settings.bandwidth,
      allowVideoFields: false,
      maxPreviewWidth: this.previewMaxWidth
    })
  }

  private tryEnsureFramePort(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return
    if (!this.helper || !this.helper.connected) {
      this.pendingFramePort = true
      return
    }
    // The helper may still be initialising; the first `ready` message will retry below.
    if (this.status.available) this.createFramePort()
  }

  /**
   * Re-creates the frame port after a helper restart so frames resume flowing without the
   * renderer requesting the port again.
   */
  private ensureFramePortAfterRestart(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return
    if (!this.helper || !this.helper.connected) {
      this.pendingFramePort = true
      return
    }
    this.pendingFramePort = false
    this.createFramePort()
  }

  private command(message: Parameters<ChildProcess['send']>[0]): void {
    if (!this.helper?.connected) return
    try {
      this.helper.send(message)
    } catch (error) {
      this.logger.warn('ndi', 'Failed to send a command to the NDI helper.', String(error))
    }
  }

  // -------------------------------------------------------------------------
  // Public operations
  // -------------------------------------------------------------------------

  async discover(timeoutMs?: number): Promise<NdiSourceInfo[]> {
    if (!this.helper) {
      throw new AppError('E_NDI_HELPER', 'The NDI helper is not running.', {
        hint: 'Open NDI Studio and choose Start NDI runtime, then refresh the source list.'
      })
    }
    if (!this.status.available) {
      throw new AppError('E_NDI_UNAVAILABLE', this.status.reason ?? 'The NDI runtime is not available.', {
        hint: 'Install the NDI Runtime (on the same machine), restart CuePoint and try again.'
      })
    }
    this.command({ type: 'discover', timeoutMs: timeoutMs ?? this.settings.discoveryTimeoutMs })
    // Sources arrive asynchronously through the 'sources' message.
    return this.getSources()
  }

  connect(source: { id: string; name: string; urlAddress: string; groups: string }): NdiSourceStats {
    if (!this.helper) {
      throw new AppError('E_NDI_HELPER', 'The NDI helper is not running, so sources cannot be received.')
    }
    const existing = this.stats.get(source.id)
    if (existing?.connected) return existing

    this.stats.set(source.id, {
      sourceId: source.id,
      name: source.name,
      connected: false,
      paused: false,
      width: 0,
      height: 0,
      frameRateNumerator: 0,
      frameRateDenominator: 1,
      fourCC: 0,
      receivedFps: 0,
      renderedFps: 0,
      frameAgeMs: 0,
      averageFrameAgeMs: 0,
      receivedFrames: 0,
      droppedFrames: 0,
      skippedFrames: 0,
      reconnects: 0,
      lastFrameAt: null,
      error: null
    })
    this.command({
      type: 'connect',
      sourceId: source.id,
      name: source.name,
      urlAddress: source.urlAddress
    })
    this.emitStats()
    return this.stats.get(source.id)!
  }

  disconnect(sourceId: string): boolean {
    if (!this.stats.has(sourceId)) return false
    this.command({ type: 'disconnect', sourceId })
    this.stats.delete(sourceId)
    this.emitStats()
    return true
  }

  disconnectAll(): void {
    for (const sourceId of [...this.stats.keys()]) {
      this.command({ type: 'disconnect', sourceId })
    }
    this.stats.clear()
    this.emitStats()
  }

  setPaused(sourceId: string, paused: boolean): boolean {
    const entry = this.stats.get(sourceId)
    if (!entry) return false
    this.command({ type: 'pause', sourceId, paused })
    this.stats.set(sourceId, { ...entry, paused })
    this.emitStats()
    return true
  }

  setPreviewFps(fps: number): void {
    this.command({ type: 'setPreviewFps', fps })
  }

  /** Records a renderer-side measurement (frames actually drawn, and their age). */
  reportRenderStats(sourceId: string, renderedFps: number, frameAgeMs: number): void {
    const entry = this.stats.get(sourceId)
    if (!entry) return
    this.stats.set(sourceId, {
      ...entry,
      renderedFps,
      frameAgeMs
    })
  }

  // -------------------------------------------------------------------------
  // Frame transport
  // -------------------------------------------------------------------------

  /**
   * Hands a MessagePort to the renderer. The renderer receives frames on it directly,
   * so pixel buffers never pass through JSON or the preload bridge.
   *
   * The `ondemand` pattern (renderer calls `requestPort(ioc)`) works too, but if the
   * renderer never asks for it the UI sees no frames. Creating the port as soon as the
   * helper is ready is the most reliable path for a live-preview tool.
   */
  createFramePort(): boolean {
    if (!this.webContents || this.webContents.isDestroyed()) {
      this.logger.warn('ndi', 'Cannot create the NDI frame port: no renderer is attached.')
      return false
    }
    this.closeFramePort()
    const channel = new MessageChannelMain()
    const port = channel.port1
    port.on('message', (event) => {
      // Renderer reports its own render metrics back on the same port.
      const data = event.data as { kind?: string; sourceId?: string; renderedFps?: number; frameAgeMs?: number }
      if (data?.kind === 'renderStats' && data.sourceId) {
        this.reportRenderStats(data.sourceId, data.renderedFps ?? 0, data.frameAgeMs ?? 0)
      }
    })
    port.start()
    this.framePort = port
    this.webContents.postMessage('ndi:framePort', { ok: true }, [channel.port2])
    this.logger.info('ndi', 'NDI frame port established with the renderer.')
    return true
  }

  private closeFramePort(): void {
    if (!this.framePort) return
    try {
      this.framePort.close()
    } catch {
      // Already closed.
    }
    this.framePort = null
  }

  // -------------------------------------------------------------------------
  // Helper message handling
  // -------------------------------------------------------------------------

  private handleHelperMessage(message: HelperOutboundMessage): void {
    switch (message.type) {
      case 'ready': {
        const nowAvailable = Boolean(message.runtime.available)
        const changed =
          nowAvailable !== this.status.available ||
          this.status.dllPath !== message.runtime.dllPath ||
          this.status.runtimeVersion !== message.runtime.version
        this.status.available = nowAvailable
        this.status.dllPath = message.runtime.dllPath ?? this.status.dllPath
        this.status.runtimeVersion = message.runtime.version ?? this.status.runtimeVersion
        this.status.reason = message.runtime.reason ?? null
        if (nowAvailable && this.status.runtimeVersion === null) {
          // The helper only reports a version once a worker has loaded the runtime.
          this.status.runtimeVersion = this.status.runtimeVersion
        }
        if (changed || this.status.helperRunning) {
          this.emitStatus()

          // Re-send the runtime-dependent init so the worker picks up any settings the
          // main process applied while the helper was offline.
          this.sendInit()

          // If the renderer asked for the port before the helper became ready, or the
          // helper was restarted, establish the port now that messages can flow again.
          if (this.pendingFramePort) {
            this.pendingFramePort = false
            this.createFramePort()
          } else if (this.status.available && this.webContents && !this.webContents.isDestroyed()) {
            this.ensureFramePortAfterRestart()
          }
        }
        break
      }
      case 'sources': {
        const discoveredAt = new Date().toISOString()
        this.sources = message.sources.map((source) => ({
          id: source.id,
          name: source.name,
          urlAddress: source.urlAddress,
          groups: source.groups ?? '',
          discoveredAt
        }))
        this.events.onSources(this.getSources())
        break
      }
      case 'sourceState': {
        const entry = this.stats.get(message.sourceId)
        const next: NdiSourceStats = {
          sourceId: message.sourceId,
          name: message.name || entry?.name || message.sourceId,
          connected: message.state === 'connected',
          paused: entry?.paused ?? false,
          width: message.width,
          height: message.height,
          frameRateNumerator: message.frameRateNumerator,
          frameRateDenominator: message.frameRateDenominator,
          fourCC: message.fourCC,
          receivedFps: entry?.receivedFps ?? 0,
          renderedFps: entry?.renderedFps ?? 0,
          frameAgeMs: entry?.frameAgeMs ?? 0,
          averageFrameAgeMs: entry?.averageFrameAgeMs ?? 0,
          receivedFrames: entry?.receivedFrames ?? 0,
          droppedFrames: entry?.droppedFrames ?? 0,
          skippedFrames: entry?.skippedFrames ?? 0,
          reconnects: entry?.reconnects ?? 0,
          lastFrameAt: entry?.lastFrameAt ?? null,
          error: message.state === 'error' ? message.error : null
        }
        if (message.state === 'connected' && next.width > 0) {
          next.lastFrameAt = new Date().toISOString()
        }
        this.stats.set(message.sourceId, next)
        if (message.state === 'error') {
          this.logger.warn(
            'ndi',
            `Source "${next.name}" reported an error.`,
            message.error ?? undefined
          )
        } else if (message.state === 'connected') {
          this.logger.info(
            'ndi',
            `Source "${next.name}" connected at ${next.width}x${next.height} ${fourCCLabel(next.fourCC)} (${next.frameRateNumerator}/${next.frameRateDenominator}).`
          )
        }
        this.emitStats()
        break
      }
      case 'stats': {
        const entry = this.stats.get(message.sourceId)
        if (!entry) break
        this.stats.set(message.sourceId, {
          ...entry,
          receivedFrames: message.receivedFrames,
          droppedFrames: message.droppedFrames,
          skippedFrames: message.skippedFrames,
          receivedFps: message.receivedFps,
          averageFrameAgeMs: message.averageFrameAgeMs,
          reconnects: message.reconnects,
          width: message.width || entry.width,
          height: message.height || entry.height,
          connected: message.receivedFrames > 0 || entry.connected
        })
        this.emitStats()
        break
      }
      case 'frame': {
        this.forwardFrame(message)
        break
      }
      case 'log': {
        this.logger.log(message.level, 'ndi-helper', message.message, message.detail)
        break
      }
      case 'error': {
        this.status.lastError = message.message
        this.logger.error('ndi-helper', message.message, message.detail)
        this.emitStatus()
        break
      }
      default:
        break
    }
  }

  private forwardFrame(message: Extract<HelperOutboundMessage, { type: 'frame' }>): void {
    const port = this.framePort
    const entry = this.stats.get(message.sourceId)
    if (entry) {
      const lastFrameAt = new Date().toISOString()
      this.stats.set(message.sourceId, {
        ...entry,
        connected: true,
        lastFrameAt,
        width: message.width || entry.width,
        height: message.height || entry.height
      })
    }
    if (!port) return

    const buffer = message.buffer.buffer as ArrayBuffer
    const meta: NdiFrameMeta = {
      sourceId: message.sourceId,
      width: message.width,
      height: message.height,
      lineStrideInBytes: message.lineStrideInBytes,
      frameAgeMs: message.frameAgeMs,
      sequence: message.sequence,
      capturedAt: message.capturedAt
    }
    try {
      // `MessagePortMain` can only transfer other ports, so the frame is cloned as the
      // message payload. This is the single unavoidable copy on this hop.
      port.postMessage({ kind: 'frame', meta, buffer })
    } catch (error) {
      this.logger.warn('ndi', 'Failed to forward an NDI frame to the renderer.', String(error))
    }
  }

  private emitStatus(): void {
    this.events.onRuntime(this.getStatus())
  }

  private emitStats(): void {
    this.events.onStats(this.getStats())
  }

  getDiagnostics(): {
    helperRunning: boolean
    helperPid: number | null
    framePortOpen: boolean
    connectedSources: number
    lastError: string | null
  } {
    return {
      helperRunning: this.status.helperRunning,
      helperPid: this.status.helperPid,
      framePortOpen: Boolean(this.framePort),
      connectedSources: this.connectedCount,
      lastError: this.status.lastError
    }
  }
}
