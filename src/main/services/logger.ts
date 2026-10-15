import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { LogEntry } from '@shared/appTypes'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

export interface LoggerOptions {
  directory: string
  level?: LogLevel
  /** Number of daily log files to keep. */
  keepFiles?: number
  /** In-memory entries used by the Diagnostics dashboard. */
  ringSize?: number
  fileName?: string
}

/**
 * Structured logger.
 *
 * Writes one line per entry to a daily file and keeps a bounded in-memory ring so the
 * Diagnostics dashboard and "Copy diagnostic report" never need to parse log files.
 * Never logs secrets, tokens or full file contents.
 */
export class Logger {
  private directory: string
  private level: LogLevel
  private keepFiles: number
  private ring: LogEntry[] = []
  private ringSize: number
  private fileName: string
  private ready: Promise<void>
  private queue: string[] = []
  private flushing = false
  private failed = false

  constructor(options: LoggerOptions) {
    this.directory = options.directory
    this.level = options.level ?? 'info'
    this.keepFiles = options.keepFiles ?? 10
    this.ringSize = options.ringSize ?? 500
    this.fileName = options.fileName ?? `cuepoint-${new Date().toISOString().slice(0, 10)}.log`
    this.ready = mkdir(this.directory, { recursive: true }).then(() => undefined)
  }

  get logFilePath(): string {
    return path.join(this.directory, this.fileName)
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  getLevel(): LogLevel {
    return this.level
  }

  log(level: LogLevel, scope: string, message: string, detail?: string): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(detail ? { detail } : {})
    }
    this.ring.push(entry)
    if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize)

    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level]) return

    const line = `${entry.ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${
      detail ? ` | ${detail.replace(/\s+/g, ' ').slice(0, 2000)}` : ''
    }\n`
    this.queue.push(line)
    void this.flush()

    if (level === 'error') console.error(line.trimEnd())
    else if (level === 'warn') console.warn(line.trimEnd())
    else if (this.level === 'debug') console.log(line.trimEnd())
  }

  error(scope: string, message: string, detail?: string): void {
    this.log('error', scope, message, detail)
  }

  warn(scope: string, message: string, detail?: string): void {
    this.log('warn', scope, message, detail)
  }

  info(scope: string, message: string, detail?: string): void {
    this.log('info', scope, message, detail)
  }

  debug(scope: string, message: string, detail?: string): void {
    this.log('debug', scope, message, detail)
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.failed || this.queue.length === 0) return
    this.flushing = true
    try {
      await this.ready
      const payload = this.queue.join('')
      this.queue = []
      await appendFile(this.logFilePath, payload, 'utf8')
    } catch {
      // Logging must never take the application down; drop the batch quietly.
      this.failed = true
      this.queue = []
    } finally {
      this.flushing = false
    }
  }

  recent(limit = 200, level?: LogLevel, scope?: string): LogEntry[] {
    let entries = this.ring
    if (level) entries = entries.filter((entry) => entry.level === level)
    if (scope) entries = entries.filter((entry) => entry.scope === scope)
    return entries.slice(-limit)
  }

  counts(): { errors: number; warnings: number } {
    return {
      errors: this.ring.filter((e) => e.level === 'error').length,
      warnings: this.ring.filter((e) => e.level === 'warn').length
    }
  }

  /** Trims old log files so the folder does not grow without bound. */
  async rotate(): Promise<void> {
    try {
      const files = (await readdir(this.directory))
        .filter((name) => name.startsWith('cuepoint-') && name.endsWith('.log'))
        .sort()
      const excess = files.length - this.keepFiles
      for (let i = 0; i < excess; i += 1) {
        await unlink(path.join(this.directory, files[i])).catch(() => undefined)
      }
    } catch {
      // Rotation is best-effort.
    }
  }

  async flushNow(): Promise<void> {
    while (this.queue.length > 0) {
      await this.flush()
    }
  }
}

let instance: Logger | null = null

export function createLogger(options: LoggerOptions): Logger {
  instance = new Logger(options)
  return instance
}

export function getLogger(): Logger {
  if (!instance) {
    instance = new Logger({ directory: path.join(process.cwd(), 'logs') })
  }
  return instance
}

export async function directorySizeBytes(target: string): Promise<number> {
  try {
    const info = await stat(target)
    return info.size
  } catch {
    return 0
  }
}
