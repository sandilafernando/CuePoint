/**
 * Keyboard shortcut catalog.
 *
 * `owner` decides who executes the action:
 *  - 'main'     : registered as a real Electron menu accelerator.
 *  - 'renderer' : shown in menus but *not* registered globally, so normal text
 *                 editing inside inputs keeps working. The renderer handles the key
 *                 and only acts when focus is not inside a text field.
 */

export type ShortcutOwner = 'main' | 'renderer'

export type ShortcutCategory =
  | 'File'
  | 'Edit'
  | 'View'
  | 'Tools'
  | 'Screens'
  | 'NDI'
  | 'Recording'
  | 'Help'

export interface ShortcutAction {
  id: string
  label: string
  description: string
  default: string
  category: ShortcutCategory
  owner: ShortcutOwner
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  // File
  { id: 'file.new', label: 'New Project', description: 'Create a new CuePoint project.', default: 'CmdOrCtrl+N', category: 'File', owner: 'main' },
  { id: 'file.open', label: 'Open Project', description: 'Open an existing CuePoint project file.', default: 'CmdOrCtrl+O', category: 'File', owner: 'main' },
  { id: 'file.save', label: 'Save', description: 'Save the current project to disk.', default: 'CmdOrCtrl+S', category: 'File', owner: 'main' },
  { id: 'file.saveAs', label: 'Save As', description: 'Save the project to a new file.', default: 'CmdOrCtrl+Shift+S', category: 'File', owner: 'main' },
  { id: 'file.importBackground', label: 'Import Background', description: 'Load a stage photograph as the stage background.', default: 'CmdOrCtrl+Shift+I', category: 'File', owner: 'main' },
  { id: 'file.export', label: 'Export Maps', description: 'Export pixel maps, guides and data.', default: 'CmdOrCtrl+E', category: 'File', owner: 'main' },
  { id: 'file.projectProperties', label: 'Project Properties', description: 'Edit project name, author and stage dimensions.', default: 'CmdOrCtrl+Alt+P', category: 'File', owner: 'main' },
  { id: 'file.revealProject', label: 'Reveal Project Folder', description: 'Open the project folder in File Explorer.', default: 'CmdOrCtrl+Alt+R', category: 'File', owner: 'main' },
  { id: 'app.exit', label: 'Exit', description: 'Close CuePoint.', default: 'Alt+F4', category: 'File', owner: 'main' },

  // Edit
  { id: 'edit.undo', label: 'Undo', description: 'Undo the last stage change.', default: 'CmdOrCtrl+Z', category: 'Edit', owner: 'renderer' },
  { id: 'edit.redo', label: 'Redo', description: 'Redo the last undone change.', default: 'CmdOrCtrl+Shift+Z', category: 'Edit', owner: 'renderer' },
  { id: 'edit.cut', label: 'Cut', description: 'Cut the selected screens.', default: 'CmdOrCtrl+X', category: 'Edit', owner: 'renderer' },
  { id: 'edit.copy', label: 'Copy', description: 'Copy the selected screens.', default: 'CmdOrCtrl+C', category: 'Edit', owner: 'renderer' },
  { id: 'edit.paste', label: 'Paste', description: 'Paste screens from the clipboard.', default: 'CmdOrCtrl+V', category: 'Edit', owner: 'renderer' },
  { id: 'edit.duplicate', label: 'Duplicate', description: 'Duplicate the selected screens.', default: 'CmdOrCtrl+D', category: 'Edit', owner: 'renderer' },
  { id: 'edit.selectAll', label: 'Select All', description: 'Select every screen on the stage.', default: 'CmdOrCtrl+A', category: 'Edit', owner: 'renderer' },
  { id: 'edit.clearSelection', label: 'Clear Selection', description: 'Deselect all screens and cancel the active drag.', default: 'Escape', category: 'Edit', owner: 'renderer' },
  { id: 'edit.delete', label: 'Delete', description: 'Delete the selected screens (undoable).', default: 'Delete', category: 'Edit', owner: 'renderer' },
  { id: 'edit.preferences', label: 'Settings', description: 'Open CuePoint settings.', default: 'CmdOrCtrl+,', category: 'Edit', owner: 'main' },

