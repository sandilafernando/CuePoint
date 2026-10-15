import type {
  BackgroundConfig,
  OutputDevice,
  Project,
  ProjectMeta,
  ProjectSummary,
  Rect,
  Screen,
  ScreenDraft,
  StageConfig,
  LengthUnit
} from './types'
import { normalizeDegrees, rectBottom, rectRight, rotatedBounds, unionRects } from './geometry'
import { clamp } from './units'

/** Current persisted project schema. Bump when the on-disk shape changes. */
export const SCHEMA_VERSION = 2

export const DEFAULT_CANVAS_PX_PER_METER = 40

export const SCREEN_COLORS = [
  '#4c8dff',
  '#39c6a4',
  '#f0a83c',
  '#e2647a',
  '#a97bff',
  '#3fb8d8',
  '#c6d84d',
  '#ff8f4d'
] as const

export function newId(prefix: string): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${uuid.replace(/-/g, '').slice(0, 24)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createDefaultBackground(): BackgroundConfig {
  return {
    assetPath: null,
    assetMissing: false,
    visible: true,
    opacity: 0.65,
    fit: 'contain',
    offsetXMm: 0,
    offsetYMm: 0,
    scale: 1,
    rotationDeg: 0,
    locked: false,
    sourceWidth: null,
    sourceHeight: null
  }
}

export function createDefaultStage(overrides: Partial<StageConfig> = {}): StageConfig {
  return {
    name: 'Main Stage',
    widthMm: 12_000,
    heightMm: 6_000,
    canvasPxPerMeter: DEFAULT_CANVAS_PX_PER_METER,
    defaultUnit: 'm',
    gridVisible: true,
    gridSpacingMm: 500,
    gridMajorEvery: 4,
    gridSubdivisions: 4,
    snapToGrid: true,
    snapToScreens: true,
    snapToStage: true,
    snapTolerancePx: 8,
    guidesVisible: true,
    rulersVisible: true,
    background: createDefaultBackground(),
    ...overrides
  }
}

export function createDefaultOutput(overrides: Partial<OutputDevice> = {}): OutputDevice {
  return {
    id: newId('out'),
    name: 'Output 1',
    width: 1920,
    height: 1080,
    enabled: true,
    notes: '',
    ...overrides
  }
}

export interface NewScreenOptions {
  name?: string
  widthMm?: number
  heightMm?: number
  pixelWidth?: number
  pixelHeight?: number
  pixelPitchMm?: number | null
  xMm?: number
  yMm?: number
  colorIndex?: number
  type?: Screen['type']
  id?: string
}

export function createScreen(options: NewScreenOptions = {}): Screen {
  const widthMm = options.widthMm ?? 2_000
  const heightMm = options.heightMm ?? 1_000
  const pixelPitchMm =
    options.pixelPitchMm === undefined ? 2.5 : options.pixelPitchMm
  const pixelWidth = options.pixelWidth ?? Math.round(widthMm / (pixelPitchMm ?? 2.5))
  const pixelHeight = options.pixelHeight ?? Math.round(heightMm / (pixelPitchMm ?? 2.5))
  const id = options.id ?? newId('scr')
  const color = SCREEN_COLORS[(options.colorIndex ?? 0) % SCREEN_COLORS.length]

  return {
    id,
    name: options.name ?? 'Screen 1',
    type: options.type ?? 'led',
    color,
    visible: true,
    locked: false,
    notes: '',
    order: 0,
    groupId: null,
    xMm: options.xMm ?? 0,
    yMm: options.yMm ?? 0,
    widthMm,
    heightMm,
    rotationDeg: 0,
    pixelWidth,
    pixelHeight,
    pixelPitchMm,
    mapping: {
      outputId: null,
      region: { x: 0, y: 0, width: pixelWidth, height: pixelHeight },
      autoRegion: true,
      exportVisible: true,
      scale: 1,
      offsetXPx: 0,
      offsetYPx: 0,
      notes: ''
    }
  }
}

export function createDefaultProjectMeta(name: string, author = ''): ProjectMeta {
  const ts = nowIso()
  return {
    id: newId('prj'),
    name: name.trim() || 'Untitled Project',
    createdAt: ts,
    updatedAt: ts,
    author,
    notes: ''
  }
}

export interface NewProjectOptions {
  name: string
  author?: string
  stageWidthMm?: number
  stageHeightMm?: number
  defaultUnit?: LengthUnit
  backgroundAssetPath?: string | null
  initialScreenCount?: number
  outputs?: OutputDevice[]
}

export function createDefaultProject(options: NewProjectOptions): Project {
  const stage = createDefaultStage({
    widthMm: options.stageWidthMm ?? 12_000,
    heightMm: options.stageHeightMm ?? 6_000,
    ...(options.defaultUnit ? { defaultUnit: options.defaultUnit } : {})
  })
  if (options.backgroundAssetPath) {
    stage.background.assetPath = options.backgroundAssetPath
  }

  const outputs = options.outputs?.length ? options.outputs : [createDefaultOutput()]

  const screenCount = clamp(options.initialScreenCount ?? 0, 0, 12)
  const screens: Screen[] = []
  for (let i = 0; i < screenCount; i += 1) {
    const screen = createScreen({
      name: `Screen ${i + 1}`,
      colorIndex: i,
      pixelPitchMm: 2.5
    })
    const placement = nextScreenPosition(stage, screens, screen)
    screen.xMm = placement.x
    screen.yMm = placement.y
    screen.order = i
    screen.mapping.outputId = outputs[0].id
    screens.push(screen)
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: createDefaultProjectMeta(options.name, options.author ?? ''),
    stage,
    screens,
    groups: [],
    outputs,
    settings: {
      autosaveEnabled: true,
      autosaveIntervalMs: 30_000,
      backupRetention: 10,
      exportDirectory: null
    }
  }
}

/**
 * Finds a free-ish spot for a new screen: scans left to right along the stage,
 * wrapping to a new row below the current content when the row is full.
 */
export function nextScreenPosition(
  stage: StageConfig,
  existing: readonly Screen[],
  candidate: { widthMm: number; heightMm: number }
): { x: number; y: number } {
  const gap = Math.max(100, stage.gridSpacingMm)
  const maxX = Math.max(stage.widthMm - candidate.widthMm, 0)
  const maxY = Math.max(stage.heightMm - candidate.heightMm, 0)

  const occupied = existing.map((s) => rotatedBounds({ x: s.xMm, y: s.yMm, width: s.widthMm, height: s.heightMm }, s.rotationDeg))
  const startY = Math.min(gap, maxY)
  const rows = Math.max(1, Math.floor((maxY - startY) / Math.max(candidate.heightMm + gap, 1)) + 1)

  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(startY + row * (candidate.heightMm + gap), maxY)
    let x = Math.min(gap, maxX)
    let guard = 0
    while (x <= maxX && guard < 200) {
      guard += 1
      const probe = { x, y, width: candidate.widthMm, height: candidate.heightMm }
      const clash = occupied.some(
        (o) =>
          probe.x < rectRight(o) + gap * 0.25 &&
          rectRight(probe) + gap * 0.25 > o.x &&
          probe.y < rectBottom(o) + gap * 0.25 &&
          rectBottom(probe) + gap * 0.25 > o.y
      )
      if (!clash) return { x, y }
      const next = occupied
        .filter((o) => probe.y < rectBottom(o) + gap * 0.25 && rectBottom(probe) + gap * 0.25 > o.y)
        .map((o) => rectRight(o))
      x = Math.min(Math.max(...(next.length ? next : [x])) + gap, maxX + gap)
    }
  }

  // Stage full: stagger the new screen slightly so it is still visible and selectable.
  const last = existing[existing.length - 1]
  return {
    x: clamp((last?.xMm ?? 0) + 200, 0, Math.max(stage.widthMm - candidate.widthMm, 0)),
    y: clamp((last?.yMm ?? 0) + 200, 0, Math.max(stage.heightMm - candidate.heightMm, 0))
  }
}

