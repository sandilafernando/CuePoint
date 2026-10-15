import koffi from 'koffi'
const DLL = 'C:/Program Files/NDI/NDI 6 Tools/Runtime/Processing.NDI.Lib.x64.dll'
const SOURCE = koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' })
const VF = koffi.struct('NDIlib_video_frame_v2_t', { xres: 'int32', yres: 'int32', FourCC: 'int32', frame_rate_N: 'int32', frame_rate_D: 'int32', picture_aspect_ratio: 'float', frame_format_type: 'int32', timecode: 'int64', p_data: 'uint8_t *', line_stride_in_bytes: 'int32', p_metadata: 'const char *', timestamp: 'int64' })
const FIND = koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' })
const RECV = koffi.struct('NDIlib_recv_create_v3_t', { source: SOURCE, color_format: 'int32', bandwidth: 'int32', allow_video_fields: 'bool', p_ndi_recv_name: 'const char *' })
const SEND = koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' })
const lib = koffi.load(DLL)
lib.func('bool NDIlib_initialize()')()
const findCreate = lib.func('void *NDIlib_find_create_v2(NDIlib_find_create_t *)')
const findGet = lib.func('const NDIlib_source_t *NDIlib_find_get_current_sources(void *, _Out_ uint32_t *)')
const findWait = lib.func('bool NDIlib_find_wait_for_sources(void *, uint32_t)')
const findDestroy = lib.func('void NDIlib_find_destroy(void *)')
const sendCreate = lib.func('void *NDIlib_send_create(NDIlib_send_create_t *)')
const sendVideo = lib.func('void NDIlib_send_send_video_v2(void *, NDIlib_video_frame_v2_t *)')
const recvCreate = lib.func('void *NDIlib_recv_create_v3(NDIlib_recv_create_v3_t *)')
const recvCapture = lib.func('int NDIlib_recv_capture_v3(void *, NDIlib_video_frame_v2_t *, void *, void *, uint32_t)')
const recvFree = lib.func('void NDIlib_recv_free_video_v2(void *, NDIlib_video_frame_v2_t *)')
const recvDestroy = lib.func('void NDIlib_recv_destroy(void *)')
const sendDestroy = lib.func('void NDIlib_send_destroy(void *)')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const W = 1280, H = 720
const pixels = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i++) { pixels[i*4]=96; pixels[i*4+1]=200; pixels[i*4+2]=32; pixels[i*4+3]=255 }
const TOKEN = Math.random().toString(36).slice(2,8).toUpperCase()
const NAME = `CUEPOINT RAMP ${TOKEN} (Pattern 1280x720)`
const sender = sendCreate({ p_ndi_name: NAME, p_groups: '', clock_video: true, clock_audio: false })
const send = () => sendVideo(sender, { xres: W, yres: H, FourCC: 0x41524742, frame_rate_N: 30000, frame_rate_D: 1001, picture_aspect_ratio: W/H, frame_format_type: 1, timecode: BigInt(Date.now()), p_data: pixels, line_stride_in_bytes: W*4, p_metadata: null, timestamp: BigInt(Date.now()) })
send()
const finder = findCreate({ show_local_sources: true, p_groups: '', p_extra_ips: '' })
let own = null
for (let i = 0; i < 12 && !own; i++) {
  findWait(finder, 500)
  const c = [0]; const p = findGet(finder, c)
  const list = Number(c[0]) > 0 ? koffi.decode(p, SOURCE, Number(c[0])) : []
  own = list.find(s => s.p_ndi_name && s.p_ndi_name.endsWith(`(${NAME})`))
}
const BW = Number(process.argv[2] ?? 0)
const CF = Number(process.argv[3] ?? 2)
const recv = recvCreate({ source: { p_ndi_name: own.p_ndi_name, p_url_address: own.p_url_address ?? '' }, color_format: CF, bandwidth: BW, allow_video_fields: false, p_ndi_recv_name: 'ramp' })
const framePtr = koffi.alloc(VF, 1)
const start = Date.now()
let frames = 0
let lastKey = ''
let lastSend = 0
while (Date.now() - start < 5000) {
  if (Date.now() - lastSend >= 33) { send(); lastSend = Date.now() }
  const t = Number(recvCapture(recv, framePtr, null, null, 0))
  if (t === 1) {
    const f = koffi.decode(framePtr, VF)
    frames++
    const key = `${f.xres}x${f.yres} stride=${f.line_stride_in_bytes}`
    if (frames === 1 || frames === 10 || frames === 100) {
      console.log(`bw=${BW} color=${CF}  frame#${frames}  ${key}  fourcc=0x${(f.FourCC>>>0).toString(16)}`)
    }
    lastKey = key
    recvFree(recv, framePtr)
  }
  await sleep(4)
}
console.log(`total video frames in 8s: ${frames}`)
recvDestroy(recv); sendDestroy(sender); findDestroy(finder); koffi.free(framePtr)
lib.func('void NDIlib_destroy()')()
