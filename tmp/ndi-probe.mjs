import koffi from 'koffi'
const DLL = 'C:/Program Files/NDI/NDI 6 Tools/Runtime/Processing.NDI.Lib.x64.dll'
const SOURCE = koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' })
const VF = koffi.struct('NDIlib_video_frame_v2_t', {
  xres: 'int32', yres: 'int32', FourCC: 'int32', frame_rate_N: 'int32', frame_rate_D: 'int32',
  picture_aspect_ratio: 'float', frame_format_type: 'int32', timecode: 'int64', p_data: 'uint8_t *',
  line_stride_in_bytes: 'int32', p_metadata: 'const char *', timestamp: 'int64'
})
const FIND = koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' })
const RECV = koffi.struct('NDIlib_recv_create_v3_t', { source: SOURCE, color_format: 'int32', bandwidth: 'int32', allow_video_fields: 'bool', p_ndi_recv_name: 'const char *' })
const SEND = koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' })
const lib = koffi.load(DLL)
console.log('sizeof recv_create =', koffi.sizeof(RECV), 'alignment', koffi.alignof(RECV))
console.log('offsetof color_format =', koffi.offsetof(RECV, 'color_format'), 'bandwidth =', koffi.offsetof(RECV, 'bandwidth'), 'allow_video_fields =', koffi.offsetof(RECV, 'allow_video_fields'), 'name =', koffi.offsetof(RECV, 'p_ndi_recv_name'))
console.log('sizeof video_frame =', koffi.sizeof(VF), 'sizeof send_create =', koffi.sizeof(SEND))
console.log('offsetof p_data =', koffi.offsetof(VF, 'p_data'), 'stride =', koffi.offsetof(VF, 'line_stride_in_bytes'))

lib.func('bool NDIlib_initialize()')()
const findCreate = lib.func('void *NDIlib_find_create_v2(NDIlib_find_create_t *)')
const findGet = lib.func('const NDIlib_source_t *NDIlib_find_get_current_sources(void *, _Out_ uint32_t *)')
const findWait = lib.func('bool NDIlib_find_wait_for_sources(void *, uint32_t)')
const sendCreate = lib.func('void *NDIlib_send_create(NDIlib_send_create_t *)')
const sendVideo = lib.func('void NDIlib_send_send_video_v2(void *, NDIlib_video_frame_v2_t *)')
const recvCreate = lib.func('void *NDIlib_recv_create_v3(NDIlib_recv_create_v3_t *)')
const recvCapture = lib.func('int NDIlib_recv_capture_v3(void *, NDIlib_video_frame_v2_t *, void *, void *, uint32_t)')
const recvFree = lib.func('void NDIlib_recv_free_video_v2(void *, NDIlib_video_frame_v2_t *)')
const recvDestroy = lib.func('void NDIlib_recv_destroy(void *)')
const sendDestroy = lib.func('void NDIlib_send_destroy(void *)')

const W = 1280, H = 720
const pixels = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i++) { pixels[i*4] = 96; pixels[i*4+1] = 200; pixels[i*4+2] = 32; pixels[i*4+3] = 255 }
const NAME = 'CUEPOINT PROBE (HalfRes Test)'
const sender = sendCreate({ p_ndi_name: NAME, p_groups: '', clock_video: true, clock_audio: false })
sendVideo(sender, { xres: W, yres: H, FourCC: 0x41524742, frame_rate_N: 30000, frame_rate_D: 1001, picture_aspect_ratio: W/H, frame_format_type: 1, timecode: 0n, p_data: pixels, line_stride_in_bytes: W*4, p_metadata: null, timestamp: 0n })

const finder = findCreate({ show_local_sources: true, p_groups: '', p_extra_ips: '' })
let own = null
for (let i = 0; i < 12 && !own; i++) {
  findWait(finder, 500)
  const c = [0]; const p = findGet(finder, c)
  const list = Number(c[0]) > 0 ? koffi.decode(p, SOURCE, Number(c[0])) : []
  own = list.find(s => s.p_ndi_name && s.p_ndi_name.includes('CUEPOINT PROBE'))
}
console.log('own source:', JSON.stringify(own))

const variants = [
  { label: 'bandwidth=highest(0), url from discovery', bandwidth: 0, urlAddress: own.p_url_address ?? '' },
  { label: 'bandwidth=highest(0), empty url', bandwidth: 0, urlAddress: '' },
  { label: 'bandwidth=lowest(1), empty url', bandwidth: 1, urlAddress: '' }
]
const framePtr = koffi.alloc(VF, 1)
for (const v of variants) {
  const recv = recvCreate({ source: { p_ndi_name: own.p_ndi_name, p_url_address: v.urlAddress }, color_format: 2, bandwidth: v.bandwidth, allow_video_fields: false, p_ndi_recv_name: 'probe' })
  let got = null
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const start = Date.now()
  while (Date.now() - start < 5000 && !got) {
    sendVideo(sender, { xres: W, yres: H, FourCC: 0x41524742, frame_rate_N: 30000, frame_rate_D: 1001, picture_aspect_ratio: W/H, frame_format_type: 1, timecode: 0n, p_data: pixels, line_stride_in_bytes: W*4, p_metadata: null, timestamp: BigInt(Date.now()) })
    const t = Number(recvCapture(recv, framePtr, null, null, 0))
    if (t === 1) { const f = koffi.decode(framePtr, VF); got = { w: f.xres, h: f.yres, stride: f.line_stride_in_bytes, fourcc: f.FourCC }; recvFree(recv, framePtr) }
    await sleep(4)
  }
  console.log(`${v.label} -> ${got ? `${got.w}x${got.h} stride=${got.stride} fourcc=0x${(got.fourcc>>>0).toString(16)}` : 'NO FRAME'}`)
  recvDestroy(recv)
}
koffi.free(framePtr)
sendDestroy(sender)
lib.func('void NDIlib_destroy()')()
