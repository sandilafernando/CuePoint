import koffi from 'koffi'

/**
 * FFI bindings to the official NDI runtime (`Processing.NDI.Lib.x64.dll`).
 *
 * Why FFI rather than a compiled addon: the NDI SDK is not redistributable, so linking
 * it at build time would force every developer and CI machine to install the SDK and a
 * matching toolchain. The runtime DLL exports a flat C API, so binding to the *installed*
 * runtime gives real NDI support — real discovery, real connections, real frames — while
 * keeping the build free of SDK headers and native compilation.
 *
 * Struct layouts below mirror NDIlib_video_frame_v2_t and friends exactly; the union of
 * `NDIlib_video_frame_v2_t` and the public header is intentional and must not be
 * reordered.
 */

/**
 * Struct types are registered with koffi under their NDI names; the `func()` signature
 * strings below resolve them from that registry. They are exported so the test suite can
 * assert the ABI layout (sizes and member offsets) against the C headers.
 */
export const SOURCE_STRUCT = koffi.struct('NDIlib_source_t', {
  p_ndi_name: 'const char *',
  p_url_address: 'const char *'
})

export const VIDEO_FRAME_STRUCT = koffi.struct('NDIlib_video_frame_v2_t', {
  xres: 'int32',
  yres: 'int32',
  FourCC: 'int32',
  frame_rate_N: 'int32',
  frame_rate_D: 'int32',
  picture_aspect_ratio: 'float',
  frame_format_type: 'int32',
  timecode: 'int64',
  p_data: 'uint8_t *',
  line_stride_in_bytes: 'int32',
  p_metadata: 'const char *',
  timestamp: 'int64'
})

export const FIND_CREATE_STRUCT = koffi.struct('NDIlib_find_create_t', {
  show_local_sources: 'bool',
  p_groups: 'const char *',
  p_extra_ips: 'const char *'
})

export const RECV_CREATE_STRUCT = koffi.struct('NDIlib_recv_create_v3_t', {
  source: SOURCE_STRUCT,
  color_format: 'int32',
  bandwidth: 'int32',
  allow_video_fields: 'bool',
  p_ndi_recv_name: 'const char *'
})

export const SEND_CREATE_STRUCT = koffi.struct('NDIlib_send_create_t', {
  p_ndi_name: 'const char *',
  p_groups: 'const char *',
  clock_video: 'bool',
  clock_audio: 'bool'
})

export interface NdiFrameInfo {
  width: number
  height: number
  fourCC: number
  frameRateNumerator: number
  frameRateDenominator: number
  aspectRatio: number
  frameFormatType: number
  timecode: number
  lineStrideInBytes: number
  timestamp: number
  /** Copy of the frame's pixel data in the requested colour format. */
  data: Uint8Array
}

export interface DiscoveredSource {
  name: string
  urlAddress: string
}

export interface ReceiverOptions {
  name: string
  urlAddress: string
  colorFormat: number
  bandwidth: number
  allowVideoFields: boolean
  receiverName: string
}

/**
 * Loaded NDI runtime. One instance per worker thread: NDI requires initialisation per
 * thread that uses the API, and destroying it releases the runtime cleanly on teardown.
 */
export type NdiLibraryHandle = ReturnType<typeof koffi.load>

export class NdiRuntime {
  readonly dllPath: string
  private lib: NdiLibraryHandle
  private initialized = false
  private destroyed = false

  private readonly fnInitialize: () => boolean
  private readonly fnDestroy: () => void
  private readonly fnVersion: () => string
  private readonly fnFindCreate: (settings: unknown) => unknown
  private readonly fnFindDestroy: (instance: unknown) => void
  private readonly fnFindGetSources: (instance: unknown, count: number[]) => unknown
  private readonly fnFindWait: (instance: unknown, timeoutMs: number) => boolean
  private readonly fnRecvCreate: (settings: unknown) => unknown
  private readonly fnRecvDestroy: (instance: unknown) => void
  private readonly fnRecvCapture: (
    instance: unknown,
    video: unknown,
    audio: null,
    metadata: null,
    timeoutMs: number
  ) => number
  private readonly fnRecvFreeVideo: (instance: unknown, frame: unknown) => void
  private readonly fnSendCreate: (settings: unknown) => unknown
  private readonly fnSendDestroy: (instance: unknown) => void
  private readonly fnSendVideo: (instance: unknown, frame: unknown) => void