/** Deep clone of a screen with a brand new identifier, so duplicates never share state. */
export function cloneScreenWithNewId(screen: Screen, overrides: Partial<Screen> = {}): Screen {
  const copy: Screen = {
    ...screen,
    id: newId('scr'),
    name: `${screen.name} copy`,
    mapping: { ...screen.mapping, region: { ...screen.mapping.region } },
    ...overrides
  }
  return copy
}

export function cloneOutputWithNewId(output: OutputDevice, name?: string): OutputDevice {
  return { ...output, id: newId('out'), name: name ?? `${output.name} copy` }
}

export function screenGeometryRect(screen: Screen): Rect {
  return { x: screen.xMm, y: screen.yMm, width: screen.widthMm, height: screen.heightMm }
}

export function screensBounds(screens: readonly Screen[]): Rect | null {
  return unionRects(screens.map((s) => rotatedBounds(screenGeometryRect(s), s.rotationDeg)))
}

export function screenDraftFromScreen(screen: Screen): ScreenDraft {
  return {
    name: screen.name,
    type: screen.type,
    color: screen.color,
    visible: screen.visible,
    locked: screen.locked,
    notes: screen.notes,
    groupId: screen.groupId,
    xMm: screen.xMm,
    yMm: screen.yMm,
    widthMm: screen.widthMm,
    heightMm: screen.heightMm,
    rotationDeg: screen.rotationDeg,
    pixelWidth: screen.pixelWidth,
    pixelHeight: screen.pixelHeight,
    pixelPitchMm: screen.pixelPitchMm
  }
}

