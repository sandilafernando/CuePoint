/**
 * CuePoint — NDI runtime self-test.
 *
 * Verifies, against the NDI runtime actually installed on this machine:
 *   1. the x64 runtime library can be located and loaded through FFI,
 *   2. NDIlib_version() reports a version,
 *   3. an NDI *sender* created by this process is discovered by NDI source discovery,
 *   4. a receiver connects to it and receives real frames of the expected size,
 *   5. the pixel payload is readable and matches what was sent.
 *
 * The sender is the official NDI runtime, so this exercises the real protocol over
 * real network sockets (loopback). It is a synthetic source, not a third-party
 * hardware device; results are reported as such.
 *
 * Usage: node tools/ndi-selftest.mjs [--width 640] [--height 360] [--frames 30]
 */

import koffi from 'koffi'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback
}

const WIDTH = argValue('width', 640)
const HEIGHT = argValue('height', 360)
const TARGET_FRAMES = argValue('frames', 30)
const X64_LIBRARY = 'Processing.NDI.Lib.x64.dll'

function findLibrary() {
  const searched = []
  const candidates = []
  for (const variable of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDI_RUNTIME_DIR_V4']) {
    if (process.env[variable]) candidates.push(path.join(process.env[variable], X64_LIBRARY))
  }
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (entry) candidates.push(path.join(entry, X64_LIBRARY))
  }
  candidates.push(
    'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\' + X64_LIBRARY,
    'C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime\\' + X64_LIBRARY
  )
  for (const candidate of candidates) {
    searched.push(candidate)
    if (existsSync(candidate)) return { path: candidate, searched, source: 'candidate' }
  }
  for (const root of ['C:\\Program Files\\NDI', 'C:\\Program Files\\NewTek']) {
    if (!existsSync(root)) continue
    for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const sub of ['', 'v6', 'Runtime']) {
        const candidate = path.join(root, dir.name, sub, X64_LIBRARY)
        searched.push(candidate)
        if (existsSync(candidate)) return { path: candidate, searched, source: 'scan' }
      }
    }
  }
  return { path: null, searched, source: 'none' }
}

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const found = findLibrary()
if (!found.path) {
  record('locate NDI runtime', false, `not found; checked ${found.searched.length} locations`)
  process.exit(1)
}
record('locate NDI runtime', true, found.path)

