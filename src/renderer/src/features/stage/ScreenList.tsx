import { useEffect, useMemo, useRef, useState } from 'react'
import type { Screen } from '@shared/types'
import { Badge, Button, EmptyState, Icon, IconButton, Panel, SearchInput, TextField } from '../../components/ui'
import { editorStore, type EditorState } from '../../state/editor'
import { useApp } from '../../state/AppState'
import { formatLength } from '@shared/units'

/**
 * Screen list.
 *
 * Selection is shared with the canvas: clicking a row selects on the stage, and canvas
 * selection highlights the row. Reordering writes `order`, which is the same field the
 * canvas uses for draw order and hit-testing priority.
 */

export function ScreenList({ state }: { state: EditorState }): JSX.Element {
  const { notify } = useApp()
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  const unit = state.project?.stage.defaultUnit ?? 'm'
  const screens = useMemo(
    () => [...(state.project?.screens ?? [])].sort((a, b) => a.order - b.order),
    [state.project]
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return screens
    return screens.filter(
      (screen) =>
        screen.name.toLowerCase().includes(needle) ||
        screen.notes.toLowerCase().includes(needle) ||
        String(screen.pixelWidth).includes(needle) ||
        String(screen.pixelHeight).includes(needle)
    )
  }, [query, screens])

  useEffect(() => {
    const handler = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const screen = state.project?.screens.find((candidate) => candidate.id === id)
      if (!screen) return
      editorStore.dispatch({ type: 'select', ids: [screen.id] })
      setRenamingId(screen.id)
      setRenameDraft(screen.name)
    }
    window.addEventListener('cuepoint:rename-screen', handler)
    return () => window.removeEventListener('cuepoint:rename-screen', handler)
  }, [state.project])

  const selection = new Set(state.selection)

  const move = (direction: -1 | 1): void => {
    const ordered = screens.map((screen) => screen.id)
    const moving = state.selection
      .map((id) => ordered.indexOf(id))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)
    if (moving.length === 0) return
    const next = [...ordered]
    const indices = direction === -1 ? moving : [...moving].reverse()
    for (const index of indices) {
      const target = index + direction
      if (target < 0 || target >= next.length) continue
      const temp = next[target]
      next[target] = next[index]
      next[index] = temp
    }
    editorStore.dispatch({
      type: 'reorderScreens',
      ids: next,
      order: next.map((_, index) => index)
    })
  }

  return (
    <Panel
      title="Screens"
      icon="screen"
      actions={
        <>
          <IconButton
            icon="plus"
            label="Add a screen to the stage (Ctrl+Shift+N)"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('cuepoint:add-screen'))
            }}
          />
          <IconButton
            icon="duplicate"
            label="Duplicate the selected screens (Ctrl+Shift+D)"
            disabled={state.selection.length === 0}
            onClick={() => editorStore.dispatch({ type: 'duplicateScreens', ids: state.selection })}
          />
          <IconButton
            icon="trash"
            label="Delete the selected screens"
            disabled={state.selection.length === 0}
            onClick={() => {
              const locked = screens.filter((screen) => selection.has(screen.id) && screen.locked)
              if (locked.length > 0) {
                notify('warning', 'Locked screens cannot be deleted', 'Unlock them first with Ctrl+L.')
                return
              }
              window.dispatchEvent(new CustomEvent('cuepoint:delete-screens'))
            }}
          />
        </>
      }
    >
      <SearchInput
        label="Search screens"
        placeholder="Search by name, notes or resolution"
        value={query}
        onChange={setQuery}
      />

      <div className="row row--wrap">
        <Button
          size="sm"
          variant="ghost"
          icon="check"
          tooltip="Select every visible screen (Ctrl+A)"
          onClick={() =>
            editorStore.dispatch({
              type: 'select',
              ids: screens.filter((screen) => screen.visible).map((screen) => screen.id)
            })
          }
        >
          Select all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="close"
          tooltip="Clear the current selection (Escape)"
          onClick={() => editorStore.dispatch({ type: 'select', ids: [] })}
        >
          Clear
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="lock"
          tooltip="Lock or unlock the selected screens (Ctrl+L)"
          disabled={state.selection.length === 0}
          onClick={() => editorStore.dispatch({ type: 'toggleLock', ids: state.selection })}
        >
          Lock
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="eyeOff"
          tooltip="Hide or show the selected screens (Ctrl+Shift+H)"
          disabled={state.selection.length === 0}
          onClick={() => editorStore.dispatch({ type: 'toggleVisible', ids: state.selection })}
        >
          Hide
        </Button>
      </div>

      {screens.length === 0 ? (
        <EmptyState
          icon="screen"
          title="No screens yet"
          message="Add an LED screen to start laying out the stage. Each screen keeps its own physical size and native pixel resolution."
          actions={
            <Button
              variant="primary"
              icon="plus"
              onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:add-screen'))}
            >
              Add screen
            </Button>
          }
        />
      ) : (
        <>
          {filtered.length === 0 ? <p className="muted">No screens match “{query}”.</p> : null}
          <ul className="list" ref={listRef} aria-label="Screens on the stage">
            {filtered.map((screen) => (
              <li key={screen.id}>
                <div
                  role="option"
                  aria-selected={selection.has(screen.id)}
                  tabIndex={0}
                  className={[
                    'list__item',
                    'list__item--compact',
                    selection.has(screen.id) ? 'is-selected' : '',
                    screen.locked ? 'is-locked' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={`${screen.name} · ${formatLength(screen.widthMm, unit)} × ${formatLength(screen.heightMm, unit)} · ${screen.pixelWidth}×${screen.pixelHeight} px`}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                      editorStore.dispatch({ type: 'toggleSelect', id: screen.id })
                    } else {
                      editorStore.dispatch({ type: 'select', ids: [screen.id] })
                    }
                  }}
                  onDoubleClick={() => {
                    setRenamingId(screen.id)
                    setRenameDraft(screen.name)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      editorStore.dispatch({ type: 'select', ids: [screen.id] })
                    }
                    if (event.key === 'F2') {
                      setRenamingId(screen.id)
                      setRenameDraft(screen.name)
                    }
                  }}
                >
                  <span className="list__swatch" style={{ background: screen.color }} aria-hidden="true" />
                  {renamingId === screen.id ? (
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <TextField
                        label="Screen name"
                        value={renameDraft}
                        autoFocus
                        onChange={setRenameDraft}
                        commitOnBlur
                      />
                    </div>
                  ) : (
                    <span className="list__label">{screen.name}</span>
                  )}
                  <span className="list__meta">
                    {formatLength(screen.widthMm, unit)} × {formatLength(screen.heightMm, unit)}
                  </span>
                  <span className="list__meta">
                    {screen.pixelWidth}×{screen.pixelHeight}
                  </span>
                  <div className="list__row-actions">
                    <IconButton
                      size="sm"
                      icon={screen.visible ? 'eye' : 'eyeOff'}
                      label={screen.visible ? `Hide ${screen.name} on the stage` : `Show ${screen.name} on the stage`}
                      onClick={(event) => {
                        event.stopPropagation()
                        editorStore.dispatch({ type: 'toggleVisible', ids: [screen.id] })
                      }}
                    />
                    <IconButton
                      size="sm"
                      icon={screen.locked ? 'lock' : 'unlock'}
                      label={
                        screen.locked
                          ? `Unlock ${screen.name} so it can be moved again`
                          : `Lock ${screen.name} to prevent accidental edits`
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        editorStore.dispatch({ type: 'toggleLock', ids: [screen.id] })
                      }}
                    />
                  </div>
                </div>
                {renamingId === screen.id ? (
                  <div className="row" style={{ padding: '0 var(--space-4) var(--space-3)' }}>
                    <Button
                      size="sm"
                      onClick={() => setRenamingId(null)}
                      tooltip="Finish renaming"
                    >
                      Done
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenamingId(null)
                        const previous = screen.name
                        setRenameDraft(previous)
                      }}
                      tooltip="Cancel renaming"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="row row--wrap">
            <Button size="sm" variant="ghost" icon="chevronUp" tooltip="Move the selection earlier in the draw order" disabled={state.selection.length === 0} onClick={() => move(-1)}>
              Move up
            </Button>
            <Button size="sm" variant="ghost" icon="chevronDown" tooltip="Move the selection later in the draw order" disabled={state.selection.length === 0} onClick={() => move(1)}>
              Move down
            </Button>
            <Badge tooltip="Screens drawn later appear above earlier ones">
              {framesPerSecondLabel(screens)}
            </Badge>
          </div>
        </>
      )}

      {state.project ? (
        <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          <Icon name="info" size={12} /> Duplicating a screen always creates a new stable id; mapping regions are
          copied but never shared.
        </p>
      ) : null}
    </Panel>
  )
}

function framesPerSecondLabel(screens: Screen[]): string {
  const total = screens.reduce((sum, screen) => sum + screen.pixelWidth * screen.pixelHeight, 0)
  if (total === 0) return '0 px total'
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)} MP total`
  return `${Math.round(total / 1000)} K px total`
}
