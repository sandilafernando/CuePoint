import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { SHORTCUT_BY_ID } from '@shared/shortcuts'
import { IPC } from '@shared/ipc'

export interface MenuContext {
  getWindow: () => BrowserWindow | null
  getState: () => {
    canUndo: boolean
    canRedo: boolean
    hasSelection: boolean
    selectionCount: number
    dirty: boolean
    hasProject: boolean
    gridVisible: boolean
    snapEnabled: boolean
    guidesVisible: boolean
    leftPanelVisible: boolean
    inspectorVisible: boolean
    isFullScreen: boolean
    recording: boolean
    ndiConnected: number
  }
  runCommand: (command: string) => void
}

/**
 * Builds the native application menu.
 *
 * Menu items call back into `runCommand`, which dispatches the command to the renderer
 * (single source of truth for workspace state) or handles it in the main process.
 *
 * Actions marked `owner: 'renderer'` in the shortcut catalog are registered with
 * `registerAccelerator: false`: the accelerator is still displayed, but the key is left
 * to the renderer so normal text editing inside inputs keeps working.
 */
export function buildApplicationMenu(context: MenuContext): Menu {
  const item = (id: string): MenuItemConstructorOptions => {
    const action = SHORTCUT_BY_ID[id]
    const accelerator = action?.default
    return {
      label: action?.label ?? id,
      accelerator,
      registerAccelerator: action?.owner !== 'renderer',
      click: () => context.runCommand(id)
    }
  }

  const state = context.getState()

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        item('file.new'),
        item('file.open'),
        { type: 'separator' },
        { ...item('file.save'), enabled: state.hasProject },
        { ...item('file.saveAs'), enabled: state.hasProject },
        { type: 'separator' },
        item('file.importBackground'),
        { ...item('file.export'), enabled: state.hasProject },
        { type: 'separator' },
        { ...item('file.projectProperties'), enabled: state.hasProject },
        { ...item('file.revealProject'), enabled: state.hasProject },
        { type: 'separator' },
        { role: 'quit', label: 'Exit', accelerator: 'Alt+F4' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { ...item('edit.undo'), enabled: state.canUndo },
        { ...item('edit.redo'), enabled: state.canRedo },
        { type: 'separator' },
        item('edit.cut'),
        item('edit.copy'),
        item('edit.paste'),
        item('edit.duplicate'),
        { ...item('edit.delete'), enabled: state.hasSelection },
        { type: 'separator' },
        item('edit.selectAll'),
        { ...item('edit.clearSelection'), enabled: state.hasSelection },
        { type: 'separator' },
        item('edit.preferences')
      ]
    },
    {
      label: '&View',
      submenu: [
        item('view.zoomIn'),
        item('view.zoomOut'),
        item('view.fitStage'),
        item('view.fitSelection'),
        item('view.resetView'),
        { type: 'separator' },
        { ...item('view.toggleGrid'), type: 'checkbox', checked: state.gridVisible },
        { ...item('view.toggleSnap'), type: 'checkbox', checked: state.snapEnabled },
        { ...item('view.toggleGuides'), type: 'checkbox', checked: state.guidesVisible },
        { type: 'separator' },
        { ...item('view.toggleLeftPanel'), type: 'checkbox', checked: state.leftPanelVisible },
        { ...item('view.toggleInspector'), type: 'checkbox', checked: state.inspectorVisible },
        { type: 'separator' },
        { ...item('view.fullscreen'), type: 'checkbox', checked: state.isFullScreen }
      ]
    },
    {
      label: '&Tools',
      submenu: [
        item('tools.home'),
        item('tools.stageDesigner'),
        item('tools.pixelMapping'),
        item('tools.ndiStudio'),
        item('tools.recording'),
        { type: 'separator' },
        item('tools.settings'),
        item('tools.diagnostics'),
        item('tools.help'),
        { type: 'separator' },
        item('tools.validateProject'),
        item('tools.validateMapping')
      ]
    },
    {
      label: '&Screens',
      submenu: [
        item('screen.add'),
        { ...item('screen.rename'), enabled: state.selectionCount === 1 },
        item('screen.duplicate'),
        { ...item('screen.lock'), enabled: state.hasSelection },
        { ...item('screen.hide'), enabled: state.hasSelection },
        { type: 'separator' },
        item('edit.clearSelection')
      ]
    },
    {
      label: '&NDI',
      submenu: [
        item('ndi.refresh'),
        item('ndi.connect'),
        { ...item('ndi.disconnectAll'), enabled: state.ndiConnected > 0 }
      ]
    },
    {
      label: '&Recording',
      submenu: [
        { ...item('recording.start'), enabled: !state.recording },
        { ...item('recording.stop'), enabled: state.recording },
        { type: 'separator' },
        item('recording.openFolder')
      ]
    },
    {
      label: '&Help',
      submenu: [
        item('help.manual'),
        item('help.shortcuts'),
        item('help.troubleshooting'),
        { type: 'separator' },
        item('help.openLogs'),
        item('help.copyDiagnostics'),
        { type: 'separator' },
        item('help.about')
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

/** Channel used by the main process to tell the renderer to run a command. */
export const COMMAND_CHANNEL = IPC.events.command
