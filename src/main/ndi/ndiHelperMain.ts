import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { findNdiLibrary, describeNdiSearch } from './detect'
import {
  type HelperInboundMessage,
  type HelperOutboundMessage,
  type WorkerCommand
} from './protocol'

/**
 * NDI helper process.
 *
 * Runs as a separate Node process (Electron started with ELECTRON_RUN_AS_NODE) so that
 * the NDI runtime is never loaded into the UI process. It owns:
 *   - runtime discovery (a short lived 'discover' worker),
 *   - one 'receive' worker thread per connected source,
 *   - worker crash recovery.
 *
 * The main process supervises this process; this process supervises its workers.
 * Communication with the main process is JSON plus typed arrays (advanced serialisation).
 */

const MAX_RESTARTS = 5

interface ReceiveSlot {
  command: Extract<WorkerCommand, { kind: 'receive' }>
  worker: Worker | null
  restarts: number
  desired: boolean
  paused: boolean
  backoffMs: number
}

interface HelperConfig {
  dllPath: string | null
  previewFps: number
  colorFormat: 'rgba' | 'bgra' | 'uyvy'
  bandwidth: 'native' | 'throughput'
  allowVideoFields: boolean
  maxPreviewWidth: number
}

const state: {
  config: HelperConfig
  resolvedDllPath: string | null
  runtimeVersion: string | null
  receive: Map<string, ReceiveSlot>
  discoverWorker: Worker | null
  shuttingDown: boolean
} = {
  config: {
    dllPath: null,
    previewFps: 30,
    colorFormat: 'rgba',
    bandwidth: 'native',
    allowVideoFields: false,
    maxPreviewWidth: 1920
  },
  resolvedDllPath: null,
  runtimeVersion: null,
  receive: new Map(),
  discoverWorker: null,
  shuttingDown: false
}

function send(message: HelperOutboundMessage): void {
  if (!process.send) return
  try {
    process.send(message)
  } catch {
    // The main process is gone; nothing useful to do.
  }
}

function log(level: 'error' | 'warn' | 'info' | 'debug', message: string, detail?: string): void {
  send({ type: 'log', level, scope: 'ndi-helper', message, ...(detail ? { detail } : {}) })
}

function workerPath(): string {
  return path.join(__dirname, 'ndi-worker.js')
}

function resolveDllPath(): void {
  if (state.resolvedDllPath) return
  const info = findNdiLibrary(state.config.dllPath)
  state.resolvedDllPath = info.path
  if (!info.path) {
    send({
      type: 'ready',
      runtime: {
        available: false,
        dllPath: null,
        version: null,
        reason: describeNdiSearch(info)
      }
    })
    log('warn', describeNdiSearch(info))
    return
  }
  log('info', `NDI runtime resolved via ${info.source}.`, info.path)
}

function spawnWorker(command: WorkerCommand, handlers: {
  onMessage: (message: Record<string, unknown>) => void
  onExit: (code: number) => void
}): Worker {
  const worker = new Worker(workerPath(), { workerData: command })
  worker.on('message', handlers.onMessage)
  worker.on('error', (error) => {
    log('error', 'NDI worker crashed.', String(error?.stack ?? error))
  })
  worker.on('exit', (code) => handlers.onExit(code))
  return worker
}

