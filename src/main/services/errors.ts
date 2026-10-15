import type { IpcError, IpcErrorCode, IpcResult } from '@shared/appTypes'
import { getLogger } from './logger'

/**
 * Every failure that crosses the IPC boundary is normalised into an `IpcError`.
 * The renderer only ever receives a `{ ok: false, error }` envelope, never a raw throw,
 * because Electron only serialises `Error.message` and loses the rest.
 */
export class AppError extends Error {
  readonly code: IpcErrorCode
  readonly hint?: string
  readonly detail?: string

  constructor(code: IpcErrorCode, message: string, options: { hint?: string; detail?: string } = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    if (options.hint) this.hint = options.hint
    if (options.detail) this.detail = options.detail
  }
}

const FS_CODES: Record<string, { code: IpcErrorCode; hint: string }> = {
  EACCES: { code: 'E_PERMISSION', hint: 'Choose a folder you have write access to, then try again.' },
  EPERM: { code: 'E_PERMISSION', hint: 'Close any program using the file and try again.' },
  ENOSPC: { code: 'E_DISK_FULL', hint: 'Free up disk space and try again.' },
  ENOENT: { code: 'E_NOT_FOUND', hint: 'The file or folder no longer exists. Locate it again.' },
  EBUSY: { code: 'E_IO', hint: 'The file is in use by another program. Close it and retry.' },
  EISDIR: { code: 'E_IO', hint: 'A folder was supplied where a file was expected.' },
  ENOTDIR: { code: 'E_IO', hint: 'A file was supplied where a folder was expected.' },
  EEXIST: { code: 'E_IO', hint: 'A file with that name already exists.' },
  EMFILE: { code: 'E_IO', hint: 'Too many files are open. Restart CuePoint and try again.' }
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.detail ? { detail: error.detail } : {})
    }
  }

  const err = error as NodeJS.ErrnoException & { message?: string }
  const fsCode = err?.code && FS_CODES[err.code] ? FS_CODES[err.code] : null
  if (fsCode) {
    return {
      code: fsCode.code,
      message: friendlyFsMessage(err),
      hint: fsCode.hint,
      detail: `${err.code}: ${err.message ?? 'unknown'}`
    }
  }

  return {
    code: 'E_INTERNAL',
    message: err?.message ? String(err.message) : 'An unexpected internal error occurred.',
    hint: 'Try the action again. If it keeps failing, open Help → Troubleshooting and copy the diagnostic report.',
    detail: typeof error === 'object' && error !== null ? String((error as Error).stack ?? '') : String(error)
  }
}

function friendlyFsMessage(err: NodeJS.ErrnoException): string {
  const target = err.path ? ` "${err.path}"` : ''
  switch (err.code) {
    case 'EACCES':
    case 'EPERM':
      return `CuePoint does not have permission to write to${target}.`
    case 'ENOSPC':
      return `There is not enough free disk space to write${target}.`
    case 'ENOENT':
      return `The file or folder${target} could not be found.`
    case 'EBUSY':
      return `The file${target} is in use by another program.`
    default:
      return `A file system error occurred while accessing${target}.`
  }
}

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

/** Wraps a handler so it can never reject across the IPC boundary. */
export async function guard<T>(
  scope: string,
  fn: () => Promise<T> | T
): Promise<IpcResult<T>> {
  try {
    return ok(await fn())
  } catch (error) {
    const ipcError = toIpcError(error)
    const logger = getLogger()
    if (ipcError.code === 'E_INTERNAL') {
      logger.error(scope, ipcError.message, ipcError.detail)
    } else {
      logger.warn(scope, `${ipcError.code}: ${ipcError.message}`, ipcError.detail)
    }
    return { ok: false, error: ipcError }
  }
}

export function assert(condition: unknown, message: string, code: IpcErrorCode = 'E_INVALID_INPUT'): asserts condition {
  if (!condition) throw new AppError(code, message)
}

export function requireString(value: unknown, label: string, maxLength = 4096): string {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} is required.`)
  const trimmed = (value as string).trim()
  assert(trimmed.length <= maxLength, `${label} must be ${maxLength} characters or fewer.`)
  return trimmed
}

export function requireNumber(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} must be a number.`)
  const num = value as number
  if (options.integer) {
    assert(Number.isInteger(num), `${label} must be a whole number.`)
  }
  if (options.min !== undefined) assert(num >= options.min, `${label} must be at least ${options.min}.`)
  if (options.max !== undefined) assert(num <= options.max, `${label} must be ${options.max} or less.`)
  return num
}
