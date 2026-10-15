import { useEffect } from 'react'
import { NavRail, StatusBar, TitleBar, ToastHost, formatBytes } from './components/Shell'
import { Button, Callout, Icon, Modal, PanelSection, Segmented } from './components/ui'
import { useApp } from './state/AppState'
import { useEditor } from './state/AppState'
import { StageDesigner } from './features/stage/StageDesigner'
import { PixelMapping } from './features/mapping/PixelMapping'
import { NdiStudio } from './features/ndi/NdiStudio'
import { RecoveryList, Home, NewProjectWizard } from './features/home/Home'
import { Recording } from './features/recording/Recording'
import { Settings } from './features/settings/Settings'
import { Diagnostics } from './features/diagnostics/Diagnostics'
import { Help } from './features/help/Help'
import { SHORTCUT_ACTIONS, SHORTCUT_CATEGORIES, CANVAS_KEYS, formatAccelerator } from '@shared/shortcuts'
import { useMemo, useState } from 'react'

/**
 * Root application shell.
 *
 * Applies theme tokens, routes between workspaces and hosts the global dialogs. Nothing in
 * this component holds domain state: it reads `AppState` and renders the active workspace.
 */

export function App(): JSX.Element {
  const app = useApp()
  const editor = useEditor()
  const { workspace, settings, info, modal, closeModal, command } = app
  const [aboutTab, setAboutTab] = useState<'about' | 'shortcuts'>('about')

  // Theme + accent are applied as CSS custom properties on the root element.
  useEffect(() => {
    const root = document.documentElement
    const resolved =
      settings.theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : settings.theme
    root.dataset.theme = resolved
    root.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false'
    root.style.setProperty('--accent', settings.accent)
  }, [settings.accent, settings.reduceMotion, settings.theme])

  useEffect(() => {
    if (!settings.reduceMotion) return
    const listener = (): void => undefined
    window.addEventListener('transitionend', listener)
    return () => window.removeEventListener('transitionend', listener)
  }, [settings.reduceMotion])

  // Global clipboard-of-diagnostics shortcut, available from any workspace.
  useEffect(() => {
    const handler = (): void => command('help.copyDiagnostics')
    window.addEventListener('cuepoint:copy-diagnostics', handler)
    return () => window.removeEventListener('cuepoint:copy-diagnostics', handler)
  }, [command])

  const shortcuts = useMemo(
    () => SHORTCUT_ACTIONS.map((action) => ({ ...action, current: settings.shortcuts[action.id] ?? action.default })),
    [settings.shortcuts]
  )

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <NavRail collapsed={app.panels.left} />
        <main className="app-main">
          {workspace === 'home' ? <Home /> : null}
          {workspace === 'stage' ? <StageDesigner state={editor} /> : null}
          {workspace === 'mapping' ? <PixelMapping state={editor} /> : null}
          {workspace === 'ndi' ? <NdiStudio /> : null}
          {workspace === 'recording' ? <Recording state={editor} /> : null}
          {workspace === 'settings' ? <Settings /> : null}
          {workspace === 'diagnostics' ? <Diagnostics /> : null}
          {workspace === 'help' ? <Help /> : null}
        </main>
      </div>
      <StatusBar />
      <ToastHost />

      {modal?.kind === 'new-project' ? (
        <NewProjectWizard
          onClose={() => {
            closeModal()
          }}
        />
      ) : null}

      {modal?.kind === 'confirm' ? (
        <Modal
          title={modal.title}
          onClose={closeModal}
          footer={
            <>
              <div className="spacer" />
              <Button onClick={closeModal}>Cancel</Button>
              <Button variant="primary" onClick={modal.onConfirm}>
                {modal.confirmLabel}
              </Button>
            </>
          }
        >
          <p>{modal.message}</p>
          {modal.detail ? (
            <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>
              {modal.detail}
            </pre>
          ) : null}
        </Modal>
      ) : null}

      {modal?.kind === 'recovery' ? (
        <Modal
          title="Recovery snapshots"
          wide
          onClose={closeModal}
          footer={
            <>
              <span className="muted">
                Restoring copies the snapshot over the project file. The previous file is kept as
                <span className="mono"> .pre-restore.bak</span>.
              </span>
              <div className="spacer" />
              <Button onClick={closeModal}>Close</Button>
            </>
          }
        >
          <RecoveryList
            snapshots={app.projects.snapshots}
            onRestore={(id) => void app.projects.restoreSnapshot(id)}
            onDelete={(id) => void app.projects.deleteSnapshot(id)}
          />
        </Modal>
      ) : null}

      {modal?.kind === 'project-properties' ? (
        <Modal
          title="Project properties"
          onClose={closeModal}
          footer={
            <>
              <div className="spacer" />
              <Button variant="primary" onClick={closeModal}>
                Done
              </Button>
            </>
          }
        >
          {editor.project ? (
            <>
              <dl className="kv">
                <dt>Name</dt>
                <dd>{editor.project.meta.name}</dd>
                <dt>Author</dt>
                <dd>{editor.project.meta.author || '—'}</dd>
                <dt>Project id</dt>
                <dd className="mono">{editor.project.meta.id}</dd>
                <dt>Schema version</dt>
                <dd className="mono">v{editor.project.schemaVersion}</dd>
                <dt>Created</dt>
                <dd>{new Date(editor.project.meta.createdAt).toLocaleString()}</dd>
                <dt>Last modified (in memory)</dt>
                <dd>{new Date(editor.project.meta.updatedAt).toLocaleString()}</dd>
                <dt>File</dt>
                <dd className="mono truncate">{editor.path ?? 'not saved yet'}</dd>
                <dt>Stage</dt>
                <dd>
                  {editor.project.stage.name} · {(editor.project.stage.widthMm / 1000).toFixed(2)} m ×{' '}
                  {(editor.project.stage.heightMm / 1000).toFixed(2)} m
                </dd>
                <dt>Screens</dt>
                <dd>{editor.project.screens.length}</dd>
                <dt>Outputs</dt>
                <dd>{editor.project.outputs.length}</dd>
                <dt>Autosave</dt>
                <dd>
                  {editor.project.settings.autosaveEnabled
                    ? `every ${Math.round(editor.project.settings.autosaveIntervalMs / 1000)} s`
                    : 'disabled'}
                </dd>
                <dt>Bytes in memory</dt>
                <dd>{formatBytes(JSON.stringify(editor.project).length)}</dd>
              </dl>
              <div className="row row--wrap">
                <Button
                  size="sm"
                  icon="folder"
                  tooltip="Reveal the project folder in File Explorer"
                  disabled={!editor.path}
                  onClick={() => command('file.revealProject')}
                >
                  Reveal folder
                </Button>
                <Button size="sm" variant="ghost" icon="save" tooltip="Save the project (Ctrl+S)" onClick={() => void app.saveProject()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" icon="export" tooltip="Open Pixel Mapping to export" onClick={() => app.goTo('mapping')}>
                  Export maps
                </Button>
              </div>
            </>
          ) : (
            <Callout tone="info">No project is open.</Callout>
          )}
        </Modal>
      ) : null}

      {modal?.kind === 'about' || modal?.kind === 'shortcuts' ? (
        <Modal
          title={modal.kind === 'about' ? 'About CuePoint' : 'Keyboard shortcuts'}
          wide
          onClose={closeModal}
          footer={
            <>
              <div className="spacer" />
              <Button variant="primary" onClick={closeModal}>
                Close
              </Button>
            </>
          }
        >
          <Segmented
            label=""
            value={modal.kind === 'about' || aboutTab === 'about' ? 'about' : 'shortcuts'}
            options={[
              { value: 'about', label: 'About' },
              { value: 'shortcuts', label: 'Shortcuts' }
            ]}
            onChange={(value) => {
              if (value === 'shortcuts' && modal.kind === 'about') {
                closeModal()
                command('help.shortcuts')
                return
              }
              setAboutTab(value as 'about' | 'shortcuts')
            }}
          />
          {modal.kind === 'about' ? (
            <>
              <div className="row">
                <img src="./logo-64.png" alt="CuePoint" width={64} height={64} />
                <div className="column">
                  <h2 className="section-title">CuePoint {info?.version ?? ''}</h2>
                  <p className="section-subtitle">
                    LED stage design, pixel mapping, NDI preview and recording for Windows.
                  </p>
                </div>
              </div>
              <dl className="kv">
                <dt>Author</dt>
                <dd>{info?.author ?? 'Sandila Fernando'}</dd>
                <dt>Copyright</dt>
                <dd>{info?.copyright ?? '© 2026 Sandila Fernando'}</dd>
                <dt>Electron / Chromium / Node</dt>
                <dd className="mono">
                  {info?.electron ?? '—'} / {info?.chrome ?? '—'} / {info?.node ?? '—'}
                </dd>
                <dt>Licence</dt>
                <dd>{info?.license ?? 'Proprietary'}</dd>
              </dl>
              <Callout tone="info" title="Local-first by design">
                CuePoint stores projects as plain files, requires no account, sends no telemetry and makes no network
                requests except optional local NDI discovery.
              </Callout>
            </>
          ) : (
            <>
              <PanelSection title="Application shortcuts">
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Action</th>
                        <th scope="col">Shortcut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortcuts.map((action) => (
                        <tr key={action.id}>
                          <td>
                            <div className="column" style={{ gap: 2 }}>
                              <span>{action.label}</span>
                              <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
                                {action.category} · {action.description}
                              </span>
                            </div>
                          </td>
                          <td className="mono nowrap">{formatAccelerator(action.current)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </PanelSection>
              <PanelSection title="Canvas and mouse">
                <div className="table-scroll">
                  <table className="table">
                    <tbody>
                      {CANVAS_KEYS.map((entry) => (
                        <tr key={entry.keys}>
                          <td className="mono nowrap">{entry.keys}</td>
                          <td>{entry.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </PanelSection>
              <p className="muted">
                <Icon name="info" size={12} /> Shortcuts are configurable in Settings → Keyboard shortcuts. Categories
                covered: {SHORTCUT_CATEGORIES.join(', ')}.
              </p>
            </>
          )}
        </Modal>
      ) : null}
    </div>
  )
}
