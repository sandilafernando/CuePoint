/** Undo entries retained per editing session. */
export const MAX_HISTORY = 120

/**
 * Consecutive history entries carrying the same coalesce key within this window are
 * merged, so a drag or a burst of typing becomes a single undo step.
 */
export const HISTORY_COALESCE_MS = 700

/** Debounce applied before the renderer pushes project changes to the main process. */
export const PROJECT_SYNC_DEBOUNCE_MS = 220

/** Interval for NDI statistics polling fallbacks and status bar refreshes. */
export const STATUS_REFRESH_MS = 1_000

/** Selection handle size in view pixels. */
export const HANDLE_SIZE_PX = 8

/** Default snap tolerance in view pixels when the project setting is unavailable. */
export const DEFAULT_SNAP_TOLERANCE_PX = 8

/** View-space wheel zoom step. */
export const WHEEL_ZOOM_STEP = 1.12

/** Nudge distances in millimetres for arrow-key movement. */
export const NUDGE_MM = 10
export const NUDGE_MM_LARGE = 100
export const NUDGE_MM_FINE = 1
