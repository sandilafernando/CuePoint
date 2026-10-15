import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, ThemeMode } from '@shared/appTypes'
import type { LengthUnit } from '@shared/types'
import { LENGTH_UNITS, UNIT_LABEL } from '@shared/units'
import { LIMITS } from '@shared/validation'
import { SHORTCUT_ACTIONS, SHORTCUT_CATEGORIES, formatAccelerator } from '@shared/shortcuts'
import {
  Badge,
  Button,
  Callout,
  CheckboxField,
  IconButton,
  NumberField,
  Panel,
  PanelSection,
  SearchInput,
  Segmented,
  SelectField,
  SliderField,
  TextField
} from '../../components/ui'
import { useApp } from '../../state/AppState'

/**
 * Settings.
 *
 * Every control writes through the main process, which validates and normalises the values
 * before persisting them, so an out-of-range number typed here can never reach storage.
 * Sections are addressable so other workspaces can deep-link into them.
 */

type Section =
  | 'appearance'
  | 'stage'
  | 'project'
  | 'ndi'
  | 'recording'
  | 'export'
  | 'shortcuts'
  | 'performance'
  | 'advanced'

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'appearance', label: 'Appearance', hint: 'Theme, accent colour and motion' },
  { id: 'stage', label: 'Stage Designer', hint: 'Units, grid and snapping defaults' },
  { id: 'project', label: 'Projects & autosave', hint: 'Storage location, autosave and backups' },
  { id: 'ndi', label: 'NDI', hint: 'Runtime, bandwidth, preview rate and reconnect' },
  { id: 'recording', label: 'Recording', hint: 'Target, resolution, codec and destination' },
  { id: 'export', label: 'Export', hint: 'Folder, scale, labels and CSV options' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', hint: 'Every action and its accelerator' },
  { id: 'performance', label: 'Performance', hint: 'Preview limits, queues and statistics window' },
  { id: 'advanced', label: 'Advanced', hint: 'Logging and troubleshooting' }
]

