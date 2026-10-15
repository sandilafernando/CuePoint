import { parentPort, workerData } from 'node:worker_threads'
import { loadNdiRuntime, type NdiRuntime, type NdiFrameInfo } from './ffi'
import {
  FRAME_TYPE,
  bandwidthCode,
  colorFormatCode,
  fourCCLabel,
  type WorkerCommand,
  type WorkerConnectCommand,
  type WorkerDiscoverCommand
} from './protocol'

/**
 * One worker thread per NDI concern.
 *
 * The NDI C API blocks, so every connection gets its own thread: a blocking capture
 * loop can run at full speed without starving the helper's control plane, and a fault
 * in one source's thread cannot take down the others or the application.
 *
 * Frames are posted to the helper thread as transferable ArrayBuffers (zero-copy).
 */

const port = parentPort
if (!port) {
  throw new Error('The NDI worker must run inside a worker thread.')
}

let runtime: NdiRuntime | null = null
let stopping = false
/** While paused the connection stays open and frames keep arriving, but none are forwarded. */
let paused = false

type Command = WorkerCommand | { kind: 'stop' }

const command = workerData as Command | undefined

function log(
  level: 'error' | 'warn' | 'info' | 'debug',
  message: string,
  detail?: string
): void {
  port!.postMessage({ type: 'log', level, scope: 'ndi-worker', message, ...(detail ? { detail } : {}) })
}

function fail(scope: string, error: unknown, fatal = true): void {
  const message = error instanceof Error ? error.message : String(error)
  const detail = error instanceof Error ? error.stack : undefined
  port!.postMessage({ type: 'error', scope, message, ...(detail ? { detail } : {}), fatal })
}

function shutdown(code: number): void {
  stopping = true
  try {
    runtime?.destroy()
  } catch {
    // Nothing useful to do while shutting down.
  }
  runtime = null
  process.exit(code)
}

process.on('uncaughtException', (error) => {
  fail('uncaught', error)
  shutdown(1)
})

process.on('unhandledRejection', (error) => {
  fail('unhandledRejection', error)
  shutdown(1)
})

port.on('message', (message: { kind?: string; paused?: boolean }) => {
  if (message?.kind === 'stop') {
    stopping = true
  } else if (message?.kind === 'pause') {
    paused = message.paused === true
  }
})

/**
 * Nearest-neighbour / box downscale of a tightly packed RGBA frame.
 * Only used when the source is wider than the configured preview width, so the common
 * case (1080p or smaller) never pays for it.
 */
