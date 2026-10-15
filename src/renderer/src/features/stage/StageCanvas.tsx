import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Point, Rect, Screen } from '@shared/types'
import {
  fitViewToBounds,
  handlePoint,
  moveScreen,
  normalizeDegrees,
  resizeScreen,
  rotatePoint,
  rotatedBounds,
  unionRects,
  viewToMm,
  zoomAtViewPoint,
  type RectHandle,
  type ScreenGeometryInput,
  type SnapCandidate
} from '@shared/geometry'
import { computeSnap } from '@shared/geometry'
import { screenGeometryRect } from '@shared/project'
import { clamp } from '@shared/units'
import { DEFAULT_SNAP_TOLERANCE_PX, WHEEL_ZOOM_STEP } from '@shared/constants'
import { editorStore, type EditorState, selectionBounds, stageRect as stageRectOf } from '../../state/editor'
import {
  buildSnapCandidates,
  constrainToAxis,
  handleAtPoint,
  hitTestScreens,
  marqueeScreens,
  normaliseMarquee,
  toleranceMmFor,
  type SelectionHandle
} from './interaction'
import { drawStage, type StageDrawState } from './drawStage'

/**
 * Stage canvas.
 *
 * Interaction rules:
 *  - Left drag on a screen moves the selection; Shift constrains to the dominant axis.
 *  - Left drag on a handle resizes; Ctrl keeps the aspect ratio; the rotate grip rotates.
 *  - Left drag on empty stage draws a marquee; Ctrl/Shift add to the selection.
 *  - Middle drag, or Space + drag, pans. The wheel zooms about the pointer.
 *
 * Every gesture mutates the project through the shared reducer, so continuous drags
 * coalesce into a single undo step and nothing here writes to persisted geometry directly.
 */

interface PointerSession {
  mode: 'idle' | 'move' | 'resize' | 'rotate' | 'pan' | 'marquee'
  pointerId: number
  startView: Point
  startValue: Point
  handle: SelectionHandle | null
  primaryId: string | null
  originGeometries: Map<string, { xMm: number; yMm: number; widthMm: number; heightMm: number; rotationDeg: number }>
  marqueeStartMm: Point
  additive: boolean
  originalSelection: string[]
  moved: boolean
}

const RESIZE_CURSOR: Record<RectHandle, string> = {
  nw: 'nwse',
  n: 'ns',
  ne: 'nesw',
  e: 'ew',
  se: 'nwse',
  s: 'ns',
  sw: 'nesw',
  w: 'ew'
}

