import type { IpcError, IpcResult } from '@shared/appTypes'

/**
 * Renderer-side access to the preload bridge.
 *
 * `unwrap` converts the `IpcResult` envelope into either a value or a thrown
 * `CuePointError`, so call sites can use ordinary try/catch while the message that
 * reaches the operator keeps the main process's code and hint.
 */

export class CuePointError extends Error {
  readonly code: IpcError['code']
  readonly hint?: string
  readonly detail?: string

  constructor(error: IpcError) {
    super(error.message)
    this.name = 'CuePointError'
    this.code = error.code
    this.hint = error.hint
    this.detail = error.detail
  }

  /** Operator-facing sentence combining the message and the suggested next step. */
  get advice(): string {
    return this.hint ? `${this.message} ${this.hint}` : this.message
  }
}

export interface CuePointBridge {
  app: Record<string, unknown>
  project: Record<string, unknown>
  stage: Record<string, unknown>
  export: Record<string, unknown>
  ndi: Record<string, unknown>
  recording: Record<string, unknown>
  diagnostics: Record<string, unknown>
  docs: Record<string, unknown>
}

declare global {
  interface Window {
    cuepoint?: import('@shared/ipc').CuePointApi
  }
}

export function bridge(): import('@shared/ipc').CuePointApi {
  const api = window.cuepoint
  if (!api) {
    throw new CuePointError({
      code: 'E_INTERNAL',
      message: 'The CuePoint bridge is unavailable. The preload script did not load.',
      hint: 'Restart CuePoint. If the problem continues, reinstall the application.'
    })
  }
  return api
}

export function hasBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.cuepoint)
}

export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call
  if (!result) {
    throw new CuePointError({
      code: 'E_INTERNAL',
      message: 'CuePoint received an empty response from the application core.',
      hint: 'Try the action again.'
    })
  }
  if (result.ok) return result.data
  throw new CuePointError(result.error)
}

/** Runs an IPC call and reports failures to the console without throwing. */
export async function tryUnwrap<T>(
  call: Promise<IpcResult<T>>,
  onError: (error: CuePointError) => void
): Promise<T | null> {
  try {
    return await unwrap(call)
  } catch (error) {
    const cueError =
      error instanceof CuePointError
        ? error
        : new CuePointError({ code: 'E_INTERNAL', message: String(error) })
    onError(cueError)
    return null
  }
}

export function describeError(error: unknown): { message: string; detail?: string } {
  if (error instanceof CuePointError) {
    return { message: error.advice, detail: error.detail }
  }
  if (error instanceof Error) return { message: error.message }
  return { message: String(error) }
}