/**
 * Applies an inspector draft to a screen without touching mapping or identity.
 * Only fields present in the draft are written, which keeps unrelated state intact.
 */
export function applyDraftToScreen(screen: Screen, draft: ScreenDraft): Screen {
  return {
    ...screen,
    name: draft.name,
    type: draft.type,
    color: draft.color,
    visible: draft.visible,
    locked: draft.locked,
    notes: draft.notes,
    groupId: draft.groupId,
    xMm: draft.xMm,
    yMm: draft.yMm,
    widthMm: draft.widthMm,
    heightMm: draft.heightMm,
    rotationDeg: normalizeDegrees(draft.rotationDeg),
    pixelWidth: draft.pixelWidth,
    pixelHeight: draft.pixelHeight,
    pixelPitchMm: draft.pixelPitchMm
  }
}

export function cloneProject(project: Project, name?: string): Project {
  const copy = structuredClone(project)
  copy.meta.id = newId('prj')
  copy.meta.name = name ?? `${project.meta.name} copy`
  copy.meta.createdAt = nowIso()
  copy.meta.updatedAt = copy.meta.createdAt
  for (const screen of copy.screens) screen.id = newId('scr')
  for (const output of copy.outputs) output.id = newId('out')
  for (const group of copy.groups) group.id = newId('grp')
  return copy
}

export function projectSummary(project: Project, path: string, sizeBytes = 0): ProjectSummary {
  return {
    path,
    id: project.meta.id,
    name: project.meta.name,
    author: project.meta.author,
    createdAt: project.meta.createdAt,
    updatedAt: project.meta.updatedAt,
    screenCount: project.screens.length,
    outputCount: project.outputs.length,
    stageWidthMm: project.stage.widthMm,
    stageHeightMm: project.stage.heightMm,
    schemaVersion: project.schemaVersion,
    sizeBytes,
    exists: true,
    missingAssets: project.stage.background.assetMissing ? 1 : 0
  }
}

// ---------------------------------------------------------------------------
// Migration & normalisation
// ---------------------------------------------------------------------------

