import { useCallback, useEffect, useState } from 'react'
import type { NewProjectRequest, RecoverySnapshot } from '@shared/appTypes'
import type { LengthUnit } from '@shared/types'
import { LENGTH_UNITS, UNIT_LABEL, toMm } from '@shared/units'
import { LIMITS } from '@shared/validation'
import { Badge, Button, Callout, EmptyState, Icon, IconButton, Modal, NumberField, Panel, PanelSection, SelectField, TextField } from '../../components/ui'
import { formatBytes } from '../../components/Shell'
import { useApp } from '../../state/AppState'

/**
 * Home workspace: create, open and manage projects.
 *
 * Removing a project from the recent list never touches the file — the confirmation text
 * says so explicitly, and the action only clears the library record.
 */

export function Home(): JSX.Element {
  const { projects, info, command, openModal, editor, goTo } = useApp()
  const [wizardOpen, setWizardOpen] = useState(false)

  // Depend on the refresh callbacks, not the whole `projects` object: the object identity
  // changes whenever the recents list updates, which would otherwise re-trigger this effect
  // forever and keep the renderer busy.
  const { refreshRecent, refreshSnapshots } = projects
  useEffect(() => {
    void refreshRecent()
    void refreshSnapshots()
  }, [refreshRecent, refreshSnapshots])

  const pinned = projects.recent.filter((entry) => entry.pinned)
  const others = projects.recent.filter((entry) => !entry.pinned)

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">Home</span>
        <Button variant="primary" icon="plus" tooltip="Create a new project (Ctrl+N)" onClick={() => setWizardOpen(true)}>
          New project
        </Button>
        <Button icon="folder" tooltip="Open an existing .cuepoint project (Ctrl+O)" onClick={() => command('file.open')}>
          Open project
        </Button>
        <Button
          icon="clock"
          tooltip="Browse autosave recovery snapshots"
          disabled={projects.snapshots.length === 0}
          onClick={() => openModal({ kind: 'recovery' })}
        >
          Recover project
        </Button>
        <div className="toolbar__spacer" />
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          tooltip="Re-read the project library from disk"
          onClick={() => {
            void projects.refreshRecent()
            void projects.refreshSnapshots()
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="scroll-area">
        <div>
          <h1 className="section-title">CuePoint</h1>
          <p className="section-subtitle">
            LED stage design, pixel mapping, NDI preview and recording — local-first, offline-capable, no accounts and
            no telemetry.
          </p>
        </div>

        <div className="grid-3">
          <div className="card">
            <span className="card__title">Current project</span>
            <span className="card__hint">
              {editor.project ? `${editor.project.meta.name} · ${editor.project.screens.length} screen(s)` : 'No project open'}
            </span>
            {editor.project ? (
              <Button size="sm" icon="stage" tooltip="Open the Stage Designer" onClick={() => goTo('stage')}>
                Continue editing
              </Button>
            ) : (
              <Button size="sm" icon="plus" tooltip="Create a project" onClick={() => setWizardOpen(true)}>
                Create a project
              </Button>
            )}
          </div>
          <div className="card">
            <span className="card__title">Recent projects</span>
            <span className="card__hint">{projects.recent.length} project(s) in your library</span>
            <span className="card__hint">Stored in {info?.userDataPath ?? 'your user data folder'}</span>
          </div>
          <div className="card">
            <span className="card__title">Recovery snapshots</span>
            <span className="card__hint">{projects.snapshots.length} snapshot(s) available</span>
            <Button
              size="sm"
              variant="ghost"
              icon="clock"
              tooltip="Open the recovery browser"
              disabled={projects.snapshots.length === 0}
              onClick={() => openModal({ kind: 'recovery' })}
            >
              Restore a snapshot
            </Button>
          </div>
        </div>

        {info && !info.packaged ? (
          <Callout tone="info" title="Development build">
            This is a development run of CuePoint {info.version}. Projects, settings and logs live in{' '}
            <span className="mono">{info.userDataPath}</span>.
          </Callout>
        ) : null}

        <Panel title="Projects" icon="folder">
          {projects.recent.length === 0 ? (
            <EmptyState
              icon="folder"
              title="No projects yet"
              message="Create your first project to lay out a stage. Nothing is uploaded anywhere — projects are plain files on your computer."
              actions={
                <Button variant="primary" icon="plus" onClick={() => setWizardOpen(true)}>
                  New project
                </Button>
              }
            />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Last opened</th>
                    <th scope="col">File</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pinned, ...others].map((entry) => (
                    <tr key={entry.path}>
                      <td>
                        <div className="row">
                          {entry.pinned ? <Icon name="check" size={12} /> : null}
                          <span className="truncate" title={entry.path}>
                            {entry.name}
                          </span>
                          {!entry.exists ? (
                            <Badge tone="danger" tooltip="The project file could not be found at this path">
                              missing
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="nowrap">{new Date(entry.openedAt).toLocaleString()}</td>
                      <td className="truncate mono" title={entry.path} style={{ maxWidth: 320 }}>
                        {entry.path}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="primary"
                          tooltip={`Open ${entry.name}`}
                          disabled={!entry.exists}
                          onClick={() => void projects.open(entry.path)}
                        >
                          Open
                        </Button>
                        <IconButton
                          size="sm"
                          icon={entry.pinned ? 'unlink' : 'link'}
                          label={entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name} to the top`}
                          onClick={() => void projects.pin(entry.path, !entry.pinned)}
                        />
                        <IconButton
                          size="sm"
                          icon="duplicate"
                          label={`Duplicate ${entry.name} into a new project folder`}
                          onClick={() => void projects.duplicate(entry.path)}
                        />
                        <IconButton
                          size="sm"
                          icon="external"
                          label={`Reveal ${entry.name} in File Explorer`}
                          onClick={() => void projects.reveal(entry.path)}
                        />
                        <IconButton
                          size="sm"
                          icon="trash"
                          label={`Remove ${entry.name} from the recent list (the file is not deleted)`}
                          onClick={() => {
                            openModal({
                              kind: 'confirm',
                              title: 'Remove from recent projects',
                              message: `Remove “${entry.name}” from the recent list?`,
                              detail: 'The project file stays exactly where it is on disk. Only the library entry is removed.',
                              confirmLabel: 'Remove from list',
                              onConfirm: () => {
                                void projects.forget(entry.path)
                              }
                            })
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Appearance of projects on disk" icon="database">
          <dl className="kv">
            <dt>Project format</dt>
            <dd className="mono">.cuepoint (versioned JSON with a schema version)</dd>
            <dt>Library database</dt>
            <dd className="mono">SQLite (recent projects, snapshots, recording history, settings)</dd>
            <dt>Assets</dt>
            <dd>Copied into an <span className="code-inline">assets</span> folder next to the project file</dd>
            <dt>User data</dt>
            <dd className="mono truncate">{info?.userDataPath ?? '—'}</dd>
            <dt>Logs</dt>
            <dd className="mono truncate">{info?.logsPath ?? '—'}</dd>
          </dl>
          <div className="row row--wrap">
            <Button size="sm" variant="ghost" icon="folder" tooltip="Open the CuePoint user data folder" onClick={() => void window.cuepoint?.app.openPath(info?.userDataPath ?? '')}>
              Open user data folder
            </Button>
            <Button size="sm" variant="ghost" icon="external" tooltip="Open the logs folder" onClick={() => command('help.openLogs')}>
              Open logs
            </Button>
          </div>
        </Panel>
      </div>

      {wizardOpen ? <NewProjectWizard onClose={() => setWizardOpen(false)} /> : null}
    </div>
  )
}

export function NewProjectWizard({ onClose }: { onClose(): void }): JSX.Element {
  const { projects, info, notify } = useApp()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('New Stage')
  const [author, setAuthor] = useState('')
  const [directory, setDirectory] = useState('')
  const [unit, setUnit] = useState<LengthUnit>('m')
  const [stageWidth, setStageWidth] = useState(12)
  const [stageHeight, setStageHeight] = useState(6)
  const [background, setBackground] = useState<string | null>(null)
  const [backgroundSize, setBackgroundSize] = useState<string | null>(null)
  const [initialScreens, setInitialScreens] = useState(0)
  const [outputCount, setOutputCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const api = window.cuepoint
      if (!api) return
      const result = await api.export.defaultDirectory()
      if (result.ok && !directory) {
        setDirectory(result.data)
      }
    })()
  }, [directory])

  useEffect(() => {
    if (!author && info) setAuthor('')
  }, [author, info])

  const create = useCallback(async () => {
    if (!name.trim()) {
      setError('Give the project a name.')
      setStep(0)
      return
    }
    if (!directory) {
      setError('Choose where the project should be saved.')
      setStep(0)
      return
    }
    const request: NewProjectRequest = {
      name: name.trim(),
      author: author.trim(),
      directory,
      stageWidthMm: toMm(stageWidth, unit),
      stageHeightMm: toMm(stageHeight, unit),
      defaultUnit: unit,
      backgroundAssetPath: background,
      initialScreenCount: initialScreens,
      outputs: Array.from({ length: outputCount }, (_, index) => ({
        name: outputCount === 1 ? 'Main Output' : `Output ${index + 1}`,
        width: 1920,
        height: 1080
      }))
    }
    setBusy(true)
    await projects.create(request)
    setBusy(false)
    notify('success', 'Project created', `${request.name} · ${directory}`)
    // Close the wizard after a short delay so focus stays on the text field
    // and the user can see the success notification.
    const closeDelay = 1500
    const closeTimer = setTimeout(() => onClose(), closeDelay)
    // If the user navigates away, clear the timer
    return () => clearTimeout(closeTimer)
  }, [author, background, directory, initialScreens, name, notify, onClose, outputCount, projects, stageHeight, stageWidth, unit])

  const steps = ['Project', 'Stage', 'Optional extras', 'Review']

  return (
    <Modal
      title="New project"
      wide
      onClose={onClose}
      footer={
        <>
          <div className="wizard-steps">
            {steps.map((label, index) => (
              <span key={label} className="wizard-step" data-active={index === step}>
                <span className="wizard-step__index">{index + 1}</span>
                {label}
              </span>
            ))}
          </div>
          <div className="spacer" />
          {step > 0 ? (
            <Button onClick={() => setStep((value) => value - 1)} disabled={busy}>
              Back
            </Button>
          ) : null}
          {step < steps.length - 1 ? (
            <Button variant="primary" onClick={() => setStep((value) => value + 1)} disabled={busy}>
              Next
            </Button>
          ) : (
            <Button variant="primary" icon="check" onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          )}
        </>
      }
    >
      {error ? <Callout tone="error" title="Check these details">{error}</Callout> : null}

      {step === 0 ? (
        <PanelSection title="Name and location">
          <TextField label="Project name" value={name} onChange={setName} autoFocus hint="Shown in the title bar and written into exports." />
          <TextField label="Author / operator" value={author} onChange={setAuthor} hint="Optional. Recorded in the project metadata." />
          <TextField label="Folder" value={directory} onChange={setDirectory} commitOnBlur hint="A folder is created inside this location for the project, its assets and its exports." />
          <Button
            size="sm"
            icon="folder"
            tooltip="Choose the folder this project is created in"
            onClick={() => {
              void (async () => {
                const api = window.cuepoint
                if (!api) return
                const result = await api.app.chooseDirectory({ title: 'Choose a project folder', defaultPath: directory || undefined })
                if (result.ok && result.data) setDirectory(result.data)
              })()
            }}
          >
            Browse…
          </Button>
        </PanelSection>
      ) : null}

      {step === 1 ? (
        <PanelSection title="Stage dimensions">
          <SelectField
            label="Working unit"
            value={unit}
            options={LENGTH_UNITS.map((candidate) => ({ value: candidate, label: UNIT_LABEL[candidate] }))}
            onChange={(value) => setUnit(value as LengthUnit)}
            hint="Physical geometry is always stored in millimetres; this only changes the display."
          />
          <div className="field__row">
            <NumberField
              label="Stage width"
              unit={UNIT_LABEL[unit]}
              value={stageWidth}
              min={0.1}
              max={fromMm(LIMITS.maxStageMm, unit)}
              step={0.5}
              onChange={setStageWidth}
            />
            <NumberField
              label="Stage height"
              unit={UNIT_LABEL[unit]}
              value={stageHeight}
              min={0.1}
              max={fromMm(LIMITS.maxStageMm, unit)}
              step={0.5}
              onChange={setStageHeight}
            />
          </div>
          <p className="muted">
            The stage is the real-world space your screens sit in. You can change it at any time without affecting
            screen geometry.
          </p>
        </PanelSection>
      ) : null}

      {step === 2 ? (
        <PanelSection title="Optional extras (skip freely)">
          <div className="row row--wrap">
            <Button
              size="sm"
              icon="image"
              tooltip="Load a stage photograph or plan as the background"
              onClick={() => {
                void (async () => {
                  const api = window.cuepoint
                  if (!api) return
                  const result = await api.stage.importBackground()
                  if (!result.ok) {
                    notify('error', 'Background import failed', result.error.message)
                    return
                  }
                  if (!result.data) return
                  setBackground(result.data.path)
                  setBackgroundSize(`${result.data.width} × ${result.data.height} px`)
                })()
              }}
            >
              {background ? 'Choose a different image' : 'Import background image'}
            </Button>
            {background ? (
              <Button size="sm" variant="ghost" icon="close" tooltip="Do not use a background image" onClick={() => {
                setBackground(null)
                setBackgroundSize(null)
              }}>
                Clear
              </Button>
            ) : null}
          </div>
          <p className="muted">{background ? `${background}${backgroundSize ? ` · ${backgroundSize}` : ''}` : 'No background selected.'}</p>
          <NumberField
            label="Initial screens"
            value={initialScreens}
            min={0}
            max={64}
            precision={0}
            hint="Pre-create this many evenly sized screens on the stage. You can add and edit screens at any time."
            onChange={(value) => setInitialScreens(Math.round(value))}
          />
          <NumberField
            label="Output devices"
            value={outputCount}
            min={1}
            max={16}
            precision={0}
            hint="Output devices are the pixel canvases your screens are mapped into."
            onChange={(value) => setOutputCount(Math.round(value))}
          />
        </PanelSection>
      ) : null}

      {step === 3 ? (
        <PanelSection title="Review">
          <dl className="kv">
            <dt>Project name</dt>
            <dd>{name || '—'}</dd>
            <dt>Author</dt>
            <dd>{author || '—'}</dd>
            <dt>Folder</dt>
            <dd className="mono truncate">{directory || '—'}</dd>
            <dt>Stage</dt>
            <dd>
              {stageWidth} × {stageHeight} {UNIT_LABEL[unit]} ({Math.round(toMm(stageWidth, unit))} ×{' '}
              {Math.round(toMm(stageHeight, unit))} mm)
            </dd>
            <dt>Background</dt>
            <dd className="truncate">{background ?? 'none'}</dd>
            <dt>Screens</dt>
            <dd>{initialScreens}</dd>
            <dt>Outputs</dt>
            <dd>{outputCount} × 1920×1080</dd>
            <dt>Estimated size</dt>
            <dd>{formatBytes(24_000 + initialScreens * 1_500)}</dd>
          </dl>
          <Callout tone="info">
            CuePoint writes the project file, copies the background into the project’s assets folder, and creates an
            Exports folder for mapping output. Nothing leaves your computer.
          </Callout>
        </PanelSection>
      ) : null}
    </Modal>
  )
}

function fromMm(mm: number, unit: LengthUnit): number {
  const factors: Record<LengthUnit, number> = { mm: 1, cm: 1 / 10, m: 1 / 1000, in: 1 / 25.4, ft: 1 / 304.8 }
  return mm * factors[unit]
}

/** Snapshot browser used by the recovery dialog. */
export function RecoveryList({
  snapshots,
  onRestore,
  onDelete
}: {
  snapshots: RecoverySnapshot[]
  onRestore(id: number): void
  onDelete(id: number): void
}): JSX.Element {
  if (snapshots.length === 0) {
    return <p className="muted">No recovery snapshots have been written yet.</p>
  }
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Created</th>
            <th scope="col">Project</th>
            <th scope="col">Reason</th>
            <th scope="col">Screens</th>
            <th scope="col">Size</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((snapshot) => (
            <tr key={snapshot.id}>
              <td className="nowrap">{new Date(snapshot.createdAt).toLocaleString()}</td>
              <td className="truncate">{snapshot.name}</td>
              <td>
                <Badge tone={snapshot.reason === 'autosave' ? 'neutral' : 'accent'}>{snapshot.reason}</Badge>
              </td>
              <td className="numeric">{snapshot.screenCount}</td>
              <td className="numeric">{formatBytes(snapshot.bytes)}</td>
              <td>
                <Button size="sm" tooltip="Restore the project to this snapshot" onClick={() => onRestore(snapshot.id)}>
                  Restore
                </Button>
                <IconButton size="sm" icon="trash" label="Delete this snapshot" onClick={() => onDelete(snapshot.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