  constructor(dllPath: string) {
    this.dllPath = dllPath
    this.lib = koffi.load(dllPath)

    this.fnInitialize = this.lib.func('bool NDIlib_initialize()') as () => boolean
    this.fnDestroy = this.lib.func('void NDIlib_destroy()') as () => void
    this.fnVersion = this.lib.func('const char *NDIlib_version()') as () => string

    this.fnFindCreate = this.lib.func(
      'void *NDIlib_find_create_v2(NDIlib_find_create_t *p_create_settings)'
    ) as (settings: unknown) => unknown
    this.fnFindDestroy = this.lib.func('void NDIlib_find_destroy(void *p_instance)') as (
      instance: unknown
    ) => void
    this.fnFindGetSources = this.lib.func(
      'const NDIlib_source_t *NDIlib_find_get_current_sources(void *p_instance, _Out_ uint32_t *p_no_sources)'
    ) as (instance: unknown, count: number[]) => unknown
    this.fnFindWait = this.lib.func(
      'bool NDIlib_find_wait_for_sources(void *p_instance, uint32_t timeout_in_milliseconds)'
    ) as (instance: unknown, timeoutMs: number) => boolean

    this.fnRecvCreate = this.lib.func(
      'void *NDIlib_recv_create_v3(NDIlib_recv_create_v3_t *p_create_settings)'
    ) as (settings: unknown) => unknown
    this.fnRecvDestroy = this.lib.func('void NDIlib_recv_destroy(void *p_instance)') as (
      instance: unknown
    ) => void
    this.fnRecvCapture = this.lib.func(
      'int NDIlib_recv_capture_v3(void *p_instance, NDIlib_video_frame_v2_t *p_video_data, void *p_audio_data, void *p_metadata, uint32_t timeout_in_milliseconds)'
    ) as (instance: unknown, video: unknown, audio: null, metadata: null, timeoutMs: number) => number
    this.fnRecvFreeVideo = this.lib.func(
      'void NDIlib_recv_free_video_v2(void *p_instance, NDIlib_video_frame_v2_t *p_video_data)'
    ) as (instance: unknown, frame: unknown) => void

    this.fnSendCreate = this.lib.func('void *NDIlib_send_create(NDIlib_send_create_t *p_create_settings)') as (
      settings: unknown
    ) => unknown
    this.fnSendDestroy = this.lib.func('void NDIlib_send_destroy(void *p_instance)') as (
      instance: unknown
    ) => void
    this.fnSendVideo = this.lib.func(
      'void NDIlib_send_send_video_v2(void *p_instance, NDIlib_video_frame_v2_t *p_video_data)'
    ) as (instance: unknown, frame: unknown) => void
  }

  initialize(): boolean {
    if (this.initialized) return true
    this.initialized = Boolean(this.fnInitialize())
    return this.initialized
  }