  // View
  { id: 'view.zoomIn', label: 'Zoom In', description: 'Zoom the canvas in.', default: 'CmdOrCtrl+=', category: 'View', owner: 'main' },
  { id: 'view.zoomOut', label: 'Zoom Out', description: 'Zoom the canvas out.', default: 'CmdOrCtrl+-', category: 'View', owner: 'main' },
  { id: 'view.fitStage', label: 'Fit Stage', description: 'Zoom the canvas to show the complete stage.', default: 'CmdOrCtrl+0', category: 'View', owner: 'main' },
  { id: 'view.fitSelection', label: 'Fit Selection', description: 'Zoom the canvas to the selected screens.', default: 'CmdOrCtrl+Shift+0', category: 'View', owner: 'main' },
  { id: 'view.resetView', label: 'Reset View', description: 'Restore 100% zoom and the origin.', default: 'CmdOrCtrl+Alt+0', category: 'View', owner: 'main' },
  { id: 'view.toggleGrid', label: 'Show Grid', description: 'Show or hide the stage grid.', default: 'CmdOrCtrl+G', category: 'View', owner: 'main' },
  { id: 'view.toggleSnap', label: 'Snap to Grid', description: 'Enable or disable snapping.', default: 'CmdOrCtrl+Shift+G', category: 'View', owner: 'main' },
  { id: 'view.toggleGuides', label: 'Show Guides', description: 'Show or hide alignment guides.', default: 'CmdOrCtrl+;', category: 'View', owner: 'main' },
  { id: 'view.toggleLeftPanel', label: 'Toggle Left Panel', description: 'Show or hide the navigation panel.', default: 'CmdOrCtrl+B', category: 'View', owner: 'main' },
  { id: 'view.toggleInspector', label: 'Toggle Inspector', description: 'Show or hide the property inspector.', default: 'CmdOrCtrl+Shift+B', category: 'View', owner: 'main' },
  { id: 'view.fullscreen', label: 'Fullscreen', description: 'Toggle fullscreen window mode.', default: 'F11', category: 'View', owner: 'main' },

  // Tools
  { id: 'tools.home', label: 'Home', description: 'Open the Home workspace.', default: 'Alt+1', category: 'Tools', owner: 'main' },
  { id: 'tools.stageDesigner', label: 'Stage Designer', description: 'Open the Stage Designer workspace.', default: 'Alt+2', category: 'Tools', owner: 'main' },
  { id: 'tools.pixelMapping', label: 'Pixel Mapping', description: 'Open the Pixel Mapping workspace.', default: 'Alt+3', category: 'Tools', owner: 'main' },
  { id: 'tools.ndiStudio', label: 'NDI Studio', description: 'Open the NDI Studio workspace.', default: 'Alt+4', category: 'Tools', owner: 'main' },
  { id: 'tools.recording', label: 'Recording', description: 'Open the Recording workspace.', default: 'Alt+5', category: 'Tools', owner: 'main' },
  { id: 'tools.settings', label: 'Settings', description: 'Open Settings.', default: 'Alt+6', category: 'Tools', owner: 'main' },
  { id: 'tools.diagnostics', label: 'Diagnostics', description: 'Open the diagnostics dashboard.', default: 'Alt+7', category: 'Tools', owner: 'main' },
  { id: 'tools.help', label: 'Help', description: 'Open Help and documentation.', default: 'Alt+8', category: 'Tools', owner: 'main' },
  { id: 'tools.validateProject', label: 'Validate Project', description: 'Run project validation and show the report.', default: 'F7', category: 'Tools', owner: 'main' },
  { id: 'tools.validateMapping', label: 'Validate Mapping', description: 'Run mapping validation and show the report.', default: 'Shift+F7', category: 'Tools', owner: 'main' },

  // Screens
  { id: 'screen.add', label: 'Add Screen', description: 'Add a new LED screen to the stage.', default: 'CmdOrCtrl+Shift+N', category: 'Screens', owner: 'main' },
  { id: 'screen.rename', label: 'Rename Screen', description: 'Rename the selected screen.', default: 'F2', category: 'Screens', owner: 'renderer' },
  { id: 'screen.lock', label: 'Lock Screen', description: 'Prevent the selected screens from being moved, resized or rotated.', default: 'CmdOrCtrl+L', category: 'Screens', owner: 'main' },
  { id: 'screen.hide', label: 'Hide Screen', description: 'Hide the selected screens on the stage.', default: 'CmdOrCtrl+Shift+H', category: 'Screens', owner: 'main' },
  { id: 'screen.duplicate', label: 'Duplicate Screen', description: 'Duplicate the selected screens with new identifiers.', default: 'CmdOrCtrl+Shift+D', category: 'Screens', owner: 'main' },

