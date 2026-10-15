import { useCallback, useEffect, useState } from 'react'
import type { Point, Screen } from '@shared/types'
import { Button, IconButton, Panel } from '../../components/ui'
import { editorStore, createScreenForStage, type EditorState } from '../../state/editor'
import { useApp } from '../../state/AppState'
import { ScreenList } from './ScreenList'
import { Inspector } from './Inspector'
import { StageCanvas } from './StageCanvas'

/**
 * Stage Designer workspace.
 *
 * Owns the layout (screen list, canvas, inspector) and the workspace-level commands that
 * concern more than one panel: adding screens, confirmed deletion, background import and
 * the right-click menu.
 */

interface ContextMenuState {
  x: number
  y: number
  screenId: string | null
  mm: Point
}

export function StageDesigner({ state }: { state: EditorState }): JSX.Element {
  const { notify, openModal, closeModal, command, panels, togglePanel } = useApp()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const addScreen = useCallback(() => {
    if (!state.project) {
      notify('warning', 'No project is open', 'Create a project first, then add screens.')
      return
    }
    editorStore.dispatch({ type: 'addScreens', screens: [createScreenForStage(state)] })
  }, [notify, state])

  const confirmDelete = useCallback(() => {
    const locked = state.project?.screens.filter((screen) => state.selection.includes(screen.id) && screen.locked) ?? []
    const deletable = state.selection.filter((id) => !locked.some((screen) => screen.id === id))
    if (deletable.length === 0) {
      notify('warning', 'Nothing can be deleted', 'The selected screens are locked. Unlock them first.')
      return
    }
    const names = state.project?.screens
      .filter((screen) => deletable.includes(screen.id))
      .map((screen) => screen.name)
      .join(', ')
    openModal({
      kind: 'confirm',
      title: 'Delete screens',
      message: `Delete ${deletable.length} screen(s)?`,
      detail: `${names}\n\nDeleting is undoable with Ctrl+Z until the project is closed.`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        editorStore.dispatch({ type: 'deleteScreens', ids: deletable })
        closeModal()
        notify('info', `Deleted ${deletable.length} screen(s)`, 'Press Ctrl+Z to restore them.')
      }
    })
  }, [closeModal, notify, openModal, state.project, state.selection])

  const importBackground = useCallback(() => {
    void (async () => {
      const api = window.cuepoint
      if (!api) return
      const result = await api.stage.importBackground()
      if (!result.ok) {
        notify('error', 'Background import failed', result.error.message)
        return
      }
      if (!result.data) return
      const asset = result.data
      const dataUrl = await api.stage.readAssetDataUrl(asset.path)
      if (!dataUrl.ok) {
        notify('error', 'Background could not be read', dataUrl.error.message)
        return
      }
      editorStore.dispatch({
        type: 'setBackgroundImage',
        dataUrl: dataUrl.data,
        assetPath: asset.path,
        width: asset.width,
        height: asset.height
      })
      notify('success', 'Background imported', `${asset.width} × ${asset.height} px · ${asset.format}`)
      if (asset.warning) notify('warning', 'Background note', asset.warning)
    })()
  }, [notify])

  const removeBackground = useCallback(() => {
    openModal({
      kind: 'confirm',
      title: 'Remove background',
      message: 'Remove the background image from this project?',
      detail: 'The referenced file on disk is not deleted. You can import it again at any time.',
      confirmLabel: 'Remove',
      onConfirm: () => {
        editorStore.dispatch({
          type: 'setBackgroundImage',
          dataUrl: null,
          assetPath: null,
          width: null,
          height: null
        })
        closeModal()
      }
    })
  }, [closeModal, openModal])

  useEffect(() => {
    const handlers: [string, (event: Event) => void][] = [
      ['cuepoint:add-screen', () => addScreen()],
      ['cuepoint:delete-screens', () => confirmDelete()],
      ['cuepoint:import-background', () => importBackground()],
      ['cuepoint:remove-background', () => removeBackground()],
      ['cuepoint:recovery', () => command('project.recover')],
      [
        'cuepoint:stage-context-menu',
        (event) => {
          const detail = (event as CustomEvent<ContextMenuState>).detail
          setContextMenu(detail)
        }
      ]
    ]
    for (const [name, handler] of handlers) window.addEventListener(name, handler)
    return () => {
      for (const [name, handler] of handlers) window.removeEventListener(name, handler)
    }
  }, [addScreen, command, confirmDelete, importBackground, removeBackground])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  const lockedCount = state.project?.screens.filter((screen) => screen.locked).length ?? 0

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">Stage Designer</span>
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          tooltip="Add a screen to the stage (Ctrl+Shift+N)"
          disabled={!state.project}
          onClick={addScreen}
        >
          Add screen
        </Button>
        <span className="toolbar__divider" />
        <IconButton icon="undo" label="Undo (Ctrl+Z)" disabled={state.past.length === 0} onClick={() => editorStore.dispatch({ type: 'undo' })} />
        <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={state.future.length === 0} onClick={() => editorStore.dispatch({ type: 'redo' })} />
        <span className="toolbar__divider" />
        <IconButton icon="fit" label="Fit the whole stage in the view (Ctrl+0)" onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:fit-stage'))} />
        <IconButton icon="zoomIn" label="Zoom in (Ctrl+=)" onClick={() => command('view.zoomIn')} />
        <IconButton icon="zoomOut" label="Zoom out (Ctrl+-)" onClick={() => command('view.zoomOut')} />
        <IconButton icon="guides" label="Fit the selection in the view (Ctrl+Shift+0)" onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:fit-selection'))} />
        <span className="toolbar__divider" />
        <IconButton
          icon="grid"
          label="Show or hide the grid (Ctrl+G)"
          active={state.project?.stage.gridVisible}
          onClick={() => command('view.toggleGrid')}
        />
        <IconButton
          icon="magnet"
          label="Enable or disable snapping (Ctrl+Shift+G)"
          active={
            (state.project?.stage.snapToGrid ?? false) ||
            (state.project?.stage.snapToScreens ?? false) ||
            (state.project?.stage.snapToStage ?? false)
          }
          onClick={() => command('view.toggleSnap')}
        />
        <IconButton
          icon="eye"
          label="Show or hide alignment guides (Ctrl+;)"
          active={state.project?.stage.guidesVisible}
          onClick={() => command('view.toggleGuides')}
        />
        <span className="toolbar__divider" />
        <IconButton
          icon="lock"
          label="Lock or unlock the selected screens (Ctrl+L)"
          disabled={state.selection.length === 0}
          onClick={() => editorStore.dispatch({ type: 'toggleLock', ids: state.selection })}
        />
        <IconButton
          icon="image"
          label="Import a stage background image (Ctrl+Shift+I)"
          onClick={importBackground}
        />
        <div className="toolbar__spacer" />
        {lockedCount > 0 ? (
          <span className="toolbar__field" title="Locked screens resist selection-relative edits">
            {lockedCount} locked
          </span>
        ) : null}
        <IconButton
          icon={panels.inspector ? 'chevronRight' : 'chevronDown'}
          label={panels.inspector ? 'Hide the property inspector (Ctrl+Shift+B)' : 'Show the property inspector (Ctrl+Shift+B)'}
          onClick={() => togglePanel('inspector')}
        />
        <Button size="sm" variant="ghost" icon="check" tooltip="Validate the project (F7)" onClick={() => command('tools.validateProject')}>
          Validate
        </Button>
      </div>

      <div className={panels.inspector ? 'workspace-split' : 'workspace-split no-inspector'}>
        <div className="row" style={{ alignItems: 'stretch', minHeight: 0, minWidth: 0, gap: 0 }}>
          <div style={{ width: 320, flex: 'none', display: 'flex', minHeight: 0 }}>
            <ScreenList state={state} />
          </div>
          <StageCanvas state={state} />
        </div>
        {panels.inspector ? <Inspector state={state} /> : null}
      </div>

      {contextMenu ? (
        <div
          className="modal-scrim"
          style={{ background: 'transparent', alignItems: 'flex-start', justifyContent: 'flex-start', padding: 0 }}
          onMouseDown={() => setContextMenu(null)}
        >
          <div
            className="panel"
            style={{
              position: 'fixed',
              left: Math.min(contextMenu.x, window.innerWidth - 260),
              top: Math.min(contextMenu.y, window.innerHeight - 320),
              width: 250,
              zIndex: 'var(--z-modal)',
              boxShadow: 'var(--shadow-lg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-strong)'
            }}
            role="menu"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="panel__body" style={{ padding: 'var(--space-3)', gap: 'var(--space-1)' }}>
              {contextMenu.screenId ? (
                <>
                  {contextMenu.screenId && !state.selection.includes(contextMenu.screenId) ? (
                    <MenuButton
                      label="Select this screen"
                      onClick={() => {
                        editorStore.dispatch({ type: 'select', ids: [contextMenu.screenId as string] })
                        setContextMenu(null)
                      }}
                    />
                  ) : null}
                  <MenuButton
                    label="Rename screen"
                    hint="F2"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('cuepoint:rename-screen', { detail: contextMenu.screenId }))
                      setContextMenu(null)
                    }}
                  />
                  <MenuButton
                    label="Duplicate"
                    hint="Ctrl+Shift+D"
                    onClick={() => {
                      editorStore.dispatch({ type: 'duplicateScreens', ids: [contextMenu.screenId as string] })
                      setContextMenu(null)
                    }}
                  />
                  <MenuButton
                    label="Lock / unlock"
                    hint="Ctrl+L"
                    onClick={() => {
                      editorStore.dispatch({ type: 'toggleLock', ids: [contextMenu.screenId as string] })
                      setContextMenu(null)
                    }}
                  />
                  <MenuButton
                    label="Hide / show"
                    hint="Ctrl+Shift+H"
                    onClick={() => {
                      editorStore.dispatch({ type: 'toggleVisible', ids: [contextMenu.screenId as string] })
                      setContextMenu(null)
                    }}
                  />
                  <MenuButton
                    label="Bring to front"
                    onClick={() => {
                      const ordered = [...(state.project?.screens ?? [])].sort((a, b) => a.order - b.order)
                      const id = contextMenu.screenId as string
                      const rest = ordered.filter((screen) => screen.id !== id)
                      const next = [...rest, ordered.find((screen) => screen.id === id)!].map((screen) => screen.id)
                      editorStore.dispatch({
                        type: 'reorderScreens',
                        ids: next,
                        order: next.map((_, index) => index)
                      })
                      setContextMenu(null)
                    }}
                  />
                  <MenuButton
                    label="Move screen here"
                    tooltip={`Move the selected screens so this screen's top-left corner sits at ${Math.round(contextMenu.mm.x)} mm, ${Math.round(contextMenu.mm.y)} mm`}
                    onClick={() => {
                      const target = state.project?.screens.find((screen) => screen.id === contextMenu.screenId)
                      if (!target) return
                      const ids = state.selection.length ? state.selection : [target.id]
                      const moving = ids
                        .map((id) => state.project?.screens.find((candidate) => candidate.id === id))
                        .filter((screen): screen is Screen => Boolean(screen))
                      editorStore.dispatch({
                        type: 'setGeometry',
                        changes: moving.map((screen) => ({
                          id: screen.id,
                          geometry: {
                            xMm: screen.xMm + (contextMenu.mm.x - target.xMm),
                            yMm: screen.yMm + (contextMenu.mm.y - target.yMm)
                          }
                        })),
                        label: 'Move screens to pointer'
                      })
                      setContextMenu(null)
                    }}
                  />
                  <MenuButton
                    label="Delete"
                    hint="Delete"
                    danger
                    onClick={() => {
                      if (!state.selection.includes(contextMenu.screenId as string)) {
                        editorStore.dispatch({ type: 'select', ids: [contextMenu.screenId as string] })
                      }
                      setContextMenu(null)
                      confirmDelete()
                    }}
                  />
                  <div className="panel__section-title" style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    Align selection
                  </div>
                  <MenuButton label="Align left" onClick={() => { editorStore.dispatch({ type: 'align', mode: 'left' }); setContextMenu(null) }} />
                  <MenuButton label="Align centres" onClick={() => { editorStore.dispatch({ type: 'align', mode: 'hcenter' }); setContextMenu(null) }} />
                  <MenuButton label="Align right" onClick={() => { editorStore.dispatch({ type: 'align', mode: 'right' }); setContextMenu(null) }} />
                </>
              ) : (
                <>
                  <MenuButton
                    label="Add screen here"
                    tooltip="Add a screen positioned near the pointer"
                    onClick={() => {
                      const screen = createScreenForStage(state)
                      screen.xMm = Math.max(0, Math.round(contextMenu.mm.x))
                      screen.yMm = Math.max(0, Math.round(contextMenu.mm.y))
                      editorStore.dispatch({ type: 'addScreens', screens: [screen] })
                      setContextMenu(null)
                    }}
                  />
                  <MenuButton label="Paste" hint="Ctrl+V" onClick={() => { command('edit.paste'); setContextMenu(null) }} />
                  <MenuButton label="Select all" hint="Ctrl+A" onClick={() => { command('edit.selectAll'); setContextMenu(null) }} />
                  <MenuButton label="Fit stage" hint="Ctrl+0" onClick={() => { command('view.fitStage'); setContextMenu(null) }} />
                  <MenuButton label="Import background" hint="Ctrl+Shift+I" onClick={() => { setContextMenu(null); importBackground() }} />
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!state.project ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <Panel title="No project open">
            <p className="muted">
              Create a project from Home to start laying out screens. Everything is stored locally — CuePoint
              works fully offline.
            </p>
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

function MenuButton({
  label,
  hint,
  tooltip,
  danger,
  onClick
}: {
  label: string
  hint?: string
  tooltip?: string
  danger?: boolean
  onClick(): void
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'list__item' : 'list__item'}
      style={danger ? { color: 'var(--danger)' } : undefined}
      title={tooltip ?? (hint ? `${label} (${hint})` : label)}
      onClick={onClick}
    >
      <span className="list__label">{label}</span>
      {hint ? <span className="list__meta">{hint}</span> : null}
    </button>
  )
}
