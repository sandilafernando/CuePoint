import { createWriteStream, type WriteStream } from 'node:fs'
import { access, constants, mkdir, stat, statfs } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type {
  RecordingConfig,
  RecordingEntry,
  RecordingStatus,
  RecordingVerification
} from '@shared/appTypes'
import { AppError } from './errors'
import type { AppPaths } from './paths'
import { resolveUnpackedModule } from './paths'
import type { ProjectStore } from './projectStore'
import type { Logger } from './logger'
import { newId } from '@shared/project'

/** Minimum free space required before a recording may start. */
const MIN_FREE_BYTES = 512 * 1024 * 1024

interface Session {
  id: string
  filePath: string
  stream: WriteStream
  bytes: number
  startedAt: string
  container: 'webm' | 'mp4'
  mimeType: string
  width: number
  height: number
  fps: number
  label: string
  target: RecordingEntry['target']
  framesCaptured: number
  framesDropped: number
  durationMs: number
  closed: boolean
}

export interface EncoderInfo {
  name: string
  available: boolean
  ffmpegPath: string | null
  detail: string
}

/**
 * Recording service.
 *
 * Encoding happens in the renderer (Chromium's MediaRecorder on a canvas capture
 * stream), which keeps the CPU-heavy encoder off the process that also handles NDI
 * reception. The main process owns the file: it opens the destination, streams encoded
 * chunks to disk, then verifies the finished file by decoding it with FFmpeg and,
 * optionally, transcodes it to MP4.
 */
export class RecordingService {
  private paths: AppPaths
  private store: ProjectStore
  private logger: Logger
  private session: Session | null = null
  private status: RecordingStatus = {
    state: 'idle',
    entry: null,
    encoder: { name: 'Chromium MediaRecorder', available: true, ffmpegPath: null, detail: 'Not checked yet.' },
    framesCaptured: 0,
    framesDropped: 0,
    elapsedMs: 0,
    estimatedBytes: 0,
    outputDirectory: null,
    error: null
  }
  private startedAt = 0
  private encoderInfo: EncoderInfo | null = null
  private listeners = new Set<(status: RecordingStatus) => void>()

  constructor(paths: AppPaths, store: ProjectStore, logger: Logger) {
    this.paths = paths
    this.store = store
    this.logger = logger
  }

  onStatusChange(listener: (status: RecordingStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const snapshot = this.getStatus()
    for (const listener of this.listeners) listener(snapshot)
  }

  getStatus(): RecordingStatus {
    if (this.session && !this.session.closed) {
      this.status.elapsedMs = Date.now() - this.startedAt
      this.status.framesCaptured = this.session.framesCaptured
      this.status.framesDropped = this.session.framesDropped
    }
    return { ...this.status }
  }

  getFfmpegPath(): string | null {
    const resolved = resolveUnpackedModule(this.paths, 'ffmpeg-static/ffmpeg.exe')
    if (resolved && !resolved.includes('app.asar' + path.sep)) return resolved
    // ffmpeg-static resolves its binary path through its own module, so it is required at
    // runtime on purpose: bundling it would rewrite the path to the binary inside the archive.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const required = require('ffmpeg-static') as string | null
      if (required) return required.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    } catch {
      // Fall through to the resolved path.
    }
    return null
  }

  /** Verifies that FFmpeg is present and usable; result is cached. */
  async checkEncoder(force = false): Promise<EncoderInfo> {
    if (this.encoderInfo && !force) return this.encoderInfo
    const ffmpegPath = this.getFfmpegPath()
    if (!ffmpegPath) {
      this.encoderInfo = {
        name: 'Chromium MediaRecorder',
        available: true,
        ffmpegPath: null,
        detail:
          'MediaRecorder can capture WebM directly. FFmpeg was not found, so MP4 transcoding and file verification are unavailable.'
      }
      return this.encoderInfo
    }
    try {
      const { code, stdout } = await runProcess(ffmpegPath, ['-hide_banner', '-version'], 15_000)
      const firstLine = stdout.split('\n')[0]?.trim() ?? ''
      const hasX264 = await this.hasEncoder(ffmpegPath, 'libx264')
      this.encoderInfo = {
        name: 'Chromium MediaRecorder + FFmpeg',
        available: code === 0,
        ffmpegPath,
        detail:
          code === 0
            ? `${firstLine}. MP4 (H.264) transcoding is ${hasX264 ? 'available' : 'not available in this FFmpeg build'}.`
            : `FFmpeg exited with code ${code} when asked for its version.`
      }
    } catch (error) {
      this.encoderInfo = {
        name: 'Chromium MediaRecorder',
        available: true,
        ffmpegPath,
        detail: `FFmpeg could not be executed (${String(error)}). WebM capture still works; verification is unavailable.`
      }
    }
    this.status.encoder = { ...this.encoderInfo }
    this.emit()
    return this.encoderInfo
  }

