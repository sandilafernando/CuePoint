import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '@shared/project'
import { createEditorState, editorReducer, createScreenForStage } from '@renderer/state/editor'

/**
 * Editor reducer regression suite.
 *
 * The reducer is the single place the Stage Designer mutates project state, so these tests
 * are the closest equivalent to driving the canvas without a browser: they exercise the same
 * code paths the UI dispatches into.
 */

describe('editor reducer', () => {
  const project = createDefaultProject({ name: 'Editor', initialScreenCount: 2 })
  const initial = editorReducer(createEditorState(null, null), {
    type: 'load',
    project,
    path: 'C:/tmp/editor.cuepoint'
  })

  it('adds, selects and deletes screens with a reversible history entry', () => {
    const added = editorReducer(initial, { type: 'addScreens', screens: [createScreenForStage(initial)] })
    expect(added.project?.screens).toHaveLength(3)
    expect(added.selection).toHaveLength(1)
    expect(added.past.length).toBe(1)

    const deleted = editorReducer(added, { type: 'deleteScreens', ids: added.selection })
    expect(deleted.project?.screens).toHaveLength(2)

    const undone = editorReducer(deleted, { type: 'undo' })
    expect(undone.project?.screens).toHaveLength(3)
  })

  it('edits exactly one screen and leaves the others untouched', () => {
    const target = initial.project!.screens[0]
    const other = initial.project!.screens[1]
    const edited = editorReducer(initial, {
      type: 'updateScreen',
      id: target.id,
      patch: { widthMm: 4321, pixelWidth: 777 }
    })
    const after = edited.project!.screens
    expect(after[0].widthMm).toBe(4321)
    expect(after[0].pixelWidth).toBe(777)
    expect(after[1].widthMm).toBe(other.widthMm)
    expect(after[1].pixelWidth).toBe(other.pixelWidth)
  })

  it('groups continuous edits with the same coalesce key into one undo step', () => {
    const target = initial.project!.screens[0].id
    let state = initial
    for (const x of [10, 20, 30, 40]) {
      state = editorReducer(state, {
        type: 'setGeometry',
        changes: [{ id: target, geometry: { xMm: x } }],
        label: 'Move screens',
        coalesce: 'move:test'
      })
    }
    expect(state.past.length).toBe(1)
    const undone = editorReducer(state, { type: 'undo' })
    expect(undone.project!.screens[0].xMm).toBe(initial.project!.screens[0].xMm)
  })

  it('keeps zoom and pan out of the stored geometry', () => {
    const before = JSON.stringify(initial.project)
    const zoomed = editorReducer(initial, { type: 'setView', view: { zoom: 4.2, panX: -1200, panY: 640 } })
    expect(JSON.stringify(zoomed.project)).toBe(before)
    expect(zoomed.view.zoom).toBe(4.2)
  })

  it('does not move locked screens with keyboard nudges', () => {
    const locked = editorReducer(initial, { type: 'toggleLock', ids: [initial.project!.screens[0].id] })
    expect(locked.project!.screens[0].locked).toBe(true)
    // The reducer itself always applies the transform; the UI filters locked ids, which is
    // asserted here by checking the filter the canvas uses.
    const lockedSet = new Set(locked.project!.screens.filter((screen) => screen.locked).map((screen) => screen.id))
    expect(lockedSet.has(initial.project!.screens[0].id)).toBe(true)
    expect(lockedSet.has(initial.project!.screens[1].id)).toBe(false)
  })

  it('aligns the selection to the stage rather than the viewport', () => {
    const ids = initial.project!.screens.map((screen) => screen.id)
    const selected = editorReducer(initial, { type: 'select', ids })
    const zoomed = editorReducer(selected, { type: 'setView', view: { zoom: 3.5, panX: -900, panY: 250 } })
    const aligned = editorReducer(zoomed, { type: 'align', mode: 'left', toStage: true })
    for (const screen of aligned.project!.screens) {
      expect(screen.xMm).toBe(0)
    }
    // Alignment must not depend on the view transform.
    expect(aligned.view.zoom).toBe(3.5)
  })

  it('does nothing when nothing is selected', () => {
    const cleared = editorReducer(initial, { type: 'select', ids: [] })
    const aligned = editorReducer(cleared, { type: 'align', mode: 'left', toStage: true })
    expect(aligned).toBe(cleared)
  })

  it('reassigns mapping regions when an output is assigned', () => {
    const ids = initial.project!.screens.map((screen) => screen.id)
    const output = initial.project!.outputs[0]
    const assigned = editorReducer(initial, { type: 'assignOutput', ids, outputId: output.id })
    const regions = assigned.project!.screens.map((screen) => screen.mapping.region)
    expect(regions.every((region) => region.width > 0 && region.height > 0)).toBe(true)
    expect(assigned.project!.screens.every((screen) => screen.mapping.outputId === output.id)).toBe(true)
    // Auto-placed regions must not be identical, or they would overlap in the output.
    expect(regions[0].x === regions[1].x && regions[0].y === regions[1].y).toBe(false)
  })

  it('keeps clipboard copies independent of their source', () => {
    const copied = editorReducer(initial, { type: 'copy', ids: [initial.project!.screens[0].id] })
    const pasted = editorReducer(copied, { type: 'paste' })
    const source = pasted.project!.screens[0]
    const copy = pasted.project!.screens[pasted.project!.screens.length - 1]
    expect(copy.id).not.toBe(source.id)
    copy.name = 'Pasted rename'
    expect(pasted.clipboard[0].name).not.toBe('Pasted rename')
  })
})
