import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ExportKind, ExportReport, ExportSettings } from '@shared/appTypes'
import { buildCombinedMapPlan, buildMappingPlan, issuesByLevel } from '@shared/mapping'
import { LIMITS } from '@shared/validation'
import { formatLength } from '@shared/units'
import { formatBytes } from '../../components/Shell'
import {
  Badge,
  Button,
  Callout,
  CheckboxField,
  EmptyState,
  Icon,
  IconButton,
  IssueList,
  Metric,
  Modal,
  NumberField,
  Panel,
  PanelSection,
  SelectField,
  TextField
} from '../../components/ui'
import type { EditorState } from '../../state/editor'
import { editorStore } from '../../state/editor'
import { useApp } from '../../state/AppState'

/**
 * Pixel Mapping workspace.
 *
 * Everything shown here is derived from stored project geometry with the same pure
 * functions the exporters use, so the preview, the validation list and the exported files
 * can never disagree.
 */

type PreviewKind = 'combined-map' | 'output-map' | 'stage-layout' | 'screen-guide'

const EXPORT_KINDS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'combined-map', label: 'Combined pixel map (PNG)', hint: 'Every output stacked as a band, with each screen’s pixels placed at its mapped region.' },
  { kind: 'output-map', label: 'Per-output maps (PNG)', hint: 'One PNG per output device at its native resolution.' },
  { kind: 'screen-guide', label: 'Per-screen guide PNGs', hint: 'One image per screen showing its native pixel size and region, for LED processors.' },
  { kind: 'stage-layout', label: 'Stage layout (PNG)', hint: 'Physical stage layout drawing with screen positions and sizes.' },
  { kind: 'csv', label: 'Mapping table (CSV)', hint: 'Screen geometry, native resolution and mapping coordinates as a documented CSV table.' },
  { kind: 'json', label: 'Mapping document (JSON)', hint: 'Versioned cuepoint.mapping JSON containing the full stage and mapping model.' }
]