  version(): string {
    try {
      return String(this.fnVersion())
    } catch {
      return 'unknown'
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    try {
      if (this.initialized) this.fnDestroy()
    } catch {
      // The runtime may already be unloading; nothing useful to do here.
    }
  }

  // --- Discovery -----------------------------------------------------------

  createFinder(showLocalSources = true, groups = ''): unknown {
    return this.fnFindCreate({ show_local_sources: showLocalSources, p_groups: groups, p_extra_ips: '' })
  }

  destroyFinder(instance: unknown): void {
    this.fnFindDestroy(instance)
  }

  /** Current sources without waiting. */
  currentSources(instance: unknown): DiscoveredSource[] {
    const count = [0]
    const pointer = this.fnFindGetSources(instance, count)
    const total = Number(count[0] ?? 0)
    if (!pointer || total <= 0) return []
    const rows = koffi.decode(pointer, SOURCE_STRUCT, total) as {
      p_ndi_name: string | null
      p_url_address: string | null
    }[]
    return rows
      .map((row) => ({
        name: typeof row.p_ndi_name === 'string' ? row.p_ndi_name : '',
        urlAddress: typeof row.p_url_address === 'string' ? row.p_url_address : ''
      }))
      .filter((source) => source.name.length > 0)
  }

  /** Blocks (up to `timeoutMs`) until the source list changes. */
  waitForSources(instance: unknown, timeoutMs: number): boolean {
    return Boolean(this.fnFindWait(instance, timeoutMs))
  }

  // --- Receiving -----------------------------------------------------------

  createReceiver(options: ReceiverOptions): unknown {
    const handle = this.fnRecvCreate({
      source: { p_ndi_name: options.name, p_url_address: options.urlAddress },
      color_format: options.colorFormat,
      bandwidth: options.bandwidth,
      allow_video_fields: options.allowVideoFields,
      p_ndi_recv_name: options.receiverName
    })
    if (!handle) {
      throw new Error(`NDI could not create a receiver for "${options.name}".`)
    }
    return handle
  }

  destroyReceiver(instance: unknown): void {
    this.fnRecvDestroy(instance)
  }

  /**
   * Captures one video frame.
   * Returns `{ type, frame }`. When `type === 1` the caller must pass `frame` to
   * `freeVideo` once the pixel data has been copied out.
   */
  captureVideo(
    instance: unknown,
    timeoutMs: number
  ): { type: number; pointer: unknown | null; info: NdiFrameInfo | null } {
    const frame = { xres: 0, yres: 0, FourCC: 0, p_data: null } as Record<string, unknown>
    const type = Number(this.fnRecvCapture(instance, frame, null, null, timeoutMs))

    if (type !== 1) {
      return { type, pointer: null, info: null }
    }

    const info = frame as unknown as {
      xres: number
      yres: number
      FourCC: number
      frame_rate_N: number
      frame_rate_D: number
      picture_aspect_ratio: number
      frame_format_type: number
      timecode: number
      p_data: unknown
      line_stride_in_bytes: number
      timestamp: number
    }

    const width = Math.max(0, Math.floor(info.xres ?? 0))
    const height = Math.max(0, Math.floor(info.yres ?? 0))
    const stride = Math.max(0, Math.floor(info.line_stride_in_bytes ?? 0))
    const rowBytes = width * 4
    const byteLength = Math.max(0, stride * Math.max(0, height - 1) + rowBytes)

    // `koffi.view` exposes the NDI-owned frame memory without copying; the caller must
    // copy out of it before `freeVideo` returns the buffer to NDI.
    let data = new Uint8Array(0)
    if (width > 0 && height > 0 && stride >= rowBytes && info.p_data) {
      data = new Uint8Array(koffi.view(info.p_data, byteLength))
    }

    return {
      type,
      pointer: frame,
      info: {
        width,
        height,
        fourCC: Number(info.FourCC ?? 0),
        frameRateNumerator: Number(info.frame_rate_N ?? 0),
        frameRateDenominator: Number(info.frame_rate_D ?? 1),
        aspectRatio: Number(info.picture_aspect_ratio ?? 0),
        frameFormatType: Number(info.frame_format_type ?? 0),
        timecode: Number(info.timecode ?? 0),
        lineStrideInBytes: stride,
        timestamp: Number(info.timestamp ?? 0),
        data
      }
    }
  }

  freeVideo(instance: unknown, pointer: unknown): void {
    this.fnRecvFreeVideo(instance, pointer)
  }

  // --- Sending (test harness) ---------------------------------------------

  createSender(name: string, clockVideo = true, groups = ''): unknown {
    const handle = this.fnSendCreate({
      p_ndi_name: name,
      p_groups: groups,
      clock_video: clockVideo,
      clock_audio: false
    })
    if (!handle) throw new Error(`NDI could not create a sender named "${name}".`)
    return handle
  }

  destroySender(instance: unknown): void {
    this.fnSendDestroy(instance)
  }

  /** Sends one RGBA/BGRA frame. `data` must be `width * height * 4` bytes. */
  sendVideo(
    instance: unknown,
    frame: {
      width: number
      height: number
      fourCC: number
      frameRateNumerator: number
      frameRateDenominator: number
      aspectRatio: number
      frameFormatType: number
      lineStrideInBytes: number
      timecode: number
      timestamp: number
      data: Uint8Array
    }
  ): void {
    this.fnSendVideo(instance, {
      xres: frame.width,
      yres: frame.height,
      FourCC: frame.fourCC,
      frame_rate_N: frame.frameRateNumerator,
      frame_rate_D: frame.frameRateDenominator,
      picture_aspect_ratio: frame.aspectRatio,
      frame_format_type: frame.frameFormatType,
      timecode: frame.timecode,
      p_data: frame.data,
      line_stride_in_bytes: frame.lineStrideInBytes,
      p_metadata: null,
      timestamp: frame.timestamp
    })
  }
}

/** NDI FourCC codes used by the bundled sender harness. */
export const FOURCC = {
  BGRA: 0x41524742,
  BGRX: 0x58524742,
  RGBA: 0x41424752,
  RGBX: 0x58424752,
  UYVY: 0x59565955
} as const

export function loadNdiRuntime(dllPath: string): NdiRuntime {
  const runtime = new NdiRuntime(dllPath)
  if (!runtime.initialize()) {
    throw new Error(
      'The NDI runtime library loaded but NDIlib_initialize() failed. Reinstall the NDI runtime.'
    )
  }
  return runtime
}