/** Screen fields added in schema v1 (metres and `nativeWidth`), kept for migration. */
interface LegacyScreenV1 {
  xM?: number
  yM?: number
  widthM?: number
  heightM?: number
  nativeWidth?: number
  nativeHeight?: number
}

/**
 * Loose shape accepted by the migration path.
 *
 * v1 stored physical sizes in metres under `widthM`/`heightM` and pixel sizes as
 * `nativeWidth`/`nativeHeight`; v2 uses millimetres and `pixelWidth`/`pixelHeight`.
 */
interface RawProjectShape extends Partial<Omit<Project, 'stage' | 'screens' | 'meta'>> {
  meta?: Partial<ProjectMeta>
  stage?: Partial<StageConfig> & { widthM?: number; heightM?: number }
  screens?: (Partial<Screen> & LegacyScreenV1)[]
}

export interface MigrationOutcome {
  project: Project
  migrations: string[]
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Normalises any persisted project payload into the current schema.
 *
 * Unknown or malformed values fall back to safe defaults instead of throwing, so a
 * partially corrupted project can still be opened and repaired by the operator.
 */
export function migrateProject(raw: unknown): MigrationOutcome {
  const migrations: string[] = []
  if (!raw || typeof raw !== 'object') {
    throw new Error('Project file is not a JSON object.')
  }
  const candidate = raw as RawProjectShape
  const version = finite(candidate.schemaVersion, 1)

  let source: Partial<Project> = candidate as Partial<Project>

  if (version < 2) {
    migrations.push(
      `Migrated project from schema v${version} to v${SCHEMA_VERSION} (metres -> millimetres, nativeWidth -> pixelWidth, mapping initialised).`
    )
    const legacyStage: Partial<StageConfig> & { widthM?: number; heightM?: number } =
      candidate.stage ?? {}
    const legacyScreens: (Partial<Screen> & LegacyScreenV1)[] = candidate.screens ?? []
    const screens: Screen[] = legacyScreens.map((legacy, index) => {
      const widthMm = finite(legacy.widthM, 2) * 1000
      const heightMm = finite(legacy.heightM, 1) * 1000
      const pixelWidth = Math.max(1, Math.round(finite(legacy.nativeWidth, widthMm / 2.5)))
      const pixelHeight = Math.max(1, Math.round(finite(legacy.nativeHeight, heightMm / 2.5)))
      const screen = createScreen({
        id: legacy.id ?? newId('scr'),
        name: legacy.name ?? `Screen ${index + 1}`,
        widthMm,
        heightMm,
        pixelWidth,
        pixelHeight,
        xMm: finite(legacy.xM, 0) * 1000,
        yMm: finite(legacy.yM, 0) * 1000,
        colorIndex: index,
        pixelPitchMm: null
      })
      screen.rotationDeg = normalizeDegrees(finite(legacy.rotationDeg, 0))
      screen.color = typeof legacy.color === 'string' ? legacy.color : screen.color
      screen.visible = legacy.visible !== false
      screen.locked = legacy.locked === true
      screen.notes = typeof legacy.notes === 'string' ? legacy.notes : ''
      screen.order = index
      return screen
    })

    source = {
      schemaVersion: SCHEMA_VERSION,
      meta: candidate.meta as ProjectMeta,
      stage: createDefaultStage({
        name: legacyStage.name ?? 'Main Stage',
        widthMm: finite(legacyStage.widthM, 12) * 1000,
        heightMm: finite(legacyStage.heightM, 6) * 1000,
        canvasPxPerMeter: finite(
          legacyStage.canvasPxPerMeter,
          DEFAULT_CANVAS_PX_PER_METER
        ),
        background: {
          ...createDefaultBackground(),
          ...(legacyStage.background ?? {})
        }
      }),
      screens,
      groups: [],
      outputs: [createDefaultOutput()],
      settings: {
        autosaveEnabled: true,
        autosaveIntervalMs: 30_000,
        backupRetention: 10,
        exportDirectory: null
      }
    }
  }

  const stage = createDefaultStage(source.stage ?? {})
  stage.background = { ...createDefaultBackground(), ...(source.stage?.background ?? {}) }
  stage.widthMm = finite(stage.widthMm, 12_000)
  stage.heightMm = finite(stage.heightMm, 6_000)
  stage.canvasPxPerMeter = finite(stage.canvasPxPerMeter, DEFAULT_CANVAS_PX_PER_METER)

  const outputs = (source.outputs ?? []).map((o) => ({
    id: o.id ?? newId('out'),
    name: o.name ?? 'Output',
    width: Math.round(finite(o.width, 1920)),
    height: Math.round(finite(o.height, 1080)),
    enabled: o.enabled !== false,
    notes: o.notes ?? ''
  }))
  if (outputs.length === 0) outputs.push(createDefaultOutput())

  const screens = (source.screens ?? []).map((raw, index) => {
    const pixelWidth = Math.max(1, Math.round(finite(raw.pixelWidth, 800)))
    const pixelHeight = Math.max(1, Math.round(finite(raw.pixelHeight, 400)))
    const mapping = raw.mapping ?? {
      outputId: null,
      region: { x: 0, y: 0, width: pixelWidth, height: pixelHeight },
      autoRegion: true,
      exportVisible: true,
      scale: 1,
      offsetXPx: 0,
      offsetYPx: 0,
      notes: ''
    }
    return {
      id: raw.id ?? newId('scr'),
      name: raw.name ?? `Screen ${index + 1}`,
      type: raw.type ?? 'led',
      color: raw.color ?? SCREEN_COLORS[index % SCREEN_COLORS.length],
      visible: raw.visible !== false,
      locked: raw.locked === true,
      notes: raw.notes ?? '',
      order: finite(raw.order, index),
      groupId: raw.groupId ?? null,
      xMm: finite(raw.xMm, 0),
      yMm: finite(raw.yMm, 0),
      widthMm: finite(raw.widthMm, 2000),
      heightMm: finite(raw.heightMm, 1000),
      rotationDeg: normalizeDegrees(finite(raw.rotationDeg, 0)),
      pixelWidth,
      pixelHeight,
      pixelPitchMm:
        typeof raw.pixelPitchMm === 'number' && Number.isFinite(raw.pixelPitchMm)
          ? raw.pixelPitchMm
          : null,
      mapping: {
        outputId: mapping.outputId ?? null,
        region: {
          x: finite(mapping.region?.x, 0),
          y: finite(mapping.region?.y, 0),
          width: Math.max(1, Math.round(finite(mapping.region?.width, pixelWidth))),
          height: Math.max(1, Math.round(finite(mapping.region?.height, pixelHeight)))
        },
        autoRegion: mapping.autoRegion !== false,
        exportVisible: mapping.exportVisible !== false,
        scale: finite(mapping.scale, 1),
        offsetXPx: finite(mapping.offsetXPx, 0),
        offsetYPx: finite(mapping.offsetYPx, 0),
        notes: mapping.notes ?? ''
      }
    } satisfies Screen
  })

  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: source.meta?.id ?? newId('prj'),
      name: source.meta?.name ?? 'Untitled Project',
      createdAt: source.meta?.createdAt ?? nowIso(),
      updatedAt: source.meta?.updatedAt ?? nowIso(),
      author: source.meta?.author ?? '',
      notes: source.meta?.notes ?? ''
    },
    stage,
    screens,
    groups: source.groups ?? [],
    outputs,
    settings: {
      autosaveEnabled: source.settings?.autosaveEnabled !== false,
      autosaveIntervalMs: finite(source.settings?.autosaveIntervalMs, 30_000),
      backupRetention: finite(source.settings?.backupRetention, 10),
      exportDirectory: source.settings?.exportDirectory ?? null
    }
  }

  return { project, migrations }
}
