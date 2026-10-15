/**
 * CuePoint project domain model.
 *
 * Canonical rules encoded by this model:
 *  - All physical geometry is stored in millimetres (`*Mm`), regardless of the
 *    unit the operator is currently working in. Unit conversion is a display concern.
 *  - Pixel geometry (`pixelWidth` / `pixelHeight`) is completely independent from
 *    physical geometry. Nothing in this model derives one from the other.
 *  - Canvas zoom/pan live in the view model (`CanvasView`), never in `Screen`.
 *  - Mapping regions are stored in *output pixel* coordinates, not stage coordinates.
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'

export type BackgroundFit = 'contain' | 'cover' | 'stretch' | 'none'

export type ScreenType = 'led' | 'projection' | 'lcd' | 'custom'

export type ScreenKind = ScreenType

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Stage background image transform, stored in stage millimetres. */
export interface BackgroundConfig {
  /** Absolute path or project-relative path. `null` when no image is loaded. */
  assetPath: string | null
  /** True when the referenced file could not be found at load time. */
  assetMissing: boolean
  visible: boolean
  /** 0..1 */
  opacity: number
  fit: BackgroundFit
  offsetXMm: number
  offsetYMm: number
  /** Multiplier applied on top of the fit scale. */
  scale: number
  rotationDeg: number
  locked: boolean
  /** Intrinsic pixel size of the source image, if known. */
  sourceWidth: number | null
  sourceHeight: number | null
}

export interface StageConfig {
  name: string
  widthMm: number
  heightMm: number
  /** Logical canvas resolution. 40 => 40 canvas px per metre. Presentation only. */
  canvasPxPerMeter: number
  defaultUnit: LengthUnit
  gridVisible: boolean
  gridSpacingMm: number
  gridMajorEvery: number
  gridSubdivisions: number
  snapToGrid: boolean
  snapToScreens: boolean
  snapToStage: boolean
  snapTolerancePx: number
  guidesVisible: boolean
  rulersVisible: boolean
  background: BackgroundConfig
}

/** Mapping of one screen into an output's pixel space. */
export interface ScreenMapping {
  /** Target `OutputDevice.id`, or null when unassigned. */
  outputId: string | null
  /** Region inside the output, in output pixels. */
  region: Rect
  /** When true the region tracks the screen's native pixel dimensions. */
  autoRegion: boolean
  exportVisible: boolean
  scale: number
  offsetXPx: number
  offsetYPx: number
  notes: string
}

export interface Screen {
  id: string
  name: string
  type: ScreenType
  /** Display colour used on the stage canvas, mapping map and exports. */
  color: string
  visible: boolean
  locked: boolean
  notes: string
  order: number
  groupId: string | null

  // --- Physical geometry (millimetres) ---
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** Rotation about the screen's own centre, clockwise positive. */
  rotationDeg: number

  // --- Native pixel geometry ---
  pixelWidth: number
  pixelHeight: number
  /** Optional LED pitch in millimetres; enables pixel-density reporting. */
  pixelPitchMm: number | null

  // --- Mapping ---
  mapping: ScreenMapping
}

export interface ScreenGroup {
  id: string
  name: string
  color: string
  visible: boolean
  locked: boolean
  collapsed: boolean
}

export interface OutputDevice {
  id: string
  name: string
  /** Output resolution in pixels. */
  width: number
  height: number
  enabled: boolean
  notes: string
}

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  author: string
  notes: string
}

export interface ProjectSettings {
  autosaveEnabled: boolean
  autosaveIntervalMs: number
  /** Number of recovery snapshots to retain. */
  backupRetention: number
  exportDirectory: string | null
}

export interface Project {
  schemaVersion: number
  meta: ProjectMeta
  stage: StageConfig
  screens: Screen[]
  groups: ScreenGroup[]
  outputs: OutputDevice[]
  settings: ProjectSettings
}

/** Lightweight project row used by Home / recent projects. */
export interface ProjectSummary {
  path: string
  id: string
  name: string
  author: string
  createdAt: string
  updatedAt: string
  screenCount: number
  outputCount: number
  stageWidthMm: number
  stageHeightMm: number
  schemaVersion: number
  sizeBytes: number
  exists: boolean
  missingAssets: number
}

export interface SelectionState {
  screenIds: string[]
}

/** Canvas presentation transform. Never persisted into `Screen` geometry. */
export interface CanvasView {
  /** Multiplier on top of `stage.canvasPxPerMeter`. */
  zoom: number
  panX: number
  panY: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** Property draft used by the inspector while a field is being edited. */
export interface ScreenDraft {
  name: string
  type: ScreenType
  color: string
  visible: boolean
  locked: boolean
  notes: string
  groupId: string | null
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  rotationDeg: number
  pixelWidth: number
  pixelHeight: number
  pixelPitchMm: number | null
}