const SOURCE = koffi.struct('NDIlib_source_t', {
  p_ndi_name: 'const char *',
  p_url_address: 'const char *'
})
const VIDEO_FRAME = koffi.struct('NDIlib_video_frame_v2_t', {
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
// Registered so koffi can resolve the `NDIlib_*_create_t` parameter types of the function
// prototypes below. They are intentionally unreferenced from JavaScript, hence the `_` prefix.
const _FIND_CREATE = koffi.struct('NDIlib_find_create_t', {
  show_local_sources: 'bool',
  p_groups: 'const char *',
  p_extra_ips: 'const char *'
})
const _RECV_CREATE = koffi.struct('NDIlib_recv_create_v3_t', {
  source: SOURCE,
  color_format: 'int32',
  bandwidth: 'int32',
  allow_video_fields: 'bool',
  p_ndi_recv_name: 'const char *'
})
const _SEND_CREATE = koffi.struct('NDIlib_send_create_t', {
  p_ndi_name: 'const char *',
  p_groups: 'const char *',
  clock_video: 'bool',
  clock_audio: 'bool'
})

const lib = koffi.load(found.path)
const initialize = lib.func('bool NDIlib_initialize()')
const destroy = lib.func('void NDIlib_destroy()')
const version = lib.func('const char *NDIlib_version()')
const findCreate = lib.func('void *NDIlib_find_create_v2(NDIlib_find_create_t *p_create_settings)')
const findDestroy = lib.func('void NDIlib_find_destroy(void *p_instance)')
const findGetSources = lib.func(
  'const NDIlib_source_t *NDIlib_find_get_current_sources(void *p_instance, _Out_ uint32_t *p_no_sources)'
)
const findWait = lib.func('bool NDIlib_find_wait_for_sources(void *p_instance, uint32_t timeout_in_milliseconds)')
const recvCreate = lib.func('void *NDIlib_recv_create_v3(NDIlib_recv_create_v3_t *p_create_settings)')
const recvDestroy = lib.func('void NDIlib_recv_destroy(void *p_instance)')
const FRAME_TYPE_LABEL = (type) =>
  ({ 0: 'none', 1: 'video', 2: 'audio', 3: 'metadata', 4: 'error', 5: 'status' })[type] ?? String(type)
const recvCapture = lib.func(
  'int NDIlib_recv_capture_v3(void *p_instance, NDIlib_video_frame_v2_t *p_video_data, void *p_audio_data, void *p_metadata, uint32_t timeout_in_milliseconds)'
)
const recvFreeVideo = lib.func('void NDIlib_recv_free_video_v2(void *p_instance, NDIlib_video_frame_v2_t *p_video_data)')
const sendCreate = lib.func('void *NDIlib_send_create(NDIlib_send_create_t *p_create_settings)')
const sendDestroy = lib.func('void NDIlib_send_destroy(void *p_instance)')
const sendVideo = lib.func('void NDIlib_send_send_video_v2(void *p_instance, NDIlib_video_frame_v2_t *p_video_data)')

record('NDIlib_initialize', initialize() === true)
const ndiVersion = String(version())
record('NDIlib_version', ndiVersion.length > 0, ndiVersion)

// --- Sender -----------------------------------------------------------------
// A per-run token keeps this source unique: the NDI Discovery Service caches source
// records, and a fixed name can be shadowed by a stale record from an earlier run.
const RUN_TOKEN = Math.random().toString(36).slice(2, 8).toUpperCase()
const SENDER_NAME = `CUEPOINT SELFTEST ${RUN_TOKEN} (Pattern ${WIDTH}x${HEIGHT})`
const sender = sendCreate({ p_ndi_name: SENDER_NAME, p_groups: '', clock_video: false, clock_audio: false })
record('create NDI sender', Boolean(sender), SENDER_NAME)

const pixels = Buffer.alloc(WIDTH * HEIGHT * 4)
const target = { r: 32, g: 200, b: 96 }

// NDI FourCC values describe byte order in memory, so the frame we declare as BGRA
// must be written B, G, R, A. The receiver is asked for RGBX_RGBA, which converts the
// incoming BGRA into RGBA - that conversion is what this check proves.
function fillFrame(phase) {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4
      const inSquare = x < WIDTH / 2 && y < HEIGHT / 2
      pixels[i] = inSquare ? target.b : (x + phase) % 256
      pixels[i + 1] = inSquare ? target.g : (y * 2) % 256
      pixels[i + 2] = inSquare ? target.r : 64
      pixels[i + 3] = 255
    }
  }
}

fillFrame(0)
sendVideo(sender, {
  xres: WIDTH,
  yres: HEIGHT,
  FourCC: 0x41524742,
  frame_rate_N: 30000,
  frame_rate_D: 1001,
  picture_aspect_ratio: WIDTH / HEIGHT,
  frame_format_type: 1,
  timecode: 0,
  p_data: pixels,
  line_stride_in_bytes: WIDTH * 4,
  p_metadata: null,
  timestamp: 0n
})

// --- Discovery --------------------------------------------------------------
const finder = findCreate({ show_local_sources: true, p_groups: '', p_extra_ips: '' })
const discoveryStarted = Date.now()
let sources = []
for (let attempt = 0; attempt < 20 && sources.length === 0; attempt += 1) {
  findWait(finder, 500)
  const count = [0]
  const pointer = findGetSources(finder, count)
  const total = Number(count[0] ?? 0)
  sources = total > 0 ? koffi.decode(pointer, SOURCE, total) : []
}
const discoveryMs = Date.now() - discoveryStarted
// NDI publishes local sources as "MACHINE (Source name)", so match on the suffix.
const own = sources.find(
  (source) =>
    typeof source.p_ndi_name === 'string' &&
    (source.p_ndi_name === SENDER_NAME || source.p_ndi_name.endsWith(`(${SENDER_NAME})`))
)
record('discover NDI sources', Boolean(own), `${sources.length} source(s) in ${discoveryMs} ms`)
if (sources.length) {
  console.log(`      sources: ${sources.map((s) => s.p_ndi_name).join(', ')}`)
}

if (!own) {
  sendDestroy(sender)
  findDestroy(finder)
  destroy()
  process.exit(1)
}