  private async hasEncoder(ffmpegPath: string, name: string): Promise<boolean> {
    return hasEncoderImpl(ffmpegPath, name)
  }

  /** Preflight: directory, permissions, disk space, encoder and output path. */
  async preflight(config: RecordingConfig): Promise<RecordingStatus> {
    const directory = config.outputDirectory ?? this.paths.recordings
    try {
      await mkdir(directory, { recursive: true })
      await access(directory, constants.W_OK)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new AppError(
        code === 'EACCES' || code === 'EPERM' ? 'E_PERMISSION' : 'E_IO',
        `CuePoint cannot write to the recording folder "${directory}".`,
        {
          hint: 'Choose a different output folder in Recording → Configuration.',
          detail: String(error)
        }
      )
    }

    try {
      const stats = await statfs(directory)
      const free = Number(stats.bavail) * Number(stats.bsize)
      if (Number.isFinite(free) && free < MIN_FREE_BYTES) {
        throw new AppError('E_DISK_FULL', 'There is not enough free disk space to start recording.', {
          hint: `At least ${Math.round(MIN_FREE_BYTES / 1024 / 1024)} MB is required on ${directory}. Free up space or choose another drive.`
        })
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      this.logger.warn('recording', 'Free disk space could not be determined.', String(error))
    }

    if (config.width * config.height > 7680 * 4320) {
      throw new AppError('E_INVALID_INPUT', 'The requested recording resolution is too large.', {
        hint: 'Use 7680 × 4320 or smaller.'
      })
    }

    const encoder = await this.checkEncoder()
    this.status = {
      ...this.status,
      state: 'arming',
      encoder: { ...encoder, ffmpegPath: encoder.ffmpegPath },
      outputDirectory: directory,
      error: null,
      framesCaptured: 0,
      framesDropped: 0,
      elapsedMs: 0,
      estimatedBytes: Math.round(((config.bitrateMbps * 1_000_000) / 8) * 60)
    }
    this.emit()
    return this.getStatus()
  }

  /** Creates the destination file and opens it for streaming. */
  async begin(payload: {
    mimeType: string
    container: 'webm' | 'mp4'
    width: number
    height: number
    fps: number
    label: string
    config: RecordingConfig
  }): Promise<{ sessionId: string; filePath: string }> {
    if (this.session && !this.session.closed) {
      throw new AppError('E_RECORDING', 'A recording is already in progress.', {
        hint: 'Stop the current recording before starting another one.'
      })
    }
    const directory = payload.config.outputDirectory ?? this.paths.recordings
    await mkdir(directory, { recursive: true })
    const fileName = buildFileName(
      payload.config.fileNameTemplate,
      this.store.getProject().meta.name,
      payload.label,
      payload.container
    )
    const filePath = path.join(directory, await uniqueFilePath(directory, fileName))

    const stream = createWriteStream(filePath, { flags: 'wx' })
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', (error) => reject(error))
    })

