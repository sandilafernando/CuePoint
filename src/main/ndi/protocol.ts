/**
 * Protocol between the Electron main process and the NDI helper process.
 *
 * The helper is forked as a plain Node process (ELECTRON_RUN_AS_NODE) so that a
 * crash, hang or native fault in NDI code can never take the UI down with it.
 * All messages are JSON with typed-array payloads (Node advanced serialisation).
 */

export type NdiHelperRole = 'discover' | 'receive'

export interface HelperInitMessage {
  type: 'init'
  dllPath: string | null
  previewFps: number
  colorFormat: 'rgba' | 'bgra' | 'uyvy'
  bandwidth: NdiBandwidthMode
  allowVideoFields: boolean
  /** Longest edge of a preview frame forwarded to the UI. */
  maxPreviewWidth: number
}

export interface HelperDiscoverMessage {
  type: 'discover'
  timeoutMs: number
}

export interface HelperConnectMessage {
  type: 'connect'
  sourceId: string
  name: string
  urlAddress: string
}

export interface HelperDisconnectMessage {
  type: 'disconnect'
  sourceId: string
}

export interface HelperPauseMessage {
  type: 'pause'
  sourceId: string
  paused: boolean
}

export interface HelperPreviewFpsMessage {
  type: 'setPreviewFps'
  fps: number
}

export interface HelperShutdownMessage {
  type: 'shutdown'
}

export type HelperInboundMessage =
  | HelperInitMessage
  | HelperDiscoverMessage
  | HelperConnectMessage
  | HelperDisconnectMessage
  | HelperPauseMessage
  | HelperPreviewFpsMessage
  | HelperShutdownMessage

export interface HelperReadyMessage {
  type: 'ready'
  runtime: {
    available: boolean
    dllPath: string | null
    version: string | null
    reason: string | null
  }
}

export interface HelperSourceListMessage {
  type: 'sources'
  sources: { id: string; name: string; urlAddress: string; groups: string }[]
}

export interface HelperSourceStateMessage {
  type: 'sourceState'
  sourceId: string
  name: string
  state: 'connecting' | 'connected' | 'disconnected' | 'error'
  error: string | null
  width: number
  height: number
  frameRateNumerator: number
  frameRateDenominator: number
  fourCC: number
}

export interface HelperStatsMessage {
  type: 'stats'
  sourceId: string
  receivedFrames: number
  droppedFrames: number
  skippedFrames: number
  receivedFps: number
  averageFrameAgeMs: number
  reconnects: number
  width: number
  height: number
}

export interface HelperFrameMessage {
  type: 'frame'
  sourceId: string
  sequence: number
  width: number
  height: number
  lineStrideInBytes: number
  /** Milliseconds since the frame was received from NDI. */
  frameAgeMs: number
  capturedAt: number
  buffer: Uint8Array
}

export interface HelperLogMessage {
  type: 'log'
  level: 'error' | 'warn' | 'info' | 'debug'
  scope: string
  message: string
  detail?: string
}

export interface HelperErrorMessage {
  type: 'error'
  scope: string
  message: string
  detail?: string
  fatal: boolean
}

export type HelperOutboundMessage =
  | HelperReadyMessage
  | HelperSourceListMessage
  | HelperSourceStateMessage
  | HelperStatsMessage
  | HelperFrameMessage
  | HelperLogMessage
  | HelperErrorMessage

export interface WorkerConnectCommand {
  kind: 'receive'
  sourceId: string
  name: string
  urlAddress: string
  dllPath: string
  previewFps: number
  colorFormat: 'rgba' | 'bgra' | 'uyvy'
  bandwidth: NdiBandwidthMode
  allowVideoFields: boolean
  maxPreviewWidth: number
}

export interface WorkerDiscoverCommand {
  kind: 'discover'
  dllPath: string
  timeoutMs: number
}

export type WorkerCommand = WorkerConnectCommand | WorkerDiscoverCommand | { kind: 'stop' }

export function colorFormatCode(format: 'rgba' | 'bgra' | 'uyvy'): number {
  switch (format) {
    case 'bgra':
      return 0 // NDIlib_recv_color_format_BGRX_BGRA
    case 'uyvy':
      return 3 // NDIlib_recv_color_format_UYVY_RGBA
    case 'rgba':
    default:
      return 2 // NDIlib_recv_color_format_RGBX_RGBA
  }
}

export type NdiBandwidthMode = 'native' | 'throughput'

/**
 * Maps CuePoint's bandwidth mode to the NDI receive bandwidth enum.
 *
 * Measured against NDI 6.2.1 on Windows (see docs/TESTING.md): with the enum value 0
 * the receiver starts at native resolution and drops to exactly half resolution from
 * the second frame onwards, while enum value 1 delivers native resolution continuously
 * at a slightly lower frame rate. The UI therefore labels the modes by their observed
 * effect and the app reports the resolution it actually receives.
 */
export function bandwidthCode(bandwidth: NdiBandwidthMode): number {
  return bandwidth === 'throughput' ? 0 : 1
}

export const FRAME_TYPE = {
  none: 0,
  video: 1,
  audio: 2,
  metadata: 3,
  error: 4,
  statusChange: 5
} as const

/** Turns an NDI FourCC integer into its printable label, e.g. 0x41524742 -> "BGRA". */
export function fourCCLabel(code: number): string {
  if (!Number.isFinite(code) || code === 0) return 'unknown'
  const bytes = [code & 0xff, (code >> 8) & 0xff, (code >> 16) & 0xff, (code >> 24) & 0xff]
  const text = bytes
    .map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '?'))
    .join('')
  return text
}