export function PixelMapping({ state }: { state: EditorState }): JSX.Element {
  const { notify, settings, updateSettings, command } = useApp()
  const [previewKind, setPreviewKind] = useState<PreviewKind>('combined-map')
  const [previewOutputId, setPreviewOutputId] = useState<string | null>(null)
  const [previewScreenId, setPreviewScreenId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewMeta, setPreviewMeta] = useState<{ width: number; height: number; warnings: string[] } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportReport, setExportReport] = useState<ExportReport | null>(null)
  const [showExport, setShowExport] = useState(false)

  const project = state.project
  const plan = useMemo(() => (project ? buildMappingPlan(project) : null), [project])
  const combined = useMemo(() => (project ? buildCombinedMapPlan(project, plan ?? undefined) : null), [plan, project])
  const counts = useMemo(() => (plan ? issuesByLevel(plan) : { error: 0, warning: 0, info: 0 }), [plan])
  const issues = useMemo(() => {
    if (!plan) return []
    const order = { error: 0, warning: 1, info: 2 }
    return [...plan.issues].sort((a, b) => order[a.level] - order[b.level])
  }, [plan])

  const exportSettings: ExportSettings = settings.export
  const patchExportSettings = useCallback(
    (patch: Partial<ExportSettings>) => void updateSettings({ export: { ...exportSettings, ...patch } }),
    [exportSettings, updateSettings]
  )

  useEffect(() => {
    if (!project) {
      setPreviewUrl(null)
      return
    }
    if (!previewOutputId && project.outputs[0]) setPreviewOutputId(project.outputs[0].id)
    if (!previewScreenId && project.screens[0]) setPreviewScreenId(project.screens[0].id)
  }, [previewOutputId, previewScreenId, project])

  const loadPreview = useCallback(async () => {
    const api = window.cuepoint
    if (!api || !project) return
    if (previewKind === 'output-map' && !previewOutputId) return
    if (previewKind === 'screen-guide' && !previewScreenId) return
    setPreviewBusy(true)
    const result = await api.export.preview({
      kind: previewKind,
      outputId: previewOutputId ?? undefined,
      screenId: previewScreenId ?? undefined,
      maxWidth: 1600,
      maxHeight: 900
    })
    setPreviewBusy(false)
    if (!result.ok) {
      notify('error', 'Preview failed', result.error.message)
      setPreviewUrl(null)
      return
    }
    setPreviewUrl(result.data.dataUrl)
    setPreviewMeta({
      width: result.data.width,
      height: result.data.height,
      warnings: result.data.warnings
    })
  }, [notify, previewKind, previewOutputId, previewScreenId, project])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  const runExport = useCallback(
    async (kinds: ExportKind[]) => {
      const api = window.cuepoint
      if (!api || !project || !state.path) {
        notify('warning', 'Save the project first', 'Exports are written next to the project file or into your chosen folder.')
        return
      }
      setExporting(true)
      const result = await api.export.run({
        projectPath: state.path,
        directory: exportSettings.directory,
        kinds,
        options: exportSettings
      })
      setExporting(false)
      if (!result.ok) {
        notify('error', 'Export failed', `${result.error.message} ${result.error.hint ?? ''}`.trim())
        return
      }
      setExportReport(result.data)
      notify(
        'success',
        `Exported ${result.data.artifacts.length} file(s)`,
        `${formatBytes(result.data.totalBytes)} · ${result.data.directory}`
      )
      if (result.data.warnings.length > 0) {
        notify('warning', 'Export completed with warnings', result.data.warnings[0])
      }
    },
    [exportSettings, notify, project, state.path]
  )

  if (!project) {
    return (
      <div className="workspace">
        <div className="toolbar toolbar--wrap">
          <span className="toolbar__title">Pixel Mapping</span>
        </div>
        <div className="scroll-area">
          <EmptyState
            icon="mapping"
            title="No project open"
            message="Pixel Mapping works from the stored stage model. Create or open a project to map screens to outputs."
            actions={
              <Button variant="primary" icon="home" onClick={() => command('tools.home')}>
                Go to Home
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const unit = project.stage.defaultUnit

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">Pixel Mapping</span>
        <Button
          size="sm"
          variant="primary"
          icon="export"
          tooltip="Choose formats and export maps, guides and mapping data (Ctrl+E)"
          onClick={() => setShowExport(true)}
        >
          Export…
        </Button>
        <span className="toolbar__divider" />
        <SelectField
          label="Preview"
          value={previewKind}
          options={[
            { value: 'combined-map', label: 'Combined pixel map' },
            { value: 'output-map', label: 'Single output map' },
            { value: 'stage-layout', label: 'Stage layout' },
            { value: 'screen-guide', label: 'Screen guide' }
          ]}
          onChange={(value) => setPreviewKind(value as PreviewKind)}
        />
        {previewKind === 'output-map' ? (
          <SelectField
            label="Output"
            value={previewOutputId ?? ''}
            options={project.outputs.map((output) => ({
              value: output.id,
              label: `${output.name} (${output.width}×${output.height})`
            }))}
            onChange={setPreviewOutputId}
          />
        ) : null}
        {previewKind === 'screen-guide' ? (
          <SelectField
            label="Screen"
            value={previewScreenId ?? ''}
            options={project.screens.map((screen) => ({
              value: screen.id,
              label: `${screen.name} (${screen.pixelWidth}×${screen.pixelHeight})`
            }))}
            onChange={setPreviewScreenId}
          />
        ) : null}
        <IconButton icon="refresh" label="Refresh the export preview" onClick={() => void loadPreview()} />
        <div className="toolbar__spacer" />
        <Button size="sm" variant="ghost" icon="check" tooltip="Re-run mapping validation (Shift+F7)" onClick={() => command('tools.validateMapping')}>
          Validate mapping
        </Button>
      </div>

      <div className="workspace-split">
        <div className="scroll-area">
          <div className="row">
            <h2 className="section-title">Stage overview</h2>
            <div className="spacer" />
            <Badge tone={counts.error ? 'danger' : counts.warning ? 'warning' : 'success'} tooltip="Mapping validation summary">
              {counts.error} error(s) · {counts.warning} warning(s)
            </Badge>
          </div>

          <div className="grid-3">
            <Metric label="Screens" value={plan?.totals.screens ?? 0} hint="Screens in the project" />
            <Metric label="Mapped screens" value={plan?.totals.mappedScreens ?? 0} hint="Screens assigned to an output" />
            <Metric label="Outputs" value={plan?.totals.outputs ?? 0} />
            <Metric
              label="Mapped pixels"
              value={(plan?.totals.mappedPixels ?? 0).toLocaleString()}
              hint="Sum of every screen's mapped pixel area"
            />
            <Metric
              label="Output pixels"
              value={(plan?.totals.totalOutputPixels ?? 0).toLocaleString()}
              hint="Combined pixel capacity of all outputs"
            />
            <Metric
              label="Combined map"
              value={`${combined?.width ?? 0}×${combined?.height ?? 0}`}
              hint="Dimensions of the combined pixel-map image"
            />
          </div>

          <div className="grid-2">
            <Panel title="Export preview" icon="image">
              <div className="preview-frame">
                {previewBusy ? (
                  <p className="muted">Rendering preview…</p>
                ) : previewUrl ? (
                  <img src={previewUrl} alt="Export preview" />
                ) : (
                  <p className="muted">No preview available for this selection.</p>
                )}
              </div>
              {previewMeta ? (
                <p className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
                  {previewMeta.width} × {previewMeta.height} px
                  {previewMeta.warnings.length > 0 ? ` · ${previewMeta.warnings[0]}` : ''}
                </p>
              ) : null}
              <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                Preview reflects the stored model at export resolution — zoom and pan never affect exported files.
              </p>
            </Panel>

            <Panel title="Mapping validation" icon="alert">
              <IssueList issues={issues.slice(0, 40)} />
            </Panel>
          </div>

          {plan?.unassigned.length ? (
            <Callout tone="warning" title={`${plan.unassigned.length} screen(s) are not assigned to an output`}>
              Unassigned screens are excluded from output maps. Assign them below or in the inspector.
            </Callout>
          ) : null}

          {plan?.outputs.map((outputPlan) => (
            <Panel
              key={outputPlan.output.id}
              title={outputPlan.output.name}
              icon="screen"
              actions={
                <>
                  <Badge tooltip="Native output resolution">
                    {outputPlan.output.width}×{outputPlan.output.height}
                  </Badge>
                  <Badge tone={outputPlan.coveragePercent > 100 ? 'warning' : 'accent'} tooltip="Percentage of output pixels covered">
                    {outputPlan.coveragePercent.toFixed(1)}% covered
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="mapping"
                    tooltip="Re-place every auto region in this output so nothing overlaps"
                    onClick={() => editorStore.dispatch({ type: 'autoArrange', outputId: outputPlan.output.id })}
                  >
                    Auto-arrange
                  </Button>
                  <IconButton
                    icon="export"
                    label={`Export just ${outputPlan.output.name} as a PNG`}
                    onClick={() => void runExport(['output-map'])}
                  />
                </>
              }
            >
              {outputPlan.blocks.length === 0 ? (
                <p className="muted">No screens are mapped to this output yet.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table">
                    <caption className="sr-only">Screens mapped to {outputPlan.output.name}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Screen</th>
                        <th scope="col">Region (px)</th>
                        <th scope="col">Native</th>
                        <th scope="col">Scale</th>
                        <th scope="col">Pixel count</th>
                        <th scope="col">Export</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outputPlan.blocks.map((block) => (
                        <tr key={block.screenId}>
                          <td>
                            <div className="row">
                              <span className="list__swatch" style={{ background: block.color }} aria-hidden="true" />
                              <span className="truncate" title={block.name}>
                                {block.name}
                              </span>
                            </div>
                          </td>
                          <td className="numeric">
                            {block.rect.x},{block.rect.y} {block.rect.width}×{block.rect.height}
                          </td>
                          <td className="numeric">
                            {block.native.width}×{block.native.height}
                          </td>
                          <td className="numeric">{block.scaled ? 'scaled' : '1:1'}</td>
                          <td className="numeric">{(block.rect.width * block.rect.height).toLocaleString()}</td>
                          <td>
                            <IconButton
                              size="sm"
                              icon={block.exportVisible ? 'eye' : 'eyeOff'}
                              label={block.exportVisible ? `Exclude ${block.name} from exports` : `Include ${block.name} in exports`}
                              onClick={() => editorStore.dispatch({ type: 'toggleExportVisible', ids: [block.screenId] })}
                            />
                            <IconButton
                              size="sm"
                              icon="pencil"
                              label={`Select ${block.name} in the Stage Designer to edit its region`}
                              onClick={() => {
                                editorStore.dispatch({ type: 'select', ids: [block.screenId] })
                                command('tools.stageDesigner')
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
          ))}

          <Panel title="All screens" icon="layers">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Screen</th>
                    <th scope="col">Physical</th>
                    <th scope="col">Native</th>
                    <th scope="col">Output</th>
                    <th scope="col">Region</th>
                    <th scope="col">Export</th>
                  </tr>
                </thead>
                <tbody>
                  {project.screens.map((screen) => {
                    const output = project.outputs.find((candidate) => candidate.id === screen.mapping.outputId)
                    return (
                      <tr key={screen.id}>
                        <td>
                          <div className="row">
                            <span className="list__swatch" style={{ background: screen.color }} aria-hidden="true" />
                            <span className="truncate">{screen.name}</span>
                          </div>
                        </td>
                        <td className="numeric">
                          {formatLength(screen.widthMm, unit)} × {formatLength(screen.heightMm, unit)}
                        </td>
                        <td className="numeric">
                          {screen.pixelWidth}×{screen.pixelHeight}
                        </td>
                        <td>{output?.name ?? <span className="muted">unassigned</span>}</td>
                        <td className="numeric">
                          {Math.round(screen.mapping.region.x)},{Math.round(screen.mapping.region.y)}{' '}
                          {Math.round(screen.mapping.region.width)}×{Math.round(screen.mapping.region.height)}
                        </td>
                        <td>
                          {screen.mapping.exportVisible ? (
                            <Badge tone="success" tooltip="Included in exports">included</Badge>
                          ) : (
                            <Badge tone="warning" tooltip="Excluded from exports">excluded</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <Panel title="Export" icon="export">
          <PanelSection title="Destination">
            <TextField
              label="Export folder"
              value={exportSettings.directory ?? ''}
              onChange={(value) => patchExportSettings({ directory: value || null })}
              commitOnBlur
              placeholder="Defaults to an Exports folder next to the project"
              hint="Leave empty to write into the project’s `Exports` folder."
            />
            <div className="row row--wrap">
              <Button
                size="sm"
                icon="folder"
                tooltip="Choose the folder exports are written to"
                onClick={() => {
                  void (async () => {
                    const api = window.cuepoint
                    if (!api) return
                    const result = await api.app.chooseDirectory({
                      title: 'Choose an export folder',
                      defaultPath: exportSettings.directory ?? undefined
                    })
                    if (result.ok && result.data) patchExportSettings({ directory: result.data })
                  })()
                }}
              >
                Choose folder
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="external"
                tooltip="Open the current export folder in File Explorer"
                onClick={() => {
                  void (async () => {
                    const api = window.cuepoint
                    if (!api) return
                    const target = exportSettings.directory
                    if (!target) {
                      notify('info', 'No export folder set', 'Export once, or choose a folder, then use this button.')
                      return
                    }
                    await api.app.openPath(target)
                  })()
                }}
              >
                Open folder
              </Button>
            </div>
          </PanelSection>

          <PanelSection title="Formats">
            {EXPORT_KINDS.map((entry) => (
              <div key={entry.kind} className="row">
                <Button
                  size="sm"
                  variant="ghost"
                  icon="export"
                  tooltip={entry.hint}
                  disabled={exporting}
                  onClick={() => void runExport([entry.kind])}
                >
                  {entry.label}
                </Button>
              </div>
            ))}
            <Button
              variant="primary"
              icon="export"
              tooltip="Export every format listed above in one run"
              disabled={exporting}
              onClick={() => setShowExport(true)}
            >
              Export all formats…
            </Button>
          </PanelSection>

          <PanelSection title="Documented limitations">
            <Callout tone="info">
              CuePoint writes PNG, CSV and its own versioned JSON mapping format. It does <strong>not</strong> claim
              compatibility with Resolume Arena or any other product’s proprietary project or preset format, because
              those formats are undocumented and change between releases. Use the CSV table or the JSON document to
              drive third-party software, and verify against that product’s own documentation.
            </Callout>
          </PanelSection>

          {exportReport ? (
            <PanelSection title="Last export">
              <p className="muted">
                {exportReport.artifacts.length} file(s) · {formatBytes(exportReport.totalBytes)} ·{' '}
                {new Date(exportReport.finishedAt).toLocaleTimeString()}
              </p>
              {exportReport.warnings.length > 0 ? (
                <IssueList issues={exportReport.warnings.map((message) => ({ level: 'warning', message }))} />
              ) : null}
              <ul className="list">
                {exportReport.artifacts.slice(0, 24).map((artifact) => (
                  <li key={artifact.path} className="list__item list__item--compact">
                    <Icon name="download" size={13} />
                    <span className="list__label" title={artifact.path}>
                      {artifact.label}
                    </span>
                    <span className="list__meta">{formatBytes(artifact.bytes)}</span>
                    <IconButton
                      size="sm"
                      icon="external"
                      label={`Reveal ${artifact.label} in File Explorer`}
                      onClick={() => {
                        void window.cuepoint?.app.revealPath(artifact.path)
                      }}
                    />
                  </li>
                ))}
              </ul>
            </PanelSection>
          ) : null}
        </Panel>
      </div>

      {showExport ? (
        <Modal
          title="Export pixel maps and mapping data"
          onClose={() => setShowExport(false)}
          footer={
            <>
              <span className="muted">
                {state.path ? `Project: ${state.path}` : 'This project has not been saved yet.'}
              </span>
              <div className="spacer" />
              <Button onClick={() => setShowExport(false)}>Cancel</Button>
              <Button
                variant="primary"
                icon="export"
                disabled={exporting || !state.path}
                onClick={() => {
                  void runExport(EXPORT_KINDS.map((entry) => entry.kind))
                  setShowExport(false)
                }}
              >
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            </>
          }
        >
          <Callout tone="info" title="What will be written">
            Each selected format is written into the export folder. Exports use the stored logical stage model, never
            the current zoom or pan.
          </Callout>
          <div className="column">
            <CheckboxField
              label="Include grid on map exports"
              checked={exportSettings.includeGrid}
              onChange={(value) => patchExportSettings({ includeGrid: value })}
              hint="Draws the stage grid over pixel-map exports."
            />
            <CheckboxField
              label="Include screen labels"
              checked={exportSettings.includeLabels}
              onChange={(value) => patchExportSettings({ includeLabels: value })}
            />
            <CheckboxField
              label="Include screen borders"
              checked={exportSettings.includeBorders}
              onChange={(value) => patchExportSettings({ includeBorders: value })}
            />
            <CheckboxField
              label="Also write per-screen guides"
              checked={exportSettings.perScreenGuides}
              onChange={(value) => patchExportSettings({ perScreenGuides: value })}
            />
            <CheckboxField
              label="Also write the stage layout"
              checked={exportSettings.stageLayout}
              onChange={(value) => patchExportSettings({ stageLayout: value })}
            />
          </div>
          <div className="field__row">
            <NumberField
              label="Map scale"
              unit="%"
              value={exportSettings.mapScalePercent}
              min={10}
              max={400}
              step={10}
              precision={0}
              hint="Scales exported map images. Coordinates in CSV and JSON are never scaled."
              onChange={(value) => patchExportSettings({ mapScalePercent: Math.round(value) })}
            />
            <NumberField
              label="JSON indent"
              value={exportSettings.jsonIndent}
              min={0}
              max={8}
              precision={0}
              onChange={(value) => patchExportSettings({ jsonIndent: Math.round(value) })}
            />
          </div>
          <SelectField
            label="CSV delimiter"
            value={exportSettings.csvDelimiter}
            options={[
              { value: ',', label: 'Comma ( , )' },
              { value: ';', label: 'Semicolon ( ; )' },
              { value: '\t', label: 'Tab' }
            ]}
            onChange={(value) => patchExportSettings({ csvDelimiter: value as ExportSettings['csvDelimiter'] })}
          />
          <div className="column">
            {EXPORT_KINDS.map((entry) => (
              <div key={entry.kind} className="row">
                <Badge tone="accent">{entry.kind}</Badge>
                <span className="secondary">{entry.hint}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Pixel limits: each output may be {LIMITS.minOutputPixel}–{LIMITS.maxOutputPixel} px per edge; a screen may
            hold up to {LIMITS.maxPixelCount.toLocaleString()} pixels.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