export function StageCanvas({ state }: { state: EditorState }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState({ width: 800, height: 600 })
  const [background, setBackground] = useState<HTMLImageElement | null>(null)
  const [cursor, setCursor] = useState('default')
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const marqueeRef = useRef<Rect | null>(null)
  const session = useRef<PointerSession>({
    mode: 'idle',
    pointerId: -1,
    startView: { x: 0, y: 0 },
    startValue: { x: 0, y: 0 },
    handle: null,
    primaryId: null,
    originGeometries: new Map(),
    marqueeStartMm: { x: 0, y: 0 },
    additive: false,
    originalSelection: [],
    moved: false
  })
  const frame = useRef<number | null>(null)
  const devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1

  const stage = state.project?.stage

  // -------------------------------------------------------------------------
  // Background image
  // -------------------------------------------------------------------------

  useEffect(() => {
    const source = state.backgroundDataUrl
    if (!source) {
      setBackground(null)
      return
    }
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setBackground(image)
    }
    image.onerror = () => {
      if (!cancelled) setBackground(null)
    }
    image.src = source
    return () => {
      cancelled = true
    }
  }, [state.backgroundDataUrl])

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setViewport({ width: Math.max(80, Math.round(width)), height: Math.max(80, Math.round(height)) })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // -------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------

  const requestDraw = useCallback(() => {
    if (frame.current !== null) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null
      const canvas = canvasRef.current
      if (!canvas || !state.project) return
      const context = canvas.getContext('2d')
      if (!context) return
      const drawState: StageDrawState = {
        project: state.project,
        view: state.view,
        viewport,
        selection: state.selection,
        hoveredId: state.hoveredId,
        guides: state.guides,
        marquee: marqueeRef.current,
        background,
        missingBackground: state.project.stage.background.assetMissing,
        devicePixelRatio,
        showRulers: state.project.stage.rulersVisible
      }
      drawStage(context, drawState)
    })
  }, [background, devicePixelRatio, state.guides, state.hoveredId, state.project, state.selection, state.view, viewport])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = Math.round(viewport.width * devicePixelRatio)
    canvas.height = Math.round(viewport.height * devicePixelRatio)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    requestDraw()
  }, [devicePixelRatio, requestDraw, viewport])

  useEffect(() => {
    requestDraw()
  }, [requestDraw, state])

  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current)
    },
    []
  )

  // -------------------------------------------------------------------------
  // Fit / reset commands coming from menus
  // -------------------------------------------------------------------------

  const fitBounds = useCallback(
    (bounds: Rect, maxZoom?: number) => {
      if (!state.project) return
      editorStore.dispatch({
        type: 'setView',
        view: fitViewToBounds(bounds, viewport, state.project.stage.canvasPxPerMeter, {
          paddingPx: 56,
          maxZoom: maxZoom ?? 6
        })
      })
    },
    [state.project, viewport]
  )

  useEffect(() => {
    const onFitStage = (): void => {
      if (!state.project) return
      fitBounds(stageRectOf(state))
    }
    const onFitSelection = (): void => {
      const bounds = selectionBounds(state)
      if (!bounds) {
        onFitStage()
        return
      }
      fitBounds(bounds, 12)
    }
    window.addEventListener('cuepoint:fit-stage', onFitStage)
    window.addEventListener('cuepoint:fit-selection', onFitSelection)
    return () => {
      window.removeEventListener('cuepoint:fit-stage', onFitStage)
      window.removeEventListener('cuepoint:fit-selection', onFitSelection)
    }
  }, [fitBounds, state])

  // Fit the stage the first time a project is opened.
  const fitOnce = useRef<string | null>(null)
  useEffect(() => {
    if (!state.project) {
      fitOnce.current = null
      return
    }
    if (fitOnce.current === state.project.meta.id) return
    if (viewport.width < 120) return
    fitOnce.current = state.project.meta.id
    fitBounds(stageRectOf(state))
  }, [fitBounds, state, viewport.width])

  // -------------------------------------------------------------------------
  // Space-to-pan
  // -------------------------------------------------------------------------

  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      if (!element) return false
      return (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable
      )
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || isEditable(event.target)) return
      setSpaceHeld(true)
      if (!event.repeat) event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    if (spaceHeld) setCursor('grab')
    else setCursor('default')
  }, [spaceHeld])

  // -------------------------------------------------------------------------
  // Pointer helpers
  // -------------------------------------------------------------------------

  const toMm = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const host = hostRef.current
      if (!host || !state.project) return { x: 0, y: 0 }
      const rect = host.getBoundingClientRect()
      return viewToMm(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        state.project.stage.canvasPxPerMeter,
        state.view
      )
    },
    [state.project, state.view]
  )

  const pixelsPerMm = state.project
    ? (state.project.stage.canvasPxPerMeter / 1000) * state.view.zoom
    : 1

  const toleranceMm = useMemo(
    () =>
      state.project
        ? toleranceMmFor(
            state.project.stage.canvasPxPerMeter,
            state.view.zoom,
            state.project.stage.snapTolerancePx || DEFAULT_SNAP_TOLERANCE_PX
          )
        : 0,
    [state.project, state.view.zoom]
  )

  const lockedIds = useMemo(
    () => new Set(state.project?.screens.filter((screen) => screen.locked).map((screen) => screen.id) ?? []),
    [state.project]
  )

  const updateCursorForPoint = useCallback(
    (mm: Point) => {
      if (!state.project) return
      if (spaceHeld) {
        setCursor('grab')
        return
      }
      const selected = state.project.screens.filter((screen) => state.selection.includes(screen.id))
      if (selected.length === 1 && !lockedIds.has(selected[0].id)) {
        const handle = handleAtPoint(selected[0], mm, toleranceMm, pixelsPerMm)
        if (handle === 'rotate') {
          setCursor('crosshair')
          return
        }
        if (handle) {
          setCursor(RESIZE_CURSOR[handle])
          return
        }
      }
      const hit = hitTestScreens(state.project.screens, mm)
      if (hit) {
        setCursor(lockedIds.has(hit.id) ? 'not-allowed' : 'move')
        return
      }
      setCursor('default')
    },
    [lockedIds, pixelsPerMm, spaceHeld, state.project, state.selection, toleranceMm]
  )

  const commitGeometry = useCallback(
    (changes: { id: string; geometry: Partial<Screen> }[], label: string, coalesce: string) => {
      if (changes.length === 0) return
      editorStore.dispatch({ type: 'setGeometry', changes, label, coalesce })
    },
    []
  )

  // -------------------------------------------------------------------------
  // Pointer handlers
  // -------------------------------------------------------------------------

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!state.project) return
      const host = hostRef.current
      if (!host) return
      host.setPointerCapture(event.pointerId)
      const mm = toMm(event)
      const rect = host.getBoundingClientRect()
      const viewPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top }

      const active: PointerSession = {
        mode: 'idle',
        pointerId: event.pointerId,
        startView: viewPoint,
        startValue: mm,
        handle: null,
        primaryId: null,
        originGeometries: new Map(),
        marqueeStartMm: mm,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
        originalSelection: [...state.selection],
        moved: false
      }

      if (event.button === 1 || spaceHeld) {
        active.mode = 'pan'
        session.current = active
        setCursor('grabbing')
        event.preventDefault()
        return
      }

      if (event.button !== 0) return

      const selectedScreens = state.project.screens.filter((screen) => state.selection.includes(screen.id))
      if (selectedScreens.length === 1 && !lockedIds.has(selectedScreens[0].id)) {
        const handle = handleAtPoint(selectedScreens[0], mm, toleranceMm, pixelsPerMm)
        if (handle) {
          active.mode = handle === 'rotate' ? 'rotate' : 'resize'
          active.handle = handle
          active.primaryId = selectedScreens[0].id
          active.originGeometries.set(selectedScreens[0].id, geometryOf(selectedScreens[0]))
          session.current = active
          return
        }
      }

      const hit = hitTestScreens(state.project.screens, mm)
      if (hit) {
        const alreadySelected = state.selection.includes(hit.id)
        let selection = state.selection
        if (active.additive) {
          selection = alreadySelected
            ? state.selection.filter((id) => id !== hit.id)
            : [...state.selection, hit.id]
        } else if (!alreadySelected) {
          selection = [hit.id]
        }
        editorStore.dispatch({ type: 'select', ids: selection })
        active.mode = 'move'
        active.primaryId = hit.id
        active.originalSelection = selection
        for (const id of selection) {
          const screen = state.project.screens.find((candidate) => candidate.id === id)
          if (screen && !lockedIds.has(screen.id)) active.originGeometries.set(id, geometryOf(screen))
        }
        if (active.originGeometries.size === 0) {
          active.mode = 'idle'
        }
        session.current = active
        return
      }

      active.mode = 'marquee'
      if (!active.additive) editorStore.dispatch({ type: 'select', ids: [] })
      session.current = active
    },
    [lockedIds, pixelsPerMm, spaceHeld, state.project, state.selection, toleranceMm, toMm]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!state.project) return
      const mm = toMm(event)
      const active = session.current

      if (active.mode === 'idle') {
        updateCursorForPoint(mm)
        const hover = hitTestScreens(state.project.screens, mm)
        const nextHover = hover?.id ?? null
        if (nextHover !== state.hoveredId) editorStore.dispatch({ type: 'setHovered', id: nextHover })
        return
      }

      active.moved = true
      const rawDelta = { x: mm.x - active.startValue.x, y: mm.y - active.startValue.y }

      if (active.mode === 'pan') {
        const host = hostRef.current
        if (!host) return
        const rect = host.getBoundingClientRect()
        const viewPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        editorStore.dispatch({
          type: 'setView',
          view: {
            panX: state.view.panX + (viewPoint.x - active.startView.x),
            panY: state.view.panY + (viewPoint.y - active.startView.y)
          }
        })
        // Keep the reference point current so each move applies only the increment.
        active.startView = viewPoint
        return
      }

      if (active.mode === 'marquee') {
        const next = normaliseMarquee(active.marqueeStartMm, mm)
        marqueeRef.current = next
        setMarquee(next)
        requestDraw()
        const inside = marqueeScreens(state.project.screens, next).filter((screen) => !lockedIds.has(screen.id))
        const ids = active.additive
          ? [...new Set([...active.originalSelection, ...inside.map((screen) => screen.id)])]
          : inside.map((screen) => screen.id)
        editorStore.dispatch({ type: 'select', ids })
        return
      }

      if (active.mode === 'resize' && active.primaryId && active.handle && active.handle !== 'rotate') {
        const origin = active.originGeometries.get(active.primaryId)
        if (!origin) return
        const keepAspect = event.ctrlKey || event.metaKey
        const resized = resizeScreen(
          origin,
          active.handle,
          { x: active.startValue.x + rawDelta.x, y: active.startValue.y + rawDelta.y },
          {
            minWidthMm: 50,
            minHeightMm: 50,
            keepAspect,
            aspectRatio: origin.heightMm > 0 ? origin.widthMm / origin.heightMm : undefined
          }
        )
        const rect = rectOfGeometry(resized)
        let nextRect = rect
        let guides: SnapCandidate[] = []
        if (state.project.stage.snapToGrid || state.project.stage.snapToScreens || state.project.stage.snapToStage) {
          const snapped = computeSnap(rect, {
            toleranceMm,
            candidates: buildSnapCandidates(state.project, rect, new Set([active.primaryId]), toleranceMm),
            edges: ['start', 'end']
          })
          nextRect = { ...rect, x: rect.x + snapped.delta.x, y: rect.y + snapped.delta.y }
          guides = snapped.guides
        }
        const delta = { x: nextRect.x - rect.x, y: nextRect.y - rect.y }
        editorStore.dispatch({ type: 'setGuides', guides })
        commitGeometry(
          [
            {
              id: active.primaryId,
              geometry: {
                widthMm: Math.max(50, resized.widthMm + delta.x),
                heightMm: Math.max(50, resized.heightMm + delta.y),
                xMm: nextRect.x,
                yMm: nextRect.y
              }
            }
          ],
          'Resize screen',
          `resize:${active.primaryId}`
        )
        return
      }

      if (active.mode === 'rotate' && active.primaryId) {
        const origin = active.originGeometries.get(active.primaryId)
        if (!origin) return
        const rect = rectOfGeometry(origin)
        const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        const angle = (Math.atan2(mm.y - center.y, mm.x - center.x) * 180) / Math.PI + 90
        const snapped = event.shiftKey ? Math.round(angle / 15) * 15 : angle
        const resolved = event.ctrlKey || event.metaKey
          ? Math.round(snapped)
          : Math.round(snapped * 10) / 10
        // Rotation happens about the screen centre, so the centre is preserved.
        const deltaRotation = normalizeDegrees(resolved) - normalizeDegrees(origin.rotationDeg)
        const rotatedCenter = rotatePoint(center, center, deltaRotation)
        commitGeometry(
          [
            {
              id: active.primaryId,
              geometry: {
                rotationDeg: normalizeDegrees(resolved),
                xMm: rotatedCenter.x - rect.width / 2,
                yMm: rotatedCenter.y - rect.height / 2
              }
            }
          ],
          'Rotate screen',
          `rotate:${active.primaryId}`
        )
        return
      }

      if (active.mode === 'move') {
        let delta = rawDelta
        if (event.shiftKey) delta = constrainToAxis(delta)
        const ids = [...active.originGeometries.keys()]
        const unionBefore =
          unionRects(
            ids.map((id) => {
              const origin = active.originGeometries.get(id)!
              return rotatedBounds(rectOfGeometry(origin), origin.rotationDeg)
            })
          ) ?? { x: 0, y: 0, width: 0, height: 0 }
        const movedRect = {
          x: unionBefore.x + delta.x,
          y: unionBefore.y + delta.y,
          width: unionBefore.width,
          height: unionBefore.height
        }
        let guides: SnapCandidate[] = []
        if (
          !event.altKey &&
          (state.project.stage.snapToGrid || state.project.stage.snapToScreens || state.project.stage.snapToStage)
        ) {
          const snapped = computeSnap(movedRect, {
            toleranceMm,
            candidates: buildSnapCandidates(state.project, movedRect, new Set(ids), toleranceMm)
          })
          delta = { x: delta.x + snapped.delta.x, y: delta.y + snapped.delta.y }
          guides = snapped.guides
        }
        editorStore.dispatch({ type: 'setGuides', guides })
        const changes = ids.map((id) => {
          const origin = active.originGeometries.get(id)!
          const next = moveScreen(origin, delta)
          return { id, geometry: { xMm: next.xMm, yMm: next.yMm } }
        })
        commitGeometry(changes, 'Move screens', `move:${ids.join(',')}`)
      }
    },
    [commitGeometry, lockedIds, requestDraw, state.hoveredId, state.project, state.view, toleranceMm, toMm, updateCursorForPoint]
  )

  const endSession = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const active = session.current
      if (active.mode === 'idle') return
      const host = hostRef.current
      if (host && host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
      session.current = {
        ...active,
        mode: 'idle',
        handle: null,
        primaryId: null,
        originGeometries: new Map(),
        moved: false
      }
      marqueeRef.current = null
      setMarquee(null)
      editorStore.dispatch({ type: 'setGuides', guides: [] })
      if (spaceHeld) setCursor('grab')
      else setCursor('default')
      requestDraw()
    },
    [requestDraw, spaceHeld]
  )

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!state.project) return
      const host = hostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const viewPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (event.shiftKey && !event.ctrlKey) {
        editorStore.dispatch({ type: 'setView', view: { panX: state.view.panX - event.deltaY } })
        return
      }
      if (event.deltaY === 0) return
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
      editorStore.dispatch({ type: 'setView', view: zoomAtViewPoint(state.view, viewPoint, factor) })
    },
    [state.project, state.view]
  )

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!state.project) return
      const mm = toMm(event)
      const hit = hitTestScreens(state.project.screens, mm)
      if (hit) {
        editorStore.dispatch({ type: 'select', ids: [hit.id] })
        window.dispatchEvent(new CustomEvent('cuepoint:rename-screen', { detail: hit.id }))
        return
      }
      // Double-click on empty stage toggles a fit of the whole stage.
      fitBounds(stageRectOf(state))
    },
    [fitBounds, state, toMm]
  )

  const stageSize = stage ? `${stage.widthMm / 1000} m × ${stage.heightMm / 1000} m` : '—'
  const zoomPercent = Math.round(state.view.zoom * 100)

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      data-cursor={cursor}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endSession}
      onPointerCancel={endSession}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => {
        event.preventDefault()
        if (!state.project) return
        const mm = toMm(event)
        const hit = hitTestScreens(state.project.screens, mm)
        window.dispatchEvent(
          new CustomEvent('cuepoint:stage-context-menu', {
            detail: {
              x: event.clientX,
              y: event.clientY,
              screenId: hit?.id ?? null,
              mm
            }
          })
        )
      }}
      role="application"
      aria-label="Stage canvas. Use arrow keys to nudge the selection, space and drag to pan, and the mouse wheel to zoom."
      tabIndex={0}
    >
      <canvas ref={canvasRef} />
      <div className="canvas-overlay">
        <div className="canvas-hint">
          {state.selection.length > 0
            ? `${state.selection.length} screen(s) selected · ${lockedIds.size ? `${lockedIds.size} locked · ` : ''}arrow keys nudge, Shift+arrow steps 100 mm`
            : `Stage ${stageSize} · drag to move · middle-drag or Space+drag to pan · wheel to zoom`}
        </div>
        <div className="zoom-chip">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            title="Zoom out (Ctrl+-)"
            aria-label="Zoom out"
            onClick={() => editorStore.dispatch({ type: 'setView', view: { zoom: clamp(state.view.zoom / 1.25, 0.05, 40) } })}
          >
            −
          </button>
          <span className="zoom-chip__value">{zoomPercent}%</span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            title="Zoom in (Ctrl+=)"
            aria-label="Zoom in"
            onClick={() => editorStore.dispatch({ type: 'setView', view: { zoom: clamp(state.view.zoom * 1.25, 0.05, 40) } })}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            title="Fit stage (Ctrl+0)"
            onClick={() => fitBounds(stageRectOf(state))}
          >
            Fit
          </button>
        </div>
      </div>
      {marquee ? <span className="sr-only">Marquee selection active</span> : null}
    </div>
  )
}

function geometryOf(screen: Screen): ScreenGeometryInput {
  return {
    xMm: screen.xMm,
    yMm: screen.yMm,
    widthMm: screen.widthMm,
    heightMm: screen.heightMm,
    rotationDeg: screen.rotationDeg
  }
}

/** Rectangle for a bare geometry record (used while a gesture is in flight). */
function rectOfGeometry(geometry: ScreenGeometryInput): Rect {
  return {
    x: geometry.xMm,
    y: geometry.yMm,
    width: geometry.widthMm,
    height: geometry.heightMm
  }
}

/** Exposed for tests: handle position in stage millimetres for a screen. */
export function handlePositionMm(screen: Screen, handle: RectHandle): Point {
  return handlePoint(screenGeometryRect(screen), screen.rotationDeg, handle)
}