export function Settings(): JSX.Element {
  const { settings, updateSettings, resetSetting, info, notify, openModal, closeModal } = useApp()
  const [section, setSection] = useState<Section>('appearance')
  const [shortcutQuery, setShortcutQuery] = useState('')

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail as Section
      if (SECTIONS.some((entry) => entry.id === detail)) setSection(detail)
    }
    window.addEventListener('cuepoint:open-settings', handler)
    return () => window.removeEventListener('cuepoint:open-settings', handler)
  }, [])

  const filteredShortcuts = useMemo(() => {
    const needle = shortcutQuery.trim().toLowerCase()
    if (!needle) return SHORTCUT_ACTIONS
    return SHORTCUT_ACTIONS.filter(
      (action) =>
        action.label.toLowerCase().includes(needle) ||
        action.description.toLowerCase().includes(needle) ||
        action.category.toLowerCase().includes(needle)
    )
  }, [shortcutQuery])

  const patch = (next: Partial<AppSettings>): void => void updateSettings(next)

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">Settings</span>
        <div className="toolbar__spacer" />
        <Button
          size="sm"
          variant="ghost"
          icon="folder"
          tooltip="Open the folder where settings and the project library are stored"
          onClick={() => void window.cuepoint?.app.openPath(info?.userDataPath ?? '')}
        >
          Open data folder
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon="refresh"
          tooltip="Restore every setting to its default value"
          onClick={() =>
            openModal({
              kind: 'confirm',
              title: 'Reset all settings',
              message: 'Restore every preference to its default value?',
              detail: 'Projects, recordings and exports are not affected. Only preferences are reset.',
              confirmLabel: 'Reset settings',
              onConfirm: () => {
                void (async () => {
                  const api = window.cuepoint
                  if (!api) return
                  const result = await api.app.saveSettings({})
                  if (result.ok) {
                    notify('success', 'Settings reset to defaults')
                  } else {
                    notify('error', 'Settings could not be reset', result.error.message)
                  }
                  closeModal()
                })()
              }
            })
          }
        >
          Reset all
        </Button>
      </div>

      <div className="workspace-split">
        <div className="scroll-area">
          {section === 'appearance' ? (
            <Panel title="Appearance" icon="settings">
              <PanelSection title="Theme">
                <Segmented
                  label="Theme"
                  value={settings.theme}
                  options={[
                    { value: 'dark', label: 'Dark', tooltip: 'Dark charcoal workspace (default)' },
                    { value: 'light', label: 'Light', tooltip: 'Light workspace for bright rooms' },
                    { value: 'system', label: 'System', tooltip: 'Follow the Windows app theme' }
                  ]}
                  onChange={(value) => patch({ theme: value as ThemeMode })}
                />
                <div className="field">
                  <span className="field__label">Accent colour</span>
                  <div className="row row--wrap">
                    {['#4c9aff', '#4dd4ac', '#f2b544', '#e2687a', '#b98cff', '#7fd1e6'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Use accent ${color}`}
                        title={`Use accent ${color}`}
                        onClick={() => patch({ accent: color })}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          background: color,
                          border: settings.accent === color ? '2px solid var(--text-primary)' : '1px solid var(--border)',
                          cursor: 'pointer'
                        }}
                      />
                    ))}
                  </div>
                  <p className="field__hint">The accent is used for selection, focus rings and primary actions.</p>
                </div>
                <CheckboxField
                  label="Reduce motion"
                  checked={settings.reduceMotion}
                  onChange={(value) => patch({ reduceMotion: value })}
                  hint="Removes panel and toast transitions. Useful on slower machines and for motion sensitivity."
                />
              </PanelSection>
              <PanelSection title="Units">
                <SelectField
                  label="Default measurement unit"
                  value={settings.defaultUnit}
                  options={LENGTH_UNITS.map((unit) => ({ value: unit, label: UNIT_LABEL[unit] }))}
                  onChange={(value) => patch({ defaultUnit: value as LengthUnit })}
                  hint="Used for new projects and for values shown outside a project."
                />
              </PanelSection>
            </Panel>
          ) : null}

          {section === 'stage' ? (
            <Panel title="Stage Designer defaults" icon="stage">
              <PanelSection title="Grid">
                <CheckboxField
                  label="Show grid by default"
                  checked={settings.grid.visible}
                  onChange={(value) => patch({ grid: { ...settings.grid, visible: value } })}
                />
                <CheckboxField
                  label="Snap to grid"
                  checked={settings.grid.snapToGrid}
                  onChange={(value) => patch({ grid: { ...settings.grid, snapToGrid: value } })}
                />
                <CheckboxField
                  label="Snap to screens"
                  checked={settings.grid.snapToScreens}
                  onChange={(value) => patch({ grid: { ...settings.grid, snapToScreens: value } })}
                />
                <CheckboxField
                  label="Snap to stage edges and centre"
                  checked={settings.grid.snapToStage}
                  onChange={(value) => patch({ grid: { ...settings.grid, snapToStage: value } })}
                />
                <CheckboxField
                  label="Show alignment guides"
                  checked={settings.grid.guidesVisible}
                  onChange={(value) => patch({ grid: { ...settings.grid, guidesVisible: value } })}
                />
                <CheckboxField
                  label="Show ruler labels"
                  checked={settings.grid.rulersVisible}
                  onChange={(value) => patch({ grid: { ...settings.grid, rulersVisible: value } })}
                />
                <NumberField
                  label="Default grid spacing"
                  unit="mm"
                  value={settings.grid.spacingMm}
                  min={LIMITS.minGridSpacingMm}
                  max={LIMITS.maxGridSpacingMm}
                  step={50}
                  precision={0}
                  onChange={(value) => patch({ grid: { ...settings.grid, spacingMm: Math.round(value) } })}
                  hint="Applied to new projects. Existing projects keep their own spacing."
                />
                <NumberField
                  label="Major line interval"
                  value={settings.grid.majorEvery}
                  min={1}
                  max={20}
                  precision={0}
                  onChange={(value) => patch({ grid: { ...settings.grid, majorEvery: Math.round(value) } })}
                  hint="Number of minor cells per major grid line."
                />
                <SliderField
                  label="Snap tolerance"
                  value={settings.grid.tolerancePx}
                  min={LIMITS.minSnapTolerancePx}
                  max={LIMITS.maxSnapTolerancePx}
                  step={1}
                  format={(value) => `${value} px`}
                  onChange={(value) => patch({ grid: { ...settings.grid, tolerancePx: Math.round(value) } })}
                />
              </PanelSection>
            </Panel>
          ) : null}

          {section === 'project' ? (
            <Panel title="Projects and autosave" icon="database">
              <PanelSection title="Storage">
                <TextField
                  label="Default project folder"
                  value={settings.projectDirectory ?? ''}
                  commitOnBlur
                  placeholder="Documents folder"
                  onChange={(value) => patch({ projectDirectory: value || null })}
                  hint="Where new projects are created by default."
                />
                <div className="row row--wrap">
                  <Button
                    size="sm"
                    icon="folder"
                    tooltip="Choose the default project folder"
                    onClick={() => {
                      void (async () => {
                        const api = window.cuepoint
                        if (!api) return
                        const result = await api.app.chooseDirectory({
                          title: 'Choose a project folder',
                          defaultPath: settings.projectDirectory ?? undefined
                        })
                        if (result.ok && result.data) patch({ projectDirectory: result.data })
                      })()
                    }}
                  >
                    Choose folder
                  </Button>
                  <IconButton
                    icon="refresh"
                    label="Restore the default project folder"
                    onClick={() => void resetSetting('projectDirectory')}
                  />
                </div>
                <NumberField
                  label="Recent projects kept"
                  value={settings.recentProjectLimit}
                  min={5}
                  max={100}
                  precision={0}
                  onChange={(value) => patch({ recentProjectLimit: Math.round(value) })}
                  hint="Older entries are dropped from the list. Project files are never deleted."
                />
              </PanelSection>
              <PanelSection title="Autosave and recovery">
                <CheckboxField
                  label="Enable autosave"
                  checked={settings.autosaveEnabled}
                  onChange={(value) => patch({ autosaveEnabled: value })}
                  hint="Autosave writes recovery snapshots into the project library without interrupting editing."
                />
                <NumberField
                  label="Autosave interval"
                  unit="s"
                  value={Math.round(settings.autosaveIntervalMs / 1000)}
                  min={LIMITS.minAutosaveMs / 1000}
                  max={LIMITS.maxAutosaveMs / 1000}
                  precision={0}
                  onChange={(value) => patch({ autosaveIntervalMs: Math.round(value) * 1000 })}
                />
                <NumberField
                  label="Snapshots retained"
                  value={settings.backupRetention}
                  min={LIMITS.minBackupRetention}
                  max={LIMITS.maxBackupRetention}
                  precision={0}
                  onChange={(value) => patch({ backupRetention: Math.round(value) })}
                  hint="Older snapshots are pruned automatically. The project file itself is never deleted."
                />
              </PanelSection>
            </Panel>
          ) : null}

          {section === 'ndi' ? (
            <Panel title="NDI" icon="ndi">
              <PanelSection title="Runtime">
                <CheckboxField
                  label="Start the NDI helper when CuePoint launches"
                  checked={settings.ndi.autoStartHelper}
                  onChange={(value) => patch({ ndi: { ...settings.ndi, autoStartHelper: value } })}
                  hint="The helper is a separate process; CuePoint supervises it and restarts it if it exits."
                />
                <TextField
                  label="NDI runtime DLL path"
                  value={settings.ndi.dllPathOverride ?? ''}
                  commitOnBlur
                  placeholder="Auto-detected from the installed NDI runtime"
                  onChange={(value) => patch({ ndi: { ...settings.ndi, dllPathOverride: value || null } })}
                  hint="Only needed when the runtime is installed in a non-standard location."
                />
                <NumberField
                  label="Discovery timeout"
                  unit="ms"
                  value={settings.ndi.discoveryTimeoutMs}
                  min={500}
                  max={30_000}
                  step={250}
                  precision={0}
                  onChange={(value) => patch({ ndi: { ...settings.ndi, discoveryTimeoutMs: Math.round(value) } })}
                  hint="How long to listen for source announcements before finishing a scan."
                />
              </PanelSection>
              <PanelSection title="Reception">
                <SelectField
                  label="Receive bandwidth"
                  value={settings.ndi.bandwidth}
                  options={[
                    { value: 'native', label: 'Native resolution (recommended)' },
                    { value: 'throughput', label: 'Maximum throughput' }
                  ]}
                  onChange={(value) => patch({ ndi: { ...settings.ndi, bandwidth: value as 'native' | 'throughput' } })}
                  hint="Measured on NDI 6.2.1: the throughput setting delivers half resolution for the same source. CuePoint therefore defaults to native and labels the trade-off honestly."
                />
                <SelectField
                  label="Colour format"
                  value={settings.ndi.colorFormat}
                  options={[
                    { value: 'rgba', label: 'RGBA (recommended)' },
                    { value: 'bgra', label: 'BGRA' },
                    { value: 'uyvy', label: 'UYVY (not rendered by the preview)' }
                  ]}
                  onChange={(value) => patch({ ndi: { ...settings.ndi, colorFormat: value as 'rgba' | 'bgra' | 'uyvy' } })}
                  hint="NDI FourCC codes are memory order. RGBA needs no per-pixel conversion, so it is the fastest path."
                />
                <NumberField
                  label="Preview frames per second"
                  value={settings.ndi.previewFps}
                  min={1}
                  max={60}
                  precision={0}
                  onChange={(value) => {
                    patch({ ndi: { ...settings.ndi, previewFps: Math.round(value) } })
                    void window.cuepoint?.ndi.setPreviewFps(Math.round(value))
                  }}
                  hint="Limits redraws only. Reception always runs at the source's rate."
                />
                <NumberField
                  label="Frames buffered per source"
                  value={settings.ndi.frameQueueLimit}
                  min={1}
                  max={120}
                  precision={0}
                  onChange={(value) => patch({ ndi: { ...settings.ndi, frameQueueLimit: Math.round(value) } })}
                  hint="Older frames are discarded first, so a slow consumer cannot grow memory without limit."
                />
                <CheckboxField
                  label="Reconnect automatically when a source disappears"
                  checked={settings.ndi.autoReconnect}
                  onChange={(value) => patch({ ndi: { ...settings.ndi, autoReconnect: value } })}
                />
              </PanelSection>
              <PanelSection title="Licensing">
                <Callout tone="info">
                  CuePoint loads the NDI runtime that you install; it does not redistribute the NDI SDK or runtime.
                  NDI® is a registered trademark of Vizrt Group. Install the NDI Runtime from ndi.video and observe its
                  licence terms.
                </Callout>
              </PanelSection>
            </Panel>
          ) : null}

          {section === 'recording' ? (
            <Panel title="Recording defaults" icon="record">
              <PanelSection title="Capture">
                <Segmented
                  label="Default target"
                  value={settings.recording.target}
                  options={[
                    { value: 'stage', label: 'Stage' },
                    { value: 'screen', label: 'Screen' },
                    { value: 'ndi', label: 'NDI' }
                  ]}
                  onChange={(value) => patch({ recording: { ...settings.recording, target: value } })}
                />
                <NumberField
                  label="Default width"
                  unit="px"
                  value={settings.recording.width}
                  min={LIMITS.minPixel}
                  max={LIMITS.maxPixel}
                  step={2}
                  precision={0}
                  onChange={(value) => patch({ recording: { ...settings.recording, width: Math.round(value) } })}
                />
                <NumberField
                  label="Default height"
                  unit="px"
                  value={settings.recording.height}
                  min={LIMITS.minPixel}
                  max={LIMITS.maxPixel}
                  step={2}
                  precision={0}
                  onChange={(value) => patch({ recording: { ...settings.recording, height: Math.round(value) } })}
                />
                <NumberField
                  label="Default frame rate"
                  unit="fps"
                  value={settings.recording.fps}
                  min={1}
                  max={120}
                  precision={0}
                  onChange={(value) => patch({ recording: { ...settings.recording, fps: Math.round(value) } })}
                />
                <NumberField
                  label="Default bitrate"
                  unit="Mbps"
                  value={settings.recording.bitrateMbps}
                  min={1}
                  max={80}
                  precision={0}
                  onChange={(value) => patch({ recording: { ...settings.recording, bitrateMbps: Math.round(value) } })}
                />
                <TextField
                  label="File name template"
                  value={settings.recording.fileNameTemplate}
                  commitOnBlur
                  onChange={(value) => patch({ recording: { ...settings.recording, fileNameTemplate: value } })}
                  hint="Tokens: {project}, {target}, {date}, {time}, {index}."
                />
                <TextField
                  label="Output folder"
                  value={settings.recording.outputDirectory ?? ''}
                  commitOnBlur
                  placeholder="Default: CuePoint Recordings in your user data folder"
                  onChange={(value) => patch({ recording: { ...settings.recording, outputDirectory: value || null } })}
                />
                <div className="row row--wrap">
                  <Button
                    size="sm"
                    icon="folder"
                    tooltip="Choose the recording output folder"
                    onClick={() => {
                      void (async () => {
                        const api = window.cuepoint
                        if (!api) return
                        const result = await api.app.chooseDirectory({
                          title: 'Choose a recording folder',
                          defaultPath: settings.recording.outputDirectory ?? undefined
                        })
                        if (result.ok && result.data) {
                          patch({ recording: { ...settings.recording, outputDirectory: result.data } })
                        }
                      })()
                    }}
                  >
                    Choose folder
                  </Button>
                </div>
              </PanelSection>
              <PanelSection title="Encoding">
                <CheckboxField
                  label="Transcode to MP4 after finalising"
                  checked={settings.recording.transcodeToMp4}
                  onChange={(value) => patch({ recording: { ...settings.recording, transcodeToMp4: value } })}
                  hint="Requires FFmpeg. WebM capture is written by Chromium’s MediaRecorder either way."
                />
                <Callout tone="info" title="Codec and licensing">
                  Capture uses Chromium’s MediaRecorder (VP8/VP9 in a WebM container). Optional MP4 transcoding uses
                  FFmpeg, which you install yourself — CuePoint does not bundle it, because FFmpeg builds carry their own
                  licence terms depending on how they are compiled.
                </Callout>
              </PanelSection>
            </Panel>
          ) : null}

          {section === 'export' ? (
            <Panel title="Export defaults" icon="export">
              <PanelSection title="Destination and appearance">
                <TextField
                  label="Export folder"
                  value={settings.export.directory ?? ''}
                  commitOnBlur
                  placeholder="Default: an Exports folder next to the project"
                  onChange={(value) => patch({ export: { ...settings.export, directory: value || null } })}
                />
                <NumberField
                  label="Map scale"
                  unit="%"
                  value={settings.export.mapScalePercent}
                  min={10}
                  max={400}
                  step={10}
                  precision={0}
                  onChange={(value) => patch({ export: { ...settings.export, mapScalePercent: Math.round(value) } })}
                  hint="Affects PNG output only. CSV and JSON always contain true pixel coordinates."
                />
                <CheckboxField
                  label="Include grid on maps"
                  checked={settings.export.includeGrid}
                  onChange={(value) => patch({ export: { ...settings.export, includeGrid: value } })}
                />
                <CheckboxField
                  label="Include screen labels"
                  checked={settings.export.includeLabels}
                  onChange={(value) => patch({ export: { ...settings.export, includeLabels: value } })}
                />
                <CheckboxField
                  label="Include screen borders"
                  checked={settings.export.includeBorders}
                  onChange={(value) => patch({ export: { ...settings.export, includeBorders: value } })}
                />
                <CheckboxField
                  label="Write per-screen guide images"
                  checked={settings.export.perScreenGuides}
                  onChange={(value) => patch({ export: { ...settings.export, perScreenGuides: value } })}
                />
                <CheckboxField
                  label="Write the stage layout image"
                  checked={settings.export.stageLayout}
                  onChange={(value) => patch({ export: { ...settings.export, stageLayout: value } })}
                />
                <SelectField
                  label="CSV delimiter"
                  value={settings.export.csvDelimiter}
                  options={[
                    { value: ',', label: 'Comma ( , )' },
                    { value: ';', label: 'Semicolon ( ; )' },
                    { value: '\t', label: 'Tab' }
                  ]}
                  onChange={(value) => patch({ export: { ...settings.export, csvDelimiter: value as ',' | ';' | '\t' } })}
                />
                <NumberField
                  label="JSON indent"
                  value={settings.export.jsonIndent}
                  min={0}
                  max={8}
                  precision={0}
                  onChange={(value) => patch({ export: { ...settings.export, jsonIndent: Math.round(value) } })}
                />
              </PanelSection>
            </Panel>
          ) : null}

          {section === 'shortcuts' ? (
            <Panel title="Keyboard shortcuts" icon="text">
              <SearchInput label="Search shortcuts" placeholder="Search by action, description or category" value={shortcutQuery} onChange={setShortcutQuery} />
              <Callout tone="info">
                Menu accelerators are registered by the main process. Shortcuts handled in the workspace (undo, redo,
                clipboard, delete, select all and the canvas keys) never fire while a text field has focus.
              </Callout>
              {SHORTCUT_CATEGORIES.map((category) => {
                const actions = filteredShortcuts.filter((action) => action.category === category)
                if (actions.length === 0) return null
                return (
                  <PanelSection key={category} title={category}>
                    <div className="table-scroll">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Action</th>
                            <th scope="col">Shortcut</th>
                            <th scope="col">Scope</th>
                            <th scope="col">Reset</th>
                          </tr>
                        </thead>
                        <tbody>
                          {actions.map((action) => {
                            const current = settings.shortcuts[action.id] ?? action.default
                            return (
                              <tr key={action.id}>
                                <td>
                                  <div className="column" style={{ gap: 2 }}>
                                    <span>{action.label}</span>
                                    <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
                                      {action.description}
                                    </span>
                                  </div>
                                </td>
                                <td>
                                  <div style={{ width: 180 }}>
                                    <TextField
                                      label={`Shortcut for ${action.label}`}
                                      value={current}
                                      commitOnBlur
                                      onChange={(value) =>
                                        patch({
                                          shortcuts: { ...settings.shortcuts, [action.id]: value }
                                        })
                                      }
                                    />
                                  </div>
                                </td>
                                <td>
                                  <Badge tone={action.owner === 'main' ? 'accent' : 'neutral'} tooltip="main = registered as an application menu accelerator; renderer = handled in the workspace">
                                    {action.owner}
                                  </Badge>
                                </td>
                                <td>
                                  <IconButton
                                    size="sm"
                                    icon="refresh"
                                    label={`Restore the default shortcut for ${action.label}`}
                                    onClick={() =>
                                      patch({
                                        shortcuts: { ...settings.shortcuts, [action.id]: action.default }
                                      })
                                    }
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
                      Default: {actions.map((action) => `${action.label} ${formatAccelerator(action.default)}`).slice(0, 4).join(' · ')}
                    </p>
                  </PanelSection>
                )
              })}
              <Button
                size="sm"
                variant="ghost"
                icon="refresh"
                tooltip="Restore every shortcut to its default value"
                onClick={() => patch({ shortcuts: {} })}
              >
                Reset all shortcuts
              </Button>
            </Panel>
          ) : null}

          {section === 'performance' ? (
            <Panel title="Performance" icon="cpu">
              <PanelSection title="Preview limits">
                <NumberField
                  label="Maximum simultaneous previews"
                  value={settings.performance.maxPreviewSources}
                  min={1}
                  max={16}
                  precision={0}
                  onChange={(value) =>
                    patch({ performance: { ...settings.performance, maxPreviewSources: Math.round(value) } })
                  }
                  hint="Previews beyond this count are shown without a live image so reception and editing stay responsive."
                />
                <NumberField
                  label="Frame queue per source"
                  value={settings.performance.frameQueueLimit}
                  min={1}
                  max={120}
                  precision={0}
                  onChange={(value) =>
                    patch({ performance: { ...settings.performance, frameQueueLimit: Math.round(value) } })
                  }
                  hint="Older frames are discarded before newer ones, keeping latency low."
                />
                <NumberField
                  label="Statistics window"
                  unit="ms"
                  value={settings.performance.statsWindowMs}
                  min={250}
                  max={10_000}
                  step={250}
                  precision={0}
                  onChange={(value) =>
                    patch({ performance: { ...settings.performance, statsWindowMs: Math.round(value) } })
                  }
                  hint="Averaging window for the measured FPS and frame-age figures."
                />
                <CheckboxField
                  label="Verbose diagnostics"
                  checked={settings.performance.verboseDiagnostics}
                  onChange={(value) =>
                    patch({ performance: { ...settings.performance, verboseDiagnostics: value } })
                  }
                  hint="Records extra timing detail in the log. Slightly higher log volume."
                />
              </PanelSection>
            </Panel>
          ) : null}

          {section === 'advanced' ? (
            <Panel title="Advanced" icon="activity">
              <PanelSection title="Logging">
                <SelectField
                  label="Log level"
                  value={settings.advanced.logLevel}
                  options={[
                    { value: 'error', label: 'Errors only' },
                    { value: 'warn', label: 'Warnings and errors' },
                    { value: 'info', label: 'Normal (recommended)' },
                    { value: 'debug', label: 'Debug (verbose)' }
                  ]}
                  onChange={(value) =>
                    patch({ advanced: { ...settings.advanced, logLevel: value as 'error' | 'warn' | 'info' | 'debug' } })
                  }
                  hint="Logs never contain project content, credentials or personal data beyond file paths you chose."
                />
                <NumberField
                  label="Log files retained"
                  value={settings.advanced.keepLogFiles}
                  min={1}
                  max={30}
                  precision={0}
                  onChange={(value) =>
                    patch({ advanced: { ...settings.advanced, keepLogFiles: Math.round(value) } })
                  }
                />
                <div className="row row--wrap">
                  <Button size="sm" icon="folder" tooltip="Open the log folder" onClick={() => void window.cuepoint?.app.openPath(info?.logsPath ?? '')}>
                    Open logs folder
                  </Button>
                  <Button size="sm" variant="ghost" icon="copy" tooltip="Copy a full diagnostic report to the clipboard" onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:copy-diagnostics'))}>
                    Copy diagnostic report
                  </Button>
                </div>
              </PanelSection>
              <PanelSection title="Environment">
                <dl className="kv">
                  <dt>CuePoint</dt>
                  <dd>
                    {info?.version ?? '—'} {info?.packaged ? '(installed build)' : '(development build)'}
                  </dd>
                  <dt>Electron / Chromium / Node</dt>
                  <dd className="mono">
                    {info?.electron ?? '—'} / {info?.chrome ?? '—'} / {info?.node ?? '—'}
                  </dd>
                  <dt>Platform</dt>
                  <dd className="mono">
                    {info?.platform ?? '—'} {info?.arch ?? ''}
                  </dd>
                  <dt>User data</dt>
                  <dd className="mono truncate">{info?.userDataPath ?? '—'}</dd>
                  <dt>Workspace</dt>
                  <dd className="mono truncate">{info?.workspacePath ?? '—'}</dd>
                </dl>
              </PanelSection>
            </Panel>
          ) : null}
        </div>

        <Panel title="Sections" icon="settings">
          <ul className="list">
            {SECTIONS.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={section === entry.id ? 'list__item is-selected' : 'list__item'}
                  onClick={() => setSection(entry.id)}
                  aria-current={section === entry.id ? 'true' : undefined}
                >
                  <span className="list__label">{entry.label}</span>
                </button>
                <p className="muted" style={{ fontSize: 'var(--text-2xs)', padding: '0 var(--space-5) var(--space-2)' }}>
                  {entry.hint}
                </p>
              </li>
            ))}
          </ul>
          <PanelSection title="Where settings live">
            <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              Settings are validated and normalised by the main process before they are stored, so a value typed here
              can never be persisted out of range. Audio capture is not implemented in this release and is shown as
              unavailable rather than silently ignored.
            </p>
          </PanelSection>
        </Panel>
      </div>
    </div>
  )
}