    this.session = {
      id: newId('rec'),
      filePath,
      stream,
      bytes: 0,
      startedAt: new Date().toISOString(),
      container: payload.container,
      mimeType: payload.mimeType,
      width: payload.width,
      height: payload.height,
      fps: payload.fps,
      label: payload.label,
      target: payload.config.target,
      framesCaptured: 0,
      framesDropped: 0,
      durationMs: 0,
      closed: false
    }
    this.startedAt = Date.now()
    this.status = {
      ...this.status,
      state: 'recording',
      outputDirectory: directory,
      error: null
    }
    this.emit()
    return { sessionId: this.session.id, filePath }
  }

  /** Appends an encoded chunk. Back-pressure is applied through the write stream. */
  async push(sessionId: string, chunk: Uint8Array): Promise<{ bytes: number }> {
    const session = this.session
    if (!session || session.id !== sessionId || session.closed) {
      throw new AppError('E_RECORDING', 'The recording session is no longer active.', {
        hint: 'Start a new recording.'
      })
    }
    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    await new Promise<void>((resolve, reject) => {
      const ok = session.stream.write(buffer, (error) => {
        if (error) reject(error)
      })
      if (ok) resolve()
      else session.stream.once('drain', () => resolve())
    })
    session.bytes += buffer.length
    return { bytes: session.bytes }
  }

  setProgress(sessionId: string, framesCaptured: number, framesDropped: number, durationMs: number): void {
    if (!this.session || this.session.id !== sessionId) return
    this.session.framesCaptured = framesCaptured
    this.session.framesDropped = framesDropped
    this.session.durationMs = durationMs
  }

  pause(): RecordingStatus {
    if (this.status.state !== 'recording') return this.getStatus()
    this.status = { ...this.status, state: 'paused' }
    this.emit()
    return this.getStatus()
  }

  resume(): RecordingStatus {
    if (this.status.state !== 'paused') return this.getStatus()
    this.status = { ...this.status, state: 'recording' }
    this.emit()
    return this.getStatus()
  }

  /** Finalises the file, verifies it and (optionally) transcodes it to MP4. */
  async finish(
    sessionId: string,
    payload: { durationMs: number; framesCaptured: number; framesDropped: number; config: RecordingConfig }
  ): Promise<RecordingEntry> {
    const session = this.session
    if (!session || session.id !== sessionId) {
      throw new AppError('E_RECORDING', 'The recording session is no longer active.')
    }
    this.status = { ...this.status, state: 'finalizing' }
    this.emit()

    await closeStream(session.stream)
    session.closed = true
    session.durationMs = payload.durationMs
    session.framesCaptured = payload.framesCaptured
    session.framesDropped = payload.framesDropped

    let sizeBytes = session.bytes
    try {
      sizeBytes = (await stat(session.filePath)).size
    } catch {
      // Keep the byte count reported by the stream.
    }

    if (sizeBytes === 0) {
      const entry = this.buildEntry(session, sizeBytes, 'failed', 'The recording file is empty; nothing was captured.', null)
      await this.store.upsertRecordingEntry(entry)
      this.session = null
      this.status = { ...this.status, state: 'failed', entry, error: entry.error }
      this.emit()
      return entry
    }

    let verification = await this.verifyFile(session.filePath)
    let finalPath = session.filePath

    if (payload.config.container === 'mp4' || payload.config.transcodeToMp4) {
      const transcoded = await this.transcode(session.filePath, session.width, session.height).catch(
        (error: unknown) => {
          this.logger.warn('recording', 'Transcode to MP4 failed; the WebM capture is kept.', String(error))
          return null
        }
      )
      if (transcoded) {
        finalPath = transcoded
        sizeBytes = (await stat(transcoded)).size
        verification = await this.verifyFile(transcoded)
      } else if (payload.config.container === 'mp4') {
        this.logger.warn(
          'recording',
          'MP4 was requested but transcoding was unavailable; the recording was kept as WebM.'
        )
      }
    }

    const entry = this.buildEntry(
      session,
      sizeBytes,
      verification.decodable ? 'complete' : 'failed',
      verification.decodable ? null : `The recording could not be decoded: ${verification.detail}`,
      verification,
      finalPath
    )
    await this.store.upsertRecordingEntry(entry)
    this.session = null
    this.status = {
      ...this.status,
      state: entry.state,
      entry,
      error: entry.error,
      framesCaptured: session.framesCaptured,
      framesDropped: session.framesDropped,
      elapsedMs: session.durationMs
    }
    this.emit()
    this.logger.info(
      'recording',
      `Recording finalised: ${path.basename(finalPath)} (${Math.round(sizeBytes / 1024)} KB, ${(session.durationMs / 1000).toFixed(1)} s).`,
      verification.detail
    )
    return entry
  }

  async abort(sessionId: string, reason: string): Promise<boolean> {
    const session = this.session
    if (!session || session.id !== sessionId) return false
    await closeStream(session.stream).catch(() => undefined)
    session.closed = true
    let sizeBytes = session.bytes
    try {
      sizeBytes = (await stat(session.filePath)).size
    } catch {
      sizeBytes = 0
    }
    const entry = this.buildEntry(session, sizeBytes, 'failed', reason, null)
    await this.store.upsertRecordingEntry(entry)
    this.session = null
    this.status = { ...this.status, state: 'failed', entry, error: reason }
    this.emit()
    this.logger.warn('recording', `Recording aborted: ${reason}`, session.filePath)
    return true
  }

  private buildEntry(
    session: Session,
    sizeBytes: number,
    state: RecordingEntry['state'],
    error: string | null,
    verified: RecordingVerification | null,
    filePath?: string
  ): RecordingEntry {
    return {
      id: session.id,
      filePath: filePath ?? session.filePath,
      target: session.target,
      label: session.label,
      width: session.width,
      height: session.height,
      fps: session.fps,
      container: session.container,
      startedAt: session.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: session.durationMs,
      sizeBytes,
      state,
      error,
      verified
    }
  }

  /** Decodes the file with FFmpeg to prove it is playable, and reads back its metadata. */
  async verifyFile(filePath: string): Promise<RecordingVerification> {
    const ffmpegPath = this.getFfmpegPath()
    const base: RecordingVerification = {
      checked: false,
      decodable: false,
      container: path.extname(filePath).replace('.', '') || null,
      videoCodec: null,
      durationSeconds: null,
      frameCount: null,
      width: null,
      height: null,
      detail: 'Not verified: FFmpeg is unavailable.'
    }
    if (!ffmpegPath) return base

    try {
      const probe = await runProcess(ffmpegPath, ['-hide_banner', '-i', filePath], 30_000, true)
      const output = `${probe.stdout}\n${probe.stderr}`
      const duration = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(output)
      const video = /Stream #\d+:\d+.*Video:\s*([a-zA-Z0-9_]+)/.exec(output)
      const size = /,\s*(\d{2,5})x(\d{2,5})/.exec(output)
      const durationSeconds = duration
        ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
        : null

      // Decode every frame to the null muxer: this fails loudly on a truncated file.
      const decode = await runProcess(
        ffmpegPath,
        ['-hide_banner', '-v', 'error', '-i', filePath, '-f', 'null', '-'],
        180_000
      )
      const frames = /frame=\s*(\d+)/.exec(`${decode.stderr}\n${decode.stdout}`)

      return {
        checked: true,
        decodable: decode.code === 0,
        container: base.container,
        videoCodec: video ? video[1] : null,
        durationSeconds,
        frameCount: frames ? Number(frames[1]) : null,
        width: size ? Number(size[1]) : null,
        height: size ? Number(size[2]) : null,
        detail:
          decode.code === 0
            ? `Decoded successfully with FFmpeg (${video ? video[1] : 'unknown codec'}${
                durationSeconds !== null ? `, ${durationSeconds.toFixed(2)} s` : ''
              }).`
            : `FFmpeg could not decode the file (exit code ${decode.code}). ${decode.stderr.trim().split('\n').slice(-1)[0] ?? ''}`.trim()
      }
    } catch (error) {
      return { ...base, checked: true, detail: `Verification failed: ${String(error)}` }
    }
  }

  async verifyEntry(id: string): Promise<RecordingEntry> {
    const entries = this.store.recordingEntries()
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry) throw new AppError('E_NOT_FOUND', 'That recording is not in the history any more.')
    const verification = await this.verifyFile(entry.filePath)
    const updated: RecordingEntry = {
      ...entry,
      verified: verification,
      state: verification.decodable ? 'complete' : 'failed',
      error: verification.decodable ? null : `The recording could not be decoded: ${verification.detail}`
    }
    await this.store.upsertRecordingEntry(updated)
    return updated
  }

  /** Transcodes the captured WebM to H.264 MP4. */
  private async transcode(source: string, width: number, height: number): Promise<string | null> {
    const ffmpegPath = this.getFfmpegPath()
    if (!ffmpegPath) return null
    const supported = await hasEncoderImpl(ffmpegPath, 'libx264')
    if (!supported) {
      this.logger.warn('recording', 'This FFmpeg build has no libx264 encoder; MP4 output is unavailable.')
      return null
    }
    const target = source.replace(/\.(webm|mp4)$/i, '') + '.mp4'
    const args = [
      '-hide_banner',
      '-y',
      '-i',
      source,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      target
    ]
    this.logger.info('recording', `Transcoding to MP4 (${width}x${height}).`, target)
    const result = await runProcess(ffmpegPath, args, 1_800_000)
    if (result.code !== 0) {
      throw new AppError('E_ENCODER', `FFmpeg could not transcode the recording (exit code ${result.code}).`, {
        detail: result.stderr.slice(-1200)
      })
    }
    return target
  }

  getOutputDirectory(config: RecordingConfig): string {
    return config.outputDirectory ?? this.paths.recordings
  }
}