function downscaleRgba(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Uint8Array {
  const output = new Uint8Array(targetWidth * targetHeight * 4)
  const xRatio = sourceWidth / targetWidth
  const yRatio = sourceHeight / targetHeight
  for (let y = 0; y < targetHeight; y += 1) {
    const yStart = Math.floor(y * yRatio)
    const yEnd = Math.max(yStart + 1, Math.min(sourceHeight, Math.floor((y + 1) * yRatio)))
    for (let x = 0; x < targetWidth; x += 1) {
      const xStart = Math.floor(x * xRatio)
      const xEnd = Math.max(xStart + 1, Math.min(sourceWidth, Math.floor((x + 1) * xRatio)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let samples = 0
      for (let sy = yStart; sy < yEnd; sy += 1) {
        let offset = (sy * sourceWidth + xStart) * 4
        for (let sx = xStart; sx < xEnd; sx += 1) {
          r += source[offset]
          g += source[offset + 1]
          b += source[offset + 2]
          a += source[offset + 3]
          samples += 1
          offset += 4
        }
      }
      const out = (y * targetWidth + x) * 4
      output[out] = samples ? r / samples : 0
      output[out + 1] = samples ? g / samples : 0
      output[out + 2] = samples ? b / samples : 0
      output[out + 3] = samples ? a / samples : 255
    }
  }
  return output
}

function prepareFrame(
  frame: NdiFrameInfo,
  maxPreviewWidth: number
): { buffer: Uint8Array; width: number; height: number; stride: number } {
  const width = frame.width
  const height = frame.height
  const stride = frame.lineStrideInBytes

  let data = frame.data
  // Repack rows when NDI pads the line stride; the renderer requires tight rows.
  if (stride !== width * 4) {
    const tight = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      tight.set(data.subarray(y * stride, y * stride + width * 4), y * width * 4)
    }
    data = tight
  }

  let outWidth = width
  let outHeight = height
  if (maxPreviewWidth > 0 && width > maxPreviewWidth) {
    const scale = maxPreviewWidth / width
    outWidth = Math.max(1, Math.round(width * scale))
    outHeight = Math.max(1, Math.round(height * scale))
    data = downscaleRgba(data, width, height, outWidth, outHeight)
  }

  return { buffer: data, width: outWidth, height: outHeight, stride: outWidth * 4 }
}

async function runDiscovery(command: WorkerDiscoverCommand): Promise<void> {
  runtime = loadNdiRuntime(command.dllPath)
  const finder = runtime.createFinder(true, '')
  const deadline = Date.now() + Math.max(500, command.timeoutMs)

  const emit = (): void => {
    const sources = runtime!.currentSources(finder).map((source) => ({
      id: source.name,
      name: source.name,
      urlAddress: source.urlAddress,
      groups: ''
    }))
    port!.postMessage({ type: 'sources', sources })
  }

  emit()
  while (!stopping && Date.now() < deadline) {
    const changed = runtime.waitForSources(finder, Math.min(500, Math.max(50, deadline - Date.now())))
    if (stopping) break
    if (changed) emit()
  }
  emit()
  runtime.destroyFinder(finder)
  shutdown(0)
}

async function runReceiver(command: WorkerConnectCommand): Promise<void> {
  runtime = loadNdiRuntime(command.dllPath)
  const bandwidth = bandwidthCode(command.bandwidth)
  const colorFormat = colorFormatCode(command.colorFormat)

  let receiver: unknown = null
  let reconnects = 0
  let receivedFrames = 0
  let droppedFrames = 0
  let skippedFrames = 0
  let sequence = 0
  let lastFrameAt = 0
  let lastStatsAt = Date.now()
  let statsFrames = 0
  let ageSum = 0
  let ageSamples = 0
  let currentWidth = 0
  let currentHeight = 0
  let announcedFormat = ''

  const openReceiver = (): void => {
    if (receiver) {
      try {
        runtime!.destroyReceiver(receiver)
      } catch {
        // Receiver may already be gone.
      }
      receiver = null
    }
    receiver = runtime!.createReceiver({
      name: command.name,
      urlAddress: command.urlAddress,
      colorFormat,
      bandwidth,
      allowVideoFields: command.allowVideoFields,
      receiverName: `CuePoint ${command.sourceId.slice(0, 40)}`
    })
    port!.postMessage({
      type: 'sourceState',
      sourceId: command.sourceId,
      name: command.name,
      state: 'connecting',
      error: null,
      width: currentWidth,
      height: currentHeight,
      frameRateNumerator: 0,
      frameRateDenominator: 1,
      fourCC: 0
    })
  }

  openReceiver()

  const frameTimeoutMs = Math.max(4, Math.min(100, Math.round(1000 / Math.max(1, command.previewFps))))

  while (!stopping) {
    let capture: ReturnType<NdiRuntime['captureVideo']>
    try {
      capture = runtime.captureVideo(receiver, frameTimeoutMs)
    } catch (error) {
      fail('capture', error, false)
      droppedFrames += 1
      await delay(250)
      continue
    }

    if (capture.type === FRAME_TYPE.video && capture.info) {
      const info = capture.info
      receivedFrames += 1
      lastFrameAt = Date.now()
      statsFrames += 1

      if (info.width !== currentWidth || info.height !== currentHeight) {
        currentWidth = info.width
        currentHeight = info.height
      }
      const formatKey = `${info.width}x${info.height}@${info.frameRateNumerator}/${info.frameRateDenominator}:${fourCCLabel(info.fourCC)}`
      if (formatKey !== announcedFormat) {
        announcedFormat = formatKey
        port!.postMessage({
          type: 'sourceState',
          sourceId: command.sourceId,
          name: command.name,
          state: 'connected',
          error: null,
          width: info.width,
          height: info.height,
          frameRateNumerator: info.frameRateNumerator,
          frameRateDenominator: info.frameRateDenominator,
          fourCC: info.fourCC
        })
        log('info', `Format: ${formatKey}`)
      }

      if (paused) {
        // Counted as skipped so the UI can distinguish "paused" from "no signal".
        skippedFrames += 1
        try {
          runtime.freeVideo(receiver, capture.pointer)
        } catch {
          // Frame release is best effort while paused.
        }
        continue
      }

      try {
        const prepared = prepareFrame(info, command.maxPreviewWidth)
        sequence += 1
        const frameAgeMs = Date.now() - lastFrameAt
        ageSum += frameAgeMs
        ageSamples += 1
        // Transfer ownership of the buffer to the helper thread (no copy).
        port!.postMessage(
          {
            type: 'frame',
            sourceId: command.sourceId,
            sequence,
            width: prepared.width,
            height: prepared.height,
            lineStrideInBytes: prepared.stride,
            frameAgeMs,
            capturedAt: lastFrameAt,
            buffer: prepared.buffer
          },
          [prepared.buffer.buffer as ArrayBuffer]
        )
      } catch (error) {
        skippedFrames += 1
        fail('prepareFrame', error, false)
      } finally {
        // Always return the frame to NDI, even if preparation failed.
        try {
          runtime.freeVideo(receiver, capture.pointer)
        } catch (error) {
          fail('freeVideo', error, false)
        }
      }
    } else if (capture.type === FRAME_TYPE.error) {
      droppedFrames += 1
      log('warn', 'NDI reported a receive error; reconnecting.')
      reconnects += 1
      await delay(500)
      try {
        openReceiver()
      } catch (error) {
        fail('reconnect', error, false)
        await delay(1000)
      }
    } else if (capture.type === FRAME_TYPE.statusChange) {
      log('info', 'NDI status change reported for this connection.')
    } else {
      // Capture returned without a frame: a sustained gap is handled by the staleness check below.
      if (lastFrameAt > 0 && Date.now() - lastFrameAt > 10_000 && reconnects < 20) {
        reconnects += 1
        log('warn', `No frames for 10 s from "${command.name}"; reconnecting.`)
        try {
          openReceiver()
        } catch (error) {
          fail('reconnect', error, false)
        }
        lastFrameAt = Date.now()
      }
    }

    const now = Date.now()
    if (now - lastStatsAt >= 1000) {
      const elapsed = (now - lastStatsAt) / 1000
      port!.postMessage({
        type: 'stats',
        sourceId: command.sourceId,
        receivedFrames,
        droppedFrames,
        skippedFrames,
        receivedFps: elapsed > 0 ? Math.round((statsFrames / elapsed) * 10) / 10 : 0,
        averageFrameAgeMs: ageSamples ? Math.round((ageSum / ageSamples) * 10) / 10 : 0,
        reconnects,
        width: currentWidth,
        height: currentHeight
      })
      lastStatsAt = now
      statsFrames = 0
      ageSum = 0
      ageSamples = 0
    }
  }

  if (receiver) {
    try {
      runtime.destroyReceiver(receiver)
    } catch {
      // Receiver may already be gone.
    }
  }
  shutdown(0)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  if (!command || !('kind' in command)) {
    fail('worker', new Error('The NDI worker was started without a command.'))
    shutdown(1)
    return
  }
  if (command.kind === 'discover') {
    await runDiscovery(command)
    return
  }
  if (command.kind === 'receive') {
    await runReceiver(command)
    return
  }
  shutdown(0)
}

void main()
