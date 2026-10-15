import { useEffect, useState } from 'react'
import { Badge, Icon, IconButton, StatusDot, type IconName } from './ui'
import { useApp, type WorkspaceId } from '../state/AppState'
import { formatAccelerator } from '@shared/shortcuts'

/**
 * Application shell: title bar, navigation rail, workspace toolbar, status bar and the
 * toast host. The shell owns no domain logic — it renders `AppState` and forwards user
 * intent back through commands.
 */

const NAV_ITEMS: { id: WorkspaceId; label: string; icon: IconName; hint: string }[] = [
  { id: 'home', label: 'Home', icon: 'home', hint: 'Projects, recent files and recovery. Alt+1' },
  { id: 'stage', label: 'Stage Designer', icon: 'stage', hint: 'Lay out LED screens on the stage. Alt+2' },
  { id: 'mapping', label: 'Pixel Mapping', icon: 'mapping', hint: 'Assign screens to outputs and export maps. Alt+3' },
  { id: 'ndi', label: 'NDI Studio', icon: 'ndi', hint: 'Discover and preview live NDI sources. Alt+4' },
  { id: 'recording', label: 'Recording', icon: 'record', hint: 'Capture the stage or a source to a video file. Alt+5' },
  { id: 'settings', label: 'Settings', icon: 'settings', hint: 'Appearance, grid, NDI, recording and export defaults. Alt+6' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', hint: 'Runtime, storage, database and log status. Alt+7' },
  { id: 'help', label: 'Help', icon: 'help', hint: 'User manual, shortcuts and troubleshooting. Alt+8' }
]

export function TitleBar(): JSX.Element {
  const { editor, panels, togglePanel, command } = useApp()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.cuepoint
    if (!api) return
    void api.app.isMaximized().then((result) => {
      if (result.ok) setMaximized(result.data)
    })
  }, [])

  const projectName = editor.project ? editor.project.meta.name : 'No project open'
  const saveLabel = editor.path
    ? editor.dirty
      ? 'Unsaved changes'
      : `Saved ${editor.savedAt ? new Date(editor.savedAt).toLocaleTimeString() : ''}`.trim()
    : 'Not saved yet'

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <img className="titlebar__logo" src="./logo-64.png" alt="CuePoint logo" width={22} height={22} />
        <span className="titlebar__product">CuePoint</span>
      </div>
      <div className="titlebar__divider" />
      <div className="titlebar__project">
        <span className="titlebar__project-name" title={editor.path ?? 'This project has not been saved to disk yet.'}>
          {projectName}
        </span>
        <Badge
          tone={editor.path ? (editor.dirty ? 'warning' : 'success') : 'neutral'}
          tooltip={saveLabel}
        >
          {editor.path ? (editor.dirty ? 'Modified' : 'Saved') : 'Unsaved'}
        </Badge>
      </div>
      <div className="titlebar__spacer" />
      <div className="titlebar__status">
        <IconButton
          icon="save"
          label={editor.path ? 'Save project (Ctrl+S)' : 'Save project to a new file (Ctrl+S)'}
          disabled={!editor.project}
          onClick={() => command('file.save')}
        />
        <IconButton
          icon={panels.left ? 'chevronRight' : 'chevronDown'}
          label={panels.left ? 'Collapse navigation panel (Ctrl+B)' : 'Show navigation panel (Ctrl+B)'}
          onClick={() => togglePanel('left')}
        />
        <IconButton
          icon="info"
          label="About CuePoint"
          onClick={() => command('help.about')}
        />
      </div>
      <div className="titlebar__window-controls">
        <IconButton icon="minimize" label="Minimise window" onClick={() => void window.cuepoint?.app.window('minimize')} />
        <IconButton
          icon={maximized ? 'restore' : 'maximize'}
          label={maximized ? 'Restore window' : 'Maximise window'}
          onClick={() => {
            void window.cuepoint?.app.window('maximize')
            setMaximized((value) => !value)
          }}
        />
        <IconButton icon="close" label="Close CuePoint" onClick={() => void window.cuepoint?.app.window('close')} />
      </div>
    </header>
  )
}

export function NavRail({ collapsed }: { collapsed: boolean }): JSX.Element {
  const { workspace, goTo, ndi, recording, editor } = useApp()
  const connected = ndi.stats.filter((stat) => stat.connected).length
  const recordingState = recording.status?.state ?? 'idle'

  const badgeFor = (id: WorkspaceId): string | null => {
    if (id === 'ndi' && connected > 0) return String(connected)
    if (id === 'stage' && editor.project) return String(editor.project.screens.length)
    if (id === 'recording' && (recordingState === 'recording' || recordingState === 'paused')) return 'REC'
    return null
  }

  return (
    <nav className={collapsed ? 'nav-rail expanded' : 'nav-rail'} aria-label="Workspaces">
      {NAV_ITEMS.map((item) => {
        const badge = badgeFor(item.id)
        return (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={workspace === item.id ? 'page' : undefined}
            title={item.hint}
            data-tooltip={item.hint}
            onClick={() => goTo(item.id)}
          >
            <Icon name={item.icon} size={18} />
            <span className="nav-item__label">{item.label}</span>
            {badge ? <span className="nav-item__badge">{badge}</span> : null}
          </button>
        )
      })}
      <div className="nav-rail__footer">
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <StatusDot
            tone={ndi.runtime?.available ? (connected > 0 ? 'ok' : 'idle') : 'warn'}
            label={
              ndi.runtime?.available
                ? ndi.runtime.helperRunning
                  ? 'NDI runtime detected, helper running'
                  : 'NDI runtime detected, helper stopped'
                : 'NDI runtime not detected'
            }
          />
          <span>
            NDI {ndi.runtime?.runtimeVersion ?? 'not detected'}
            <br />
            Helper {ndi.runtime?.helperRunning ? `pid ${ndi.runtime.helperPid ?? '—'}` : 'stopped'}
          </span>
        </div>
      </div>
    </nav>
  )
}

