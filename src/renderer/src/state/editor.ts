import type {
  CanvasView,
  OutputDevice,
  Project,
  Rect,
  Screen,
  ScreenDraft,
  StageConfig,
  BackgroundConfig,
  LengthUnit
} from '@shared/types'
import {
  alignRects,
  cloneRect,
  distributeRects,
  normalizeDegrees,
  rotatedBounds,
  unionRects,
  type AlignMode,
  type SnapCandidate
} from '@shared/geometry'
import { clamp } from '@shared/units'
import { applyDraftToScreen, cloneScreenWithNewId, screenGeometryRect, createScreen, newId } from '@shared/project'
import { autoArrangeRegions, defaultRegionFor, effectiveRegion } from '@shared/mapping'
import { MAX_HISTORY, HISTORY_COALESCE_MS } from '@shared/constants'

/**
 * Editor state and the pure reducer behind it.
 *
 * Keeping every mutation in a pure reducer is what makes the Stage Designer testable
 * without a DOM: the same functions back the UI, the exporter inputs and the unit tests.
 *
 * Undo grouping: actions may carry a `coalesce` key. Consecutive actions with the same
 * key inside HISTORY_COALESCE_MS replace the previous history entry, so a drag or a
 * burst of typing produces one undo step instead of hundreds.
 */

export interface HistoryEntry {
  label: string
  project: Project
  selection: string[]
  at: number
  coalesce?: string
}

export interface EditorState {
  project: Project | null
  path: string | null
  dirty: boolean
  savedAt: string | null
  autosaveAt: string | null
  selection: string[]
  hoveredId: string | null
  view: CanvasView
  guides: SnapCandidate[]
  past: HistoryEntry[]
  future: HistoryEntry[]
  clipboard: Screen[]
  backgroundDataUrl: string | null
  statusMessage: string
  /* Progress feedback while a long operation runs. */
  busy: string | null
}

export const initialEditorState: EditorState = {
  project: null,
  path: null,
  dirty: false,
  savedAt: null,
  autosaveAt: null,
  selection: [],
  hoveredId: null,
  view: { zoom: 1, panX: 40, panY: 40 },
  guides: [],
  past: [],
  future: [],
  clipboard: [],
  backgroundDataUrl: null,
  statusMessage: 'Ready',
  busy: null
}

export function createEditorState(project: Project | null, path: string | null): EditorState {
  return {
    ...initialEditorState,
    project,
    path,
    past: [],
    future: []
  }
}

export function screenById(state: EditorState, id: string): Screen | undefined {
  return state.project?.screens.find((screen) => screen.id === id)
}

export function selectedScreens(state: EditorState): Screen[] {
  if (!state.project) return []
  const ids = new Set(state.selection)
  return state.project.screens.filter((screen) => ids.has(screen.id))
}

export function selectionBounds(state: EditorState): Rect | null {
  const screens = selectedScreens(state)
  if (screens.length === 0) return null
  return unionRects(screens.map((screen) => rotatedBounds(screenGeometryRect(screen), screen.rotationDeg)))
}

export function stageRect(state: EditorState): Rect {
  return {
    x: 0,
    y: 0,
    width: state.project?.stage.widthMm ?? 12_000,
    height: state.project?.stage.heightMm ?? 6_000
  }
}

/** Effective mapping region of a screen, in output pixel space. */
export function screenRegion(screen: Screen): Rect {
  return effectiveRegion(screen.mapping)
}