function relayWorkerMessage(sourceId: string | null, message: Record<string, unknown>): void {
  const type = message.type
  if (type === 'log') {
    send(message as unknown as HelperOutboundMessage)
    return
  }
  if (type === 'error') {
    send(message as unknown as HelperOutboundMessage)
    return
  }
  if (type === 'sources') {
    const sources = (message.sources ?? []) as { id: string; name: string; urlAddress: string; groups: string }[]
    send({ type: 'sources', sources })
    return
  }
  if (type === 'sourceState') {
    send({
      type: 'sourceState',
      sourceId: String(message.sourceId ?? sourceId ?? ''),
      name: String(message.name ?? ''),
      state: (message.state as 'connecting' | 'connected' | 'disconnected' | 'error') ?? 'connecting',
      error: (message.error as string | null) ?? null,
      width: Number(message.width ?? 0),
      height: Number(message.height ?? 0),
      frameRateNumerator: Number(message.frameRateNumerator ?? 0),
      frameRateDenominator: Number(message.frameRateDenominator ?? 1),
      fourCC: Number(message.fourCC ?? 0)
    })
    return
  }
  if (type === 'stats') {
    send({
      type: 'stats',
      sourceId: String(message.sourceId ?? sourceId ?? ''),
      receivedFrames: Number(message.receivedFrames ?? 0),
      droppedFrames: Number(message.droppedFrames ?? 0),
      skippedFrames: Number(message.skippedFrames ?? 0),
      receivedFps: Number(message.receivedFps ?? 0),
      averageFrameAgeMs: Number(message.averageFrameAgeMs ?? 0),
      reconnects: Number(message.reconnects ?? 0),
      width: Number(message.width ?? 0),
      height: Number(message.height ?? 0)
    })
    return
  }
  if (type === 'frame') {
    // Forwarded as-is: the ArrayBuffer stays a typed array, so Node's advanced
    // serialisation can hand it to the main process without an extra JSON hop.
    send(message as unknown as HelperOutboundMessage)
  }
}

function startReceive(command: Extract<WorkerCommand, { kind: 'receive' }>): void {
  const existing = state.receive.get(command.sourceId)
  if (existing) {
    existing.desired = false
    existing.worker?.postMessage({ kind: 'stop' })
    existing.worker?.removeAllListeners()
    void existing.worker?.terminate().catch(() => undefined)
    state.receive.delete(command.sourceId)
  }

  const slot: ReceiveSlot = {
    command,
    worker: null,
    restarts: 0,
    desired: true,
    paused: false,
    backoffMs: 500
  }
  state.receive.set(command.sourceId, slot)

  const launch = (): void => {
    if (!slot.desired || state.shuttingDown) return
    if (!state.resolvedDllPath) {
      send({
        type: 'sourceState',
        sourceId: command.sourceId,
        name: command.name,
        state: 'error',
        error: 'The NDI runtime is not installed, so this source cannot be received.',
        width: 0,
        height: 0,
        frameRateNumerator: 0,
        frameRateDenominator: 1,
        fourCC: 0
      })
      return
    }

    const workerCommand: WorkerCommand = { ...command, dllPath: state.resolvedDllPath }
    slot.worker = spawnWorker(workerCommand, {
      onMessage: (message) => relayWorkerMessage(command.sourceId, message),
      onExit: (code) => {
        slot.worker = null
        if (!slot.desired || state.shuttingDown) return
        slot.restarts += 1
        if (slot.restarts > MAX_RESTARTS) {
          slot.desired = false
          send({
            type: 'sourceState',
            sourceId: command.sourceId,
            name: command.name,
            state: 'error',
            error: `The NDI receive thread for this source stopped ${MAX_RESTARTS} times and will not be restarted. Disconnect and connect again to retry.`,
            width: 0,
            height: 0,
            frameRateNumerator: 0,
            frameRateDenominator: 1,
            fourCC: 0
          })
          return
        }
        log('warn', `NDI receive thread exited (code ${code}); restarting attempt ${slot.restarts}.`)
        const wait = slot.backoffMs
        slot.backoffMs = Math.min(slot.backoffMs * 2, 8_000)
        setTimeout(launch, wait).unref?.()
      }
    })
  }

  launch()
}

function stopReceive(sourceId: string): void {
  const slot = state.receive.get(sourceId)
  if (!slot) return
  slot.desired = false
  slot.worker?.postMessage({ kind: 'stop' })
  const worker = slot.worker
  slot.worker = null
  state.receive.delete(sourceId)
  if (worker) {
    worker.removeAllListeners()
    // Give the worker a moment to unwind NDI cleanly, then force it down.
    setTimeout(() => {
      void worker.terminate().catch(() => undefined)
    }, 250).unref?.()
  }
}

function stopAll(): void {
  state.shuttingDown = true
  for (const sourceId of [...state.receive.keys()]) stopReceive(sourceId)
  if (state.discoverWorker) {
    state.discoverWorker.removeAllListeners()
    void state.discoverWorker.terminate().catch(() => undefined)
    state.discoverWorker = null
  }
}