export function WorkspaceToolbar(): JSX.Element {
  return <div className="toolbar" />
}

export function StatusBar(): JSX.Element {
  const { editor, ndi, recording, info, command } = useApp()
  const connected = ndi.stats.filter((stat) => stat.connected).length
  const state = recording.status?.state ?? 'idle'

  const saveState = !editor.project
    ? { tone: 'idle' as const, text: 'No project open' }
    : editor.dirty
      ? { tone: 'warn' as const, text: 'Unsaved changes' }
      : { tone: 'ok' as const, text: `Saved${editor.savedAt ? ` ${new Date(editor.savedAt).toLocaleTimeString()}` : ''}` }

  const recordingText =
    state === 'recording'
      ? `Recording ${formatDuration(recording.status?.elapsedMs ?? 0)}`
      : state === 'paused'
        ? 'Recording paused'
        : state === 'finalizing'
          ? 'Finalising recording…'
          : 'Idle'

  return (
    <footer className="statusbar">
      <div className="statusbar__item" title="Project save state">
        <StatusDot tone={saveState.tone} label={saveState.text} />
        <span className="statusbar__label">Project</span>
        <span className="statusbar__value">{saveState.text}</span>
      </div>

      <div className="statusbar__item" title={editor.autosaveAt ? `Autosave recovery snapshot written at ${new Date(editor.autosaveAt).toLocaleTimeString()}` : 'Autosave writes periodic recovery snapshots'}>
        <Icon name="save" size={12} />
        <span className="statusbar__label">Autosave</span>
        <span className="statusbar__value">
          {editor.project?.settings.autosaveEnabled
            ? `${Math.round((editor.project.settings.autosaveIntervalMs ?? 30_000) / 1000)}s`
            : 'off'}
        </span>
      </div>

      <div className="statusbar__item" title="Screens on the stage">
        <Icon name="screen" size={12} />
        <span className="statusbar__label">Screens</span>
        <span className="statusbar__value">{editor.project?.screens.length ?? 0}</span>
      </div>

      <div className="statusbar__item" title="Canvas zoom (does not change stored geometry)">
        <Icon name="zoomIn" size={12} />
        <span className="statusbar__value">{Math.round(editor.view.zoom * 100)}%</span>
      </div>

      <div className="statusbar__item" title="NDI helper and connected sources">
        <StatusDot
          tone={!ndi.runtime?.available ? 'warn' : connected > 0 ? 'ok' : 'idle'}
          label={!ndi.runtime?.available ? 'NDI runtime unavailable' : `${connected} NDI source(s) connected`}
        />
        <span className="statusbar__label">NDI</span>
        <span className="statusbar__value">
          {!ndi.runtime?.available ? 'unavailable' : connected > 0 ? `${connected} connected` : 'no sources'}
        </span>
      </div>

      <div className="statusbar__item" title="Recording state">
        <StatusDot tone={state === 'recording' ? 'live' : state === 'paused' ? 'warn' : 'idle'} label={recordingText} />
        <span className="statusbar__label">Recording</span>
        <span className="statusbar__value">{recordingText}</span>
      </div>

      <div className="statusbar__spacer" />

      <button
        type="button"
        className="statusbar__item btn btn--ghost btn--small"
        title="Open Diagnostics"
        onClick={() => command('tools.diagnostics')}
      >
        <Icon name="activity" size={12} />
        <span className="statusbar__label">Diagnostics</span>
      </button>

      <span className="statusbar__value">{info ? `v${info.version}` : ''}</span>

      {/* Deliberately quiet product credit. */}
      <span className="statusbar__credit" title="CuePoint © 2026 Sandila Fernando">
        © 2026 Sandila Fernando
      </span>
    </footer>
  )
}

export function ToastHost(): JSX.Element | null {
  const { toasts, dismissToast } = useApp()

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.timeoutMs > 0)
      .map((toast) =>
        setTimeout(() => {
          dismissToast(toast.id)
        }, toast.timeoutMs)
      )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [toasts, dismissToast])

  if (toasts.length === 0) return null

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.level}`}>
          <Icon
            name={toast.level === 'error' || toast.level === 'warning' ? 'alert' : toast.level === 'success' ? 'check' : 'info'}
            size={15}
          />
          <div className="toast__content">
            <p className="toast__message">{toast.message}</p>
            {toast.detail ? <p className="toast__detail">{toast.detail}</p> : null}
          </div>
          <IconButton icon="close" label="Dismiss notification" size="sm" onClick={() => dismissToast(toast.id)} />
        </div>
      ))}
    </div>
  )
}

export function ToolbarButtonHint(id: string): string {
  return formatAccelerator(id)
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