export function lockedScreens(state: EditorState): Set<string> {
  const locked = new Set<string>()
  for (const screen of state.project?.screens ?? []) {
    if (!screen.locked) continue
    // A screen is locked if it or its group is locked.
    const group = screen.groupId
      ? state.project?.groups.find((candidate) => candidate.id === screen.groupId)
      : undefined
    if (screen.locked || group?.locked) locked.add(screen.id)
  }
  return locked
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type EditorAction =
  | { type: 'load'; project: Project; path: string | null; backgroundDataUrl?: string | null }
  | { type: 'close' }
  | { type: 'markSaved'; path?: string | null; savedAt: string; autosaveAt?: string | null }
  | { type: 'markDirty'; dirty: boolean }
  | { type: 'setSavedState'; savedAt: string | null; autosaveAt: string | null; path: string | null }
  | { type: 'addScreens'; screens: Screen[]; label?: string }
  | { type: 'updateScreen'; id: string; patch: Partial<Screen>; label?: string; coalesce?: string }
  | { type: 'updateDraft'; id: string; draft: ScreenDraft; label?: string; coalesce?: string }
  | { type: 'updateScreens'; ids: string[]; patch: Partial<Screen>; label?: string; coalesce?: string }
  | { type: 'setGeometry'; changes: { id: string; geometry: Partial<Screen> }[]; label?: string; coalesce?: string }
  | { type: 'deleteScreens'; ids: string[] }
  | { type: 'duplicateScreens'; ids: string[] }
  | { type: 'select'; ids: string[] }
  | { type: 'toggleSelect'; id: string }
  | { type: 'setView'; view: Partial<CanvasView> }
  | { type: 'setGuides'; guides: SnapCandidate[] }
  | { type: 'setHovered'; id: string | null }
  | { type: 'copy'; ids: string[] }
  | { type: 'cut'; ids: string[] }
  | { type: 'paste' }
  | { type: 'align'; mode: AlignMode; reference?: Rect; toStage?: boolean }
  | { type: 'distribute'; axis: 'horizontal' | 'vertical' }
  | { type: 'matchSize'; axis: 'width' | 'height' | 'both' }
  | { type: 'centerOnStage'; axis: 'horizontal' | 'vertical' | 'both' }
  | { type: 'toggleLock'; ids: string[] }
  | { type: 'toggleVisible'; ids: string[] }
  | { type: 'toggleExportVisible'; ids: string[] }
  | { type: 'renameScreen'; id: string; name: string }
  | { type: 'reorderScreens'; ids: string[]; order: number[] }
  | { type: 'updateStage'; patch: Partial<StageConfig>; label?: string; coalesce?: string }
  | { type: 'updateBackground'; patch: Partial<BackgroundConfig>; label?: string; coalesce?: string }
  | { type: 'setBackgroundImage'; dataUrl: string | null; assetPath: string | null; width: number | null; height: number | null }
  | { type: 'updateProjectMeta'; patch: Partial<Project['meta']>; label?: string; coalesce?: string }
  | { type: 'updateProjectSettings'; patch: Partial<Project['settings']>; coalesce?: string }
  | { type: 'assignOutput'; ids: string[]; outputId: string | null }
  | { type: 'setRegion'; id: string; region: Rect; auto?: boolean; coalesce?: string }
  | { type: 'setMappingScale'; id: string; scale: number; coalesce?: string }
  | { type: 'autoArrange'; outputId: string }
  | { type: 'addOutput'; output?: Partial<OutputDevice> }
  | { type: 'updateOutput'; id: string; patch: Partial<OutputDevice>; coalesce?: string }
  | { type: 'deleteOutput'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'setStatus'; message: string }
  | { type: 'setBusy'; label: string | null }

interface MutateOptions {
  label: string
  coalesce?: string
  keepSelection?: boolean
}

/** Applies a project mutation, recording a history entry first. */
function mutate(
  state: EditorState,
  options: MutateOptions,
  recipe: (project: Project) => Project | void
): EditorState {
  if (!state.project) return state
  const before = structuredClone(state.project)
  const draft = structuredClone(state.project)
  const result = recipe(draft)
  const next = (result ?? draft) as Project

  const now = Date.now()
  const last = state.past[state.past.length - 1]
  const coalescedKey = options.coalesce
  const shouldCoalesce =
    Boolean(coalescedKey) &&
    last !== undefined &&
    last.coalesce === coalescedKey &&
    now - last.at < HISTORY_COALESCE_MS

  let past: HistoryEntry[]
  if (shouldCoalesce) {
    past = [...state.past.slice(0, -1), { ...last, at: now }]
  } else {
    past = [...state.past, { label: options.label, project: before, selection: state.selection, at: now, coalesce: coalescedKey }]
    if (past.length > MAX_HISTORY) past = past.slice(past.length - MAX_HISTORY)
  }

  const selection = options.keepSelection
    ? state.selection
    : state.selection.filter((id) => next.screens.some((screen) => screen.id === id))

  return {
    ...state,
    project: { ...next, meta: { ...next.meta, updatedAt: new Date().toISOString() } },
    selection,
    past,
    future: [],
    dirty: true,
    statusMessage: options.label
  }
}

function restore(state: EditorState, entry: HistoryEntry, direction: 'undo' | 'redo'): EditorState {
  const current: HistoryEntry = {
    label: entry.label,
    project: structuredClone(state.project!),
    selection: state.selection,
    at: Date.now()
  }
  return {
    ...state,
    project: entry.project,
    selection: entry.selection.filter((id) => entry.project.screens.some((screen) => screen.id === id)),
    past: direction === 'undo' ? state.past.slice(0, -1) : [...state.past, current],
    future: direction === 'undo' ? [...state.future, current] : state.future.slice(0, -1),
    dirty: true,
    statusMessage: direction === 'undo' ? `Undo: ${entry.label}` : `Redo: ${entry.label}`
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return {
        ...createEditorState(action.project, action.path),
        backgroundDataUrl: action.backgroundDataUrl ?? null,
        statusMessage: `Opened ${action.project.meta.name}`
      }

    case 'close':
      return { ...initialEditorState, statusMessage: 'No project open' }

    case 'markSaved':
      return {
        ...state,
        path: action.path !== undefined ? action.path : state.path,
        savedAt: action.savedAt,
        autosaveAt: action.autosaveAt !== undefined ? action.autosaveAt : state.autosaveAt,
        dirty: false,
        past: state.past,
        statusMessage: 'Saved'
      }

    case 'markDirty':
      return { ...state, dirty: action.dirty }

    case 'setSavedState':
      return { ...state, savedAt: action.savedAt, autosaveAt: action.autosaveAt, path: action.path }

    case 'addScreens': {
      if (action.screens.length === 0) return state
      const next = mutate(state, { label: action.label ?? 'Add screen' }, (project) => {
        const baseOrder = project.screens.length
        project.screens = [
          ...project.screens,
          ...action.screens.map((screen, index) => ({ ...screen, order: baseOrder + index }))
        ]
      })
      return { ...next, selection: action.screens.map((screen) => screen.id) }
    }

    case 'updateScreen':
      return mutate(
        state,
        { label: action.label ?? 'Edit screen', coalesce: action.coalesce },
        (project) => {
          const index = project.screens.findIndex((screen) => screen.id === action.id)
          if (index < 0) return
          project.screens[index] = { ...project.screens[index], ...action.patch }
        }
      )

    case 'updateDraft':
      return mutate(
        state,
        { label: action.label ?? 'Edit screen', coalesce: action.coalesce },
        (project) => {
          const index = project.screens.findIndex((screen) => screen.id === action.id)
          if (index < 0) return
          project.screens[index] = applyDraftToScreen(project.screens[index], action.draft)
        }
      )

    case 'updateScreens': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      return mutate(
        state,
        { label: action.label ?? 'Edit screens', coalesce: action.coalesce },
        (project) => {
          project.screens = project.screens.map((screen) =>
            ids.has(screen.id) ? { ...screen, ...action.patch } : screen
          )
        }
      )
    }

    case 'setGeometry': {
      if (action.changes.length === 0) return state
      return mutate(
        state,
        { label: action.label ?? 'Transform screens', coalesce: action.coalesce },
        (project) => {
          const map = new Map(action.changes.map((change) => [change.id, change.geometry]))
          project.screens = project.screens.map((screen) => {
            const geometry = map.get(screen.id)
            return geometry ? { ...screen, ...geometry } : screen
          })
        }
      )
    }

    case 'deleteScreens': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      const labels = state.project?.screens.filter((s) => ids.has(s.id)).map((s) => s.name) ?? []
      const next = mutate(state, { label: `Delete ${labels.length || ids.size} screen(s)` }, (project) => {
        project.screens = project.screens.filter((screen) => !ids.has(screen.id))
        project.screens.forEach((screen, index) => {
          screen.order = index
        })
      })
      return { ...next, selection: [] }
    }

    case 'duplicateScreens': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      const created: Screen[] = []
      const next = mutate(state, { label: 'Duplicate screen' }, (project) => {
        const sources = project.screens.filter((screen) => ids.has(screen.id))
        // Offsets are applied to the copy only, so the original is never touched.
        const offset = 200
        for (const source of sources) {
          const copy = cloneScreenWithNewId(source, {
            xMm: source.xMm + offset,
            yMm: source.yMm + offset,
            order: project.screens.length + created.length
          })
          created.push(copy)
          project.screens.push(copy)
        }
      })
      return { ...next, selection: created.map((screen) => screen.id) }
    }

    case 'select':
      return { ...state, selection: [...new Set(action.ids)] }

    case 'toggleSelect': {
      const has = state.selection.includes(action.id)
      return { ...state, selection: has ? state.selection.filter((id) => id !== action.id) : [...state.selection, action.id] }
    }

    case 'setView':
      return { ...state, view: { ...state.view, ...action.view } }

    case 'setGuides':
      return { ...state, guides: action.guides }

    case 'setHovered':
      return { ...state, hoveredId: action.id }

    case 'copy': {
      const ids = new Set(action.ids)
      const screens = state.project?.screens.filter((screen) => ids.has(screen.id)) ?? []
      return { ...state, clipboard: structuredClone(screens), statusMessage: `Copied ${screens.length} screen(s)` }
    }

    case 'cut': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      const screens = state.project?.screens.filter((screen) => ids.has(screen.id)) ?? []
      const next = mutate(state, { label: 'Cut screens' }, (project) => {
        project.screens = project.screens.filter((screen) => !ids.has(screen.id))
      })
      return { ...next, clipboard: structuredClone(screens), selection: [] }
    }

    case 'paste': {
      if (state.clipboard.length === 0) return state
      const created: Screen[] = []
      const next = mutate(state, { label: 'Paste screens' }, (project) => {
        for (const source of state.clipboard) {
          const copy = cloneScreenWithNewId(source, {
            xMm: source.xMm + 200,
            yMm: source.yMm + 200,
            order: project.screens.length + created.length
          })
          created.push(copy)
          project.screens.push(copy)
        }
      })
      return { ...next, selection: created.map((screen) => screen.id) }
    }

    case 'align': {
      const screens = state.project?.screens.filter((screen) => state.selection.includes(screen.id)) ?? []
      if (screens.length < (action.toStage || action.reference ? 1 : 2)) return state
      const reference = action.reference ?? (action.toStage ? stageRect(state) : undefined)
      const items = screens.map((screen) => ({ id: screen.id, rect: screenGeometryRect(screen) }))
      const aligned = alignRects(items, action.mode, reference)
      const changes = screens.map((screen) => {
        const rect = aligned.get(screen.id)
        return rect ? { id: screen.id, geometry: { xMm: rect.x, yMm: rect.y } } : null
      })
      return mutate(state, { label: `Align ${action.mode}` }, (project) => {
        for (const change of changes) {
          if (!change) continue
          const index = project.screens.findIndex((screen) => screen.id === change.id)
          if (index >= 0) project.screens[index] = { ...project.screens[index], ...change.geometry }
        }
      })
    }

    case 'distribute': {
      const screens = state.project?.screens.filter((screen) => state.selection.includes(screen.id)) ?? []
      if (screens.length < 3) return state
      const items = screens.map((screen) => ({ id: screen.id, rect: screenGeometryRect(screen) }))
      const distributed = distributeRects(items, action.axis)
      return mutate(state, { label: `Distribute ${action.axis}` }, (project) => {
        for (const [id, rect] of distributed) {
          const index = project.screens.findIndex((screen) => screen.id === id)
          if (index >= 0) project.screens[index] = { ...project.screens[index], xMm: rect.x, yMm: rect.y }
        }
      })
    }

    case 'matchSize': {
      const screens = state.project?.screens.filter((screen) => state.selection.includes(screen.id)) ?? []
      if (screens.length < 2) return state
      const reference = screens[0]
      return mutate(state, { label: 'Match size' }, (project) => {
        project.screens = project.screens.map((screen) => {
          if (!state.selection.includes(screen.id) || screen.id === reference.id) return screen
          return {
            ...screen,
            widthMm: action.axis === 'height' ? screen.widthMm : reference.widthMm,
            heightMm: action.axis === 'width' ? screen.heightMm : reference.heightMm
          }
        })
      })
    }

    case 'centerOnStage': {
      const screens = state.project?.screens.filter((screen) => state.selection.includes(screen.id)) ?? []
      if (screens.length === 0) return state
      const stage = stageRect(state)
      return mutate(state, { label: 'Centre on stage' }, (project) => {
        for (const screen of screens) {
          const index = project.screens.findIndex((candidate) => candidate.id === screen.id)
          if (index < 0) continue
          const bounds = rotatedBounds(screenGeometryRect(screen), screen.rotationDeg)
          const offsetX = stage.x + stage.width / 2 - (bounds.x + bounds.width / 2)
          const offsetY = stage.y + stage.height / 2 - (bounds.y + bounds.height / 2)
          const current = project.screens[index]
          project.screens[index] = {
            ...current,
            xMm: action.axis === 'vertical' ? current.xMm : current.xMm + offsetX,
            yMm: action.axis === 'horizontal' ? current.yMm : current.yMm + offsetY
          }
        }
      })
    }

    case 'toggleLock': {
      const ids = new Set(action.ids)
      const targets = state.project?.screens.filter((screen) => ids.has(screen.id)) ?? []
      const shouldLock = targets.some((screen) => !screen.locked)
      return mutate(state, { label: shouldLock ? 'Lock screens' : 'Unlock screens' }, (project) => {
        project.screens = project.screens.map((screen) =>
          ids.has(screen.id) ? { ...screen, locked: shouldLock } : screen
        )
      })
    }

    case 'toggleVisible': {
      const ids = new Set(action.ids)
      const targets = state.project?.screens.filter((screen) => ids.has(screen.id)) ?? []
      const shouldShow = targets.some((screen) => !screen.visible)
      return mutate(state, { label: shouldShow ? 'Show screens' : 'Hide screens' }, (project) => {
        project.screens = project.screens.map((screen) =>
          ids.has(screen.id) ? { ...screen, visible: shouldShow } : screen
        )
      })
    }

    case 'toggleExportVisible':
      return mutate(state, { label: 'Toggle export visibility' }, (project) => {
        const ids = new Set(action.ids)
        const targets = project.screens.filter((screen) => ids.has(screen.id))
        const nextValue = targets.some((screen) => !screen.mapping.exportVisible)
        project.screens = project.screens.map((screen) =>
          ids.has(screen.id)
            ? { ...screen, mapping: { ...screen.mapping, exportVisible: nextValue } }
            : screen
        )
      })

    case 'renameScreen': {
      const name = action.name.trim()
      if (!name) return state
      return mutate(state, { label: 'Rename screen' }, (project) => {
        const index = project.screens.findIndex((screen) => screen.id === action.id)
        if (index >= 0) project.screens[index] = { ...project.screens[index], name }
      })
    }

    case 'reorderScreens':
      return mutate(state, { label: 'Reorder screens' }, (project) => {
        const orderById = new Map(action.ids.map((id, index) => [id, action.order[index] ?? index]))
        project.screens = project.screens.map((screen) => {
          const order = orderById.get(screen.id)
          return order === undefined ? screen : { ...screen, order }
        })
      })

    case 'updateStage':
      return mutate(
        state,
        { label: 'Edit stage', coalesce: action.coalesce },
        (project) => {
          project.stage = { ...project.stage, ...action.patch }
        }
      )

    case 'updateBackground':
      return mutate(
        state,
        { label: 'Edit background', coalesce: action.coalesce },
        (project) => {
          project.stage.background = { ...project.stage.background, ...action.patch }
        }
      )

    case 'setBackgroundImage':
      return mutate(state, { label: 'Set background image' }, (project) => {
        project.stage.background = {
          ...project.stage.background,
          assetPath: action.assetPath,
          assetMissing: false,
          sourceWidth: action.width,
          sourceHeight: action.height
        }
      })

    case 'updateProjectMeta':
      return mutate(state, { label: 'Edit project', coalesce: action.coalesce }, (project) => {
        project.meta = { ...project.meta, ...action.patch }
      })

    case 'updateProjectSettings':
      return mutate(state, { label: 'Edit project settings', coalesce: action.coalesce }, (project) => {
        project.settings = { ...project.settings, ...action.patch }
      })

    case 'assignOutput': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      return mutate(state, { label: action.outputId ? 'Assign output' : 'Unassign output' }, (project) => {
        const output = action.outputId
          ? project.outputs.find((candidate) => candidate.id === action.outputId)
          : undefined
        const occupied = project.screens
          .filter((screen) => ids.has(screen.id) === false && screen.mapping.outputId === action.outputId)
          .map((screen) => effectiveRegion(screen.mapping))

        project.screens = project.screens.map((screen) => {
          if (!ids.has(screen.id)) return screen
          if (!output) {
            return { ...screen, mapping: { ...screen.mapping, outputId: null } }
          }
          const size = { width: screen.pixelWidth, height: screen.pixelHeight }
          const region = defaultRegionFor(output, occupied, size)
          occupied.push(region)
          return {
            ...screen,
            mapping: { ...screen.mapping, outputId: output.id, region, autoRegion: true }
          }
        })
      })
    }

    case 'setRegion':
      return mutate(
        state,
        { label: 'Edit mapping region', coalesce: action.coalesce },
        (project) => {
          const index = project.screens.findIndex((screen) => screen.id === action.id)
          if (index < 0) return
          project.screens[index] = {
            ...project.screens[index],
            mapping: {
              ...project.screens[index].mapping,
              region: cloneRect(action.region),
              autoRegion: action.auto ?? false
            }
          }
        }
      )

    case 'setMappingScale':
      return mutate(
        state,
        { label: 'Edit mapping scale', coalesce: action.coalesce },
        (project) => {
          const index = project.screens.findIndex((screen) => screen.id === action.id)
          if (index < 0) return
          project.screens[index] = {
            ...project.screens[index],
            mapping: { ...project.screens[index].mapping, scale: clamp(action.scale, 0.01, 16) }
          }
        }
      )

    case 'autoArrange': {
      const output = state.project?.outputs.find((candidate) => candidate.id === action.outputId)
      if (!output || !state.project) return state
      const targets = state.project.screens.filter(
        (screen) => screen.mapping.outputId === action.outputId && screen.mapping.autoRegion
      )
      if (targets.length === 0) return state
      const result = autoArrangeRegions(targets, output, { gapPx: 8, useNativeSize: true })
      const warnings = result.warnings
      const next = mutate(state, { label: 'Auto-arrange mapping regions' }, (project) => {
        project.screens = project.screens.map((screen) => {
          const region = result.regions.get(screen.id)
          if (!region) return screen
          return {
            ...screen,
            mapping: {
              ...screen.mapping,
              region: cloneRect(region),
              scale: result.fits && result.scale !== 1 ? result.scale : screen.mapping.scale
            }
          }
        })
      })
      return {
        ...next,
        statusMessage: warnings.length
          ? `Auto-arranged ${targets.length} region(s). ${warnings[0]}`
          : `Auto-arranged ${targets.length} region(s) inside ${output.name}.`
      }
    }

    case 'addOutput': {
      const output: OutputDevice = {
        id: newId('out'),
        name: action.output?.name ?? `Output ${(state.project?.outputs.length ?? 0) + 1}`,
        width: action.output?.width ?? 1920,
        height: action.output?.height ?? 1080,
        enabled: action.output?.enabled ?? true,
        notes: action.output?.notes ?? ''
      }
      return mutate(state, { label: 'Add output' }, (project) => {
        project.outputs = [...project.outputs, output]
      })
    }

    case 'updateOutput':
      return mutate(state, { label: 'Edit output', coalesce: action.coalesce }, (project) => {
        const index = project.outputs.findIndex((output) => output.id === action.id)
        if (index >= 0) project.outputs[index] = { ...project.outputs[index], ...action.patch }
      })

    case 'deleteOutput':
      return mutate(state, { label: 'Delete output' }, (project) => {
        if (project.outputs.length <= 1) return
        project.outputs = project.outputs.filter((output) => output.id !== action.id)
        project.screens = project.screens.map((screen) =>
          screen.mapping.outputId === action.id
            ? { ...screen, mapping: { ...screen.mapping, outputId: null } }
            : screen
        )
      })

    case 'undo': {
      if (state.past.length === 0 || !state.project) return state
      return restore(state, state.past[state.past.length - 1], 'undo')
    }

    case 'redo': {
      if (state.future.length === 0 || !state.project) return state
      return restore(state, state.future[state.future.length - 1], 'redo')
    }

    case 'setStatus':
      return { ...state, statusMessage: action.message }

    case 'setBusy':
      return { ...state, busy: action.label }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class EditorStore {
  private state: EditorState
  private listeners = new Set<() => void>()

  constructor(state: EditorState = initialEditorState) {
    this.state = state
  }

  getState = (): EditorState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispatch = (action: EditorAction): void => {
    const next = editorReducer(this.state, action)
    if (next === this.state) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** Replaces state without touching history, e.g. after a save round trip. */
  replace = (state: EditorState): void => {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

export const editorStore = new EditorStore()

/** Convenience helpers used by the UI for screen defaults. */
export function createScreenForStage(state: EditorState, index = 0): Screen {
  const stage = state.project?.stage
  const pitch = 2.5
  const widthMm = Math.min(2000, stage?.widthMm ? stage.widthMm / 4 : 2000)
  const heightMm = Math.min(1000, stage?.heightMm ? stage.heightMm / 4 : 1000)
  const screen = createScreen({
    name: `Screen ${(state.project?.screens.length ?? 0) + 1}`,
    widthMm: Math.round(widthMm),
    heightMm: Math.round(heightMm),
    pixelPitchMm: pitch,
    colorIndex: (state.project?.screens.length ?? 0) + index
  })
  const stageRectValue = stageRect(state)
  const previous = state.project?.screens ?? []
  const candidate = { widthMm: screen.widthMm, heightMm: screen.heightMm }
  const last = previous[previous.length - 1]
  const gap = 200
  let x = gap
  let y = gap
  if (last) {
    const lastBounds = rotatedBounds(screenGeometryRect(last), last.rotationDeg)
    if (lastBounds.x + lastBounds.width + gap + candidate.widthMm <= stageRectValue.width) {
      x = lastBounds.x + lastBounds.width + gap
      y = lastBounds.y
    } else {
      x = gap
      y = lastBounds.y + lastBounds.height + gap
    }
  }
  screen.xMm = clamp(x, 0, Math.max(stageRectValue.width - candidate.widthMm, 0))
  screen.yMm = clamp(y, 0, Math.max(stageRectValue.height - candidate.heightMm, 0))
  if (state.project?.outputs[0]) {
    screen.mapping.outputId = state.project.outputs[0].id
  }
  return screen
}

export function unitOf(state: EditorState): LengthUnit {
  return state.project?.stage.defaultUnit ?? 'm'
}

export function normaliseRotation(deg: number): number {
  return normalizeDegrees(deg)
}