// --- Receive ----------------------------------------------------------------
// Bandwidth enum 1 ('native' in CuePoint's UI) is required to receive native resolution
// continuously on NDI 6.2.1; enum 0 drops to exactly half resolution from frame 2.
// See docs/TESTING.md for the measurement.
const receiver = recvCreate({
  source: { p_ndi_name: own.p_ndi_name, p_url_address: own.p_url_address ?? '' },
  color_format: 2,
  bandwidth: 1,
  allow_video_fields: false,
  p_ndi_recv_name: 'CuePoint selftest receiver'
})
record('create NDI receiver', Boolean(receiver))
const framePtr = koffi.alloc(VIDEO_FRAME, 1)

let received = 0
let lastInfo = null
let mismatches = 0
let pixelChecks = 0
let firstFrameMs = null
let strideNote = null
let lastFourCC = 0
let lastFrameRate = 'n/a'
const typeCounts = new Map()
const receiveStarted = Date.now()
const deadline = receiveStarted + 20_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The C API is blocking, so this single-threaded harness must interleave sending and
// non-blocking polling. CuePoint itself never does this: each connection runs in its own
// worker thread with a blocking capture loop (see src/main/ndi/worker.ts).
while (Date.now() < deadline && received < TARGET_FRAMES) {
  sendVideo(sender, {
    xres: WIDTH,
    yres: HEIGHT,
    FourCC: 0x41524742,
    frame_rate_N: 30000,
    frame_rate_D: 1001,
    picture_aspect_ratio: WIDTH / HEIGHT,
    frame_format_type: 1,
    timecode: BigInt(received * 1000),
    p_data: pixels,
    line_stride_in_bytes: WIDTH * 4,
    p_metadata: null,
    timestamp: BigInt(Date.now())
  })

  const type = Number(recvCapture(receiver, framePtr, null, null, 0))
  typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
  if (type === 1) {
    received += 1
    if (firstFrameMs === null) firstFrameMs = Date.now() - receiveStarted
    const frame = koffi.decode(framePtr, VIDEO_FRAME)
    lastInfo = frame
    lastFourCC = Number(frame.FourCC)
    lastFrameRate = `${Number(frame.frame_rate_N)}/${Number(frame.frame_rate_D)}`
    const stride = Number(frame.line_stride_in_bytes)
    const rowBytes = Number(frame.xres) * 4
    const byteLength = stride * (Number(frame.yres) - 1) + rowBytes
    if (!Number.isFinite(byteLength) || byteLength <= 0) {
      console.log('      could not size the frame buffer from the received struct')
    } else {
      const view = new Uint8Array(koffi.view(frame.p_data, byteLength))
      // The pattern's top-left quadrant is a flat rgb(32,200,96) block.
      const r = view[0]
      const g = view[1]
      const b = view[2]
      pixelChecks += 1
      if (Math.abs(r - target.r) > 2 || Math.abs(g - target.g) > 2 || Math.abs(b - target.b) > 2) {
        mismatches += 1
        if (mismatches <= 3) {
          console.log(
            `      pixel mismatch on frame ${received}: got rgb(${r},${g},${b}) expected rgb(${target.r},${target.g},${target.b})`
          )
        }
      }
    }
    if (stride !== WIDTH * 4) strideNote = stride
    recvFreeVideo(receiver, framePtr)
  }
  await sleep(5)
}

const elapsed = Date.now() - receiveStarted
if (strideNote !== null) {
  console.log(`      note: line stride is ${strideNote} bytes (expected ${WIDTH * 4})`)
}
console.log(
  `      capture returns: ${[...typeCounts.entries()]
    .map(([type, count]) => `${FRAME_TYPE_LABEL(type)}=${count}`)
    .join(', ')}`
)

record('receive video frames', received > 0, `${received} frame(s) in ${elapsed} ms`)
record(
  'frame geometry matches sender',
  Boolean(lastInfo) && lastInfo.xres === WIDTH && lastInfo.yres === HEIGHT,
  lastInfo
    ? `${lastInfo.xres}x${lastInfo.yres}, fourcc=0x${(lastFourCC >>> 0).toString(16)}, frame rate ${lastFrameRate}`
    : 'no frame'
)
record(
  'pixel payload intact + BGRA to RGBA conversion',
  pixelChecks > 0 && mismatches === 0,
  `${pixelChecks} check(s), ${mismatches} mismatch(es)`
)

if (received >= 2) {
  const fps = ((received - 1) / (elapsed / 1000)).toFixed(1)
  console.log(`      measured receive rate: ${fps} fps; first frame after ${firstFrameMs} ms`)
}

koffi.free(framePtr)
recvDestroy(receiver)
sendDestroy(sender)
findDestroy(finder)
destroy()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