async function hasEncoderImpl(ffmpegPath: string, name: string): Promise<boolean> {
  try {
    const { stdout } = await runProcess(ffmpegPath, ['-hide_banner', '-encoders'], 15_000)
    return stdout.includes(name)
  } catch {
    return false
  }
}

interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  allowNonZero = false
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${path.basename(command)} timed out after ${timeoutMs} ms.`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !allowNonZero) {
        resolve({ code: code ?? -1, stdout, stderr })
        return
      }
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.closed) {
      resolve()
      return
    }
    stream.end(() => resolve())
  })
}

export function buildFileName(
  template: string,
  projectName: string,
  label: string,
  container: 'webm' | 'mp4'
): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const replacements: Record<string, string> = {
    '{project}': sanitise(projectName),
    '{target}': sanitise(label),
    '{date}': `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    '{time}': `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    '{timestamp}': String(now.getTime())
  }
  let name = template || 'CuePoint_{project}_{target}_{date}_{time}'
  for (const [token, value] of Object.entries(replacements)) {
    name = name.split(token).join(value)
  }
  name = sanitise(name)
  return `${name || `CuePoint_${Date.now()}`}.${container}`
}

function sanitise(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 120)
}

async function uniqueFilePath(directory: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  for (let index = 0; index < 500; index += 1) {
    const candidate = index === 0 ? fileName : `${base}_${index}${ext}`
    try {
      await access(path.join(directory, candidate), constants.F_OK)
    } catch {
      return candidate
    }
  }
  return `${base}_${Date.now()}${ext}`
}