function handleDiscover(timeoutMs: number): void {
  if (!state.resolvedDllPath) {
    send({ type: 'sources', sources: [] })
    send({
      type: 'error',
      scope: 'discover',
      message: 'The NDI runtime is not installed, so source discovery is unavailable.',
      fatal: false
    })
    return
  }
  if (state.discoverWorker) {
    state.discoverWorker.removeAllListeners()
    void state.discoverWorker.terminate().catch(() => undefined)
    state.discoverWorker = null
  }
  state.discoverWorker = spawnWorker(
    { kind: 'discover', dllPath: state.resolvedDllPath, timeoutMs },
    {
      onMessage: (message) => relayWorkerMessage(null, message),
      onExit: () => {
        state.discoverWorker = null
      }
    }
  )
}

process.on('message', (raw: HelperInboundMessage) => {
  if (!raw || typeof raw !== 'object') return
  switch (raw.type) {
    case 'init': {
      state.config = {
        dllPath: raw.dllPath,
        previewFps: raw.previewFps,
        colorFormat: raw.colorFormat,
        bandwidth: raw.bandwidth,
        allowVideoFields: raw.allowVideoFields,
        maxPreviewWidth: raw.maxPreviewWidth
      }
      resolveDllPath()
      send({
        type: 'ready',
        runtime: {
          available: Boolean(state.resolvedDllPath),
          dllPath: state.resolvedDllPath,
          version: state.runtimeVersion,
          reason: state.resolvedDllPath ? null : 'The NDI runtime library could not be located.'
        }
      })
      break
    }
    case 'discover':
      handleDiscover(raw.timeoutMs)
      break
    case 'connect': {
      if (!state.resolvedDllPath) {
        send({
          type: 'sourceState',
          sourceId: raw.sourceId,
          name: raw.name,
          state: 'error',
          error: 'The NDI runtime is not installed, so this source cannot be received.',
          width: 0,
          height: 0,
          frameRateNumerator: 0,
          frameRateDenominator: 1,
          fourCC: 0
        })
        break
      }
      startReceive({
        kind: 'receive',
        sourceId: raw.sourceId,
        name: raw.name,
        urlAddress: raw.urlAddress,
        dllPath: state.resolvedDllPath,
        previewFps: state.config.previewFps,
        colorFormat: state.config.colorFormat,
        bandwidth: state.config.bandwidth,
        allowVideoFields: state.config.allowVideoFields,
        maxPreviewWidth: state.config.maxPreviewWidth
      })
      break
    }
    case 'disconnect':
      stopReceive(raw.sourceId)
      send({
        type: 'sourceState',
        sourceId: raw.sourceId,
        name: '',
        state: 'disconnected',
        error: null,
        width: 0,
        height: 0,
        frameRateNumerator: 0,
        frameRateDenominator: 1,
        fourCC: 0
      })
      break
    case 'pause': {
      const slot = state.receive.get(raw.sourceId)
      if (slot) {
        slot.paused = raw.paused
        slot.worker?.postMessage({ kind: 'pause', paused: raw.paused })
      }
      break
    }
    case 'setPreviewFps': {
      state.config.previewFps = raw.fps
      for (const slot of state.receive.values()) {
        slot.command.previewFps = raw.fps
      }
      break
    }
    case 'shutdown':
      stopAll()
      setTimeout(() => process.exit(0), 400)
      break
    default:
      break
  }
})

process.on('uncaughtException', (error) => {
  log('error', 'Unhandled error in the NDI helper.', String(error?.stack ?? error))
})

process.on('unhandledRejection', (error) => {
  log('error', 'Unhandled promise rejection in the NDI helper.', String(error))
})

process.on('disconnect', () => {
  stopAll()
  process.exit(0)
})

// Announce readiness so the parent can distinguish "spawned" from "usable".
send({
  type: 'ready',
  runtime: {
    available: false,
    dllPath: null,
    version: null,
    reason: 'Waiting for initialisation.'
  }
})