  // NDI
  { id: 'ndi.refresh', label: 'Refresh NDI Sources', description: 'Re-scan the network for NDI sources.', default: 'F5', category: 'NDI', owner: 'main' },
  { id: 'ndi.connect', label: 'Connect Selected Source', description: 'Connect the highlighted NDI source.', default: 'CmdOrCtrl+Enter', category: 'NDI', owner: 'main' },
  { id: 'ndi.disconnectAll', label: 'Disconnect All Sources', description: 'Disconnect every NDI source without stopping others.', default: 'CmdOrCtrl+Shift+Enter', category: 'NDI', owner: 'main' },

  // Recording
  { id: 'recording.start', label: 'Start Recording', description: 'Begin capturing the selected target.', default: 'F9', category: 'Recording', owner: 'main' },
  { id: 'recording.stop', label: 'Stop Recording', description: 'Stop capture and finalise the recording file.', default: 'Shift+F9', category: 'Recording', owner: 'main' },
  { id: 'recording.openFolder', label: 'Open Output Folder', description: 'Open the recording output folder.', default: 'CmdOrCtrl+Alt+O', category: 'Recording', owner: 'main' },

  // Help
  { id: 'help.manual', label: 'User Manual', description: 'Open the CuePoint user manual.', default: 'F1', category: 'Help', owner: 'main' },
  { id: 'help.shortcuts', label: 'Keyboard Shortcuts', description: 'Show the shortcut reference.', default: 'Shift+F1', category: 'Help', owner: 'main' },
  { id: 'help.troubleshooting', label: 'Troubleshooting', description: 'Open the troubleshooting guide.', default: 'Shift+F2', category: 'Help', owner: 'main' },
  { id: 'help.copyDiagnostics', label: 'Copy Diagnostic Report', description: 'Copy a full diagnostic report to the clipboard.', default: 'CmdOrCtrl+Shift+C', category: 'Help', owner: 'main' },
  { id: 'help.openLogs', label: 'Open Logs Folder', description: 'Open the CuePoint log folder.', default: 'CmdOrCtrl+Shift+L', category: 'Help', owner: 'main' },
  { id: 'help.about', label: 'About CuePoint', description: 'Show version and licence information.', default: 'Shift+F3', category: 'Help', owner: 'main' }
]

export const DEFAULT_SHORTCUTS: Record<string, string> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((action) => [action.id, action.default])
)

export const SHORTCUT_BY_ID: Record<string, ShortcutAction> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((action) => [action.id, action])
)

export const SHORTCUT_CATEGORIES: readonly ShortcutCategory[] = [
  'File',
  'Edit',
  'View',
  'Tools',
  'Screens',
  'NDI',
  'Recording',
  'Help'
]

/** Renderer-only keys documented in Help but not part of the menu accelerator table. */
export const CANVAS_KEYS: readonly { keys: string; description: string }[] = [
  { keys: 'Arrow keys', description: 'Nudge the selected screens by 10 mm.' },
  { keys: 'Shift + Arrow keys', description: 'Nudge the selected screens by 100 mm.' },
  { keys: 'Alt + Arrow keys', description: 'Nudge the selected screens by 1 mm.' },
  { keys: 'Middle mouse drag', description: 'Pan the stage canvas.' },
  { keys: 'Space + drag', description: 'Pan the stage canvas.' },
  { keys: 'Mouse wheel', description: 'Zoom the canvas around the pointer.' },
  { keys: 'Shift + Mouse wheel', description: 'Pan the canvas horizontally.' },
  { keys: 'Ctrl + click', description: 'Add or remove a screen from the selection.' },
  { keys: 'Shift + click', description: 'Extend the selection to the clicked screen.' },
  { keys: 'Shift while dragging', description: 'Constrain movement to the dominant axis.' },
  { keys: 'Ctrl while resizing', description: 'Keep the screen aspect ratio.' },
  { keys: 'Right click', description: 'Open the screen context menu.' }
]

/** Human readable label for an accelerator, e.g. "Ctrl+Shift+S". */
export function formatAccelerator(accelerator: string, platform: 'win' | 'mac' | 'linux' = 'win'): string {
  if (!accelerator) return ''
  const parts = accelerator.split('+').map((part) => {
    const key = part.trim()
    switch (key) {
      case 'CmdOrCtrl':
      case 'CommandOrControl':
        return platform === 'mac' ? '⌘' : 'Ctrl'
      case 'Cmd':
      case 'Command':
        return '⌘'
      case 'Shift':
        return platform === 'mac' ? '⇧' : 'Shift'
      case 'Alt':
        return platform === 'mac' ? '⌥' : 'Alt'
      case 'Delete':
      case 'Del':
        return 'Del'
      case 'Escape':
      case 'Esc':
        return 'Esc'
      default:
        return key.length === 1 ? key.toUpperCase() : key
    }
  })
  return parts.join(platform === 'mac' ? '' : '+')
}
