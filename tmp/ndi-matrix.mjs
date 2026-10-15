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
const framePtr = koffi.alloc(VF, 1)

async function trial(label, { clockVideo, colorFormat, bandwidth, frameFormatType, nameSuffix }) {
  const name = `CUEPOINT MATRIX ${nameSuffix}`
  const sender = sendCreate({ p_ndi_name: name, p_groups: '', clock_video: clockVideo, clock_audio: false })
  const send = (tc) => sendVideo(sender, { xres: W, yres: H, FourCC: 0x41524742, frame_rate_N: 30000, frame_rate_D: 1001, picture_aspect_ratio: W/H, frame_format_type: frameFormatType, timecode: tc, p_data: pixels, line_stride_in_bytes: W*4, p_metadata: null, timestamp: BigInt(Date.now()) })
  send(0n)
  const finder = findCreate({ show_local_sources: true, p_groups: '', p_extra_ips: '' })
  let own = null
  for (let i = 0; i < 12 && !own; i++) {
    findWait(finder, 500)
    const c = [0]; const p = findGet(finder, c)
    const list = Number(c[0]) > 0 ? koffi.decode(p, SOURCE, Number(c[0])) : []
    own = list.find(s => s.p_ndi_name && s.p_ndi_name.endsWith(`(${name})`))
  }
  let got = null
  if (own) {
    const recv = recvCreate({ source: { p_ndi_name: own.p_ndi_name, p_url_address: own.p_url_address ?? '' }, color_format: colorFormat, bandwidth, allow_video_fields: false, p_ndi_recv_name: 'matrix' })
    const start = Date.now()
    let n = 0
    while (Date.now() - start < 4000 && !got) {
      send(BigInt(n++ * 1000))
      const t = Number(recvCapture(recv, framePtr, null, null, 0))
      if (t === 1) { const f = koffi.decode(framePtr, VF); got = `${f.xres}x${f.yres} stride=${f.line_stride_in_bytes} fr=${f.frame_rate_N}/${f.frame_rate_D}`; recvFree(recv, framePtr) }
      await sleep(4)
    }
    recvDestroy(recv)
  }
  sendDestroy(sender)
  findDestroy(finder)
  console.log(`${got ? 'GOT ' : 'NONE'}  clockVideo=${clockVideo} color=${colorFormat} bw=${bandwidth} fmtType=${frameFormatType}  -> ${got ?? 'no frame'}   [${label}]`)
}

await trial('baseline = probe config', { clockVideo: true, colorFormat: 2, bandwidth: 0, frameFormatType: 1, nameSuffix: 'A' })
await trial('clock_video=false', { clockVideo: false, colorFormat: 2, bandwidth: 0, frameFormatType: 1, nameSuffix: 'B' })
await trial('color=0 (BGRA)', { clockVideo: true, colorFormat: 0, bandwidth: 0, frameFormatType: 1, nameSuffix: 'C' })
await trial('bw=1', { clockVideo: true, colorFormat: 2, bandwidth: 1, frameFormatType: 1, nameSuffix: 'D' })
lib.func('void NDIlib_destroy()')()
koffi.free(framePtr)
