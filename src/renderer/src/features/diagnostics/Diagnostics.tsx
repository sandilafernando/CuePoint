import { useEffect, useState } from 'react'
import type { LogEntry } from '@shared/appTypes'
import { formatBytes, formatDuration } from '../../components/Shell'
import {
  Badge,
  Button,
  Callout,
  IconButton,
  IssueList,
  Metric,
  Panel,
  SearchInput,
  SelectField,
  StatusDot
} from '../../components/ui'
import { useApp } from '../../state/AppState'

/**
 * Diagnostics dashboard.
 *
 * Reports what the application actually measured: versions, paths, database size, free
 * space, NDI runtime and helper state, per-source statistics and recent log entries. Raw
 * stack traces stay in the log files rather than in dialogs.
 */

export function Diagnostics(): JSX.Element {
  const { diagnosticsReport, refreshDiagnostics, notify, ndi, settings, updateSettings } = useApp()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setBusy(true)
    await refreshDiagnostics()
    const api = window.cuepoint
    if (api) {
      const result = await api.diagnostics.logs({ limit: 400 })
      if (result.ok) setLogs(result.data)
    }
    setBusy(false)
  }

  useEffect(() => {
    // Deliberately once per visit: the report is a snapshot, and `load` closes over live state.
    void load()
  }, [])

  // The global shortcut is handled once in App; this page only offers its own buttons.

  const report = diagnosticsReport
  const filteredLogs = logs.filter((entry) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return (
      entry.message.toLowerCase().includes(needle) ||
      entry.scope.toLowerCase().includes(needle) ||
      (entry.detail ?? '').toLowerCase().includes(needle)
    )
  })

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">Diagnostics</span>
        <Button size="sm" icon="refresh" tooltip="Re-read every diagnostic value" disabled={busy} onClick={() => void load()}>
          {busy ? 'Reading…' : 'Refresh'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="copy"
          tooltip="Copy a full diagnostic report to the clipboard (Ctrl+Shift+C)"
          onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:copy-diagnostics'))}
        >
          Copy report
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="save"
          tooltip="Write the report to a text file in the logs folder"
          onClick={() => {
            void (async () => {
              const api = window.cuepoint
              if (!api) return
              const result = await api.diagnostics.writeReport()
              if (result.ok) {
                notify('success', 'Report written', result.data)
              } else {
                notify('error', 'Report could not be written', result.error.message)
              }
            })()
          }}
        >
          Write to file
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="folder"
          tooltip="Open the logs folder"
          onClick={() => void window.cuepoint?.app.openPath(report?.paths.logs ?? '')}
        >
          Open logs
        </Button>
        <div className="toolbar__spacer" />
        <SelectField
          label="Log level"
          value={settings.advanced.logLevel}
          options={[
            { value: 'error', label: 'Errors only' },
            { value: 'warn', label: 'Warnings and errors' },
            { value: 'info', label: 'Normal' },
            { value: 'debug', label: 'Debug' }
          ]}
          onChange={(value) => void updateSettings({ advanced: { ...settings.advanced, logLevel: value as 'error' | 'warn' | 'info' | 'debug' } })}
        />
      </div>

      <div className="scroll-area">
        {!report ? (
          <Callout tone="info">Reading diagnostics…</Callout>
        ) : (
          <>
            <div>
              <h2 className="section-title">Runtime</h2>
              <p className="section-subtitle">
                {report.app.name} {report.app.version} · {report.app.packaged ? 'installed build' : 'development build'}
              </p>
            </div>

            <div className="grid-3">
              <Metric label="Electron" value={report.runtime.electron} />
              <Metric label="Chromium" value={report.runtime.chrome} />
              <Metric label="Node" value={report.runtime.node} />
              <Metric label="V8" value={report.runtime.v8} />
              <Metric label="Operating system" value={report.runtime.os} />
              <Metric label="Architecture" value={report.runtime.arch} />
              <Metric label="CPU cores" value={report.hardware.cpuCount} />
              <Metric label="System memory" value={`${(report.hardware.totalMemoryMb / 1024).toFixed(1)} GB`} />
              <Metric label="Free memory" value={`${(report.hardware.freeMemoryMb / 1024).toFixed(1)} GB`} />
              <Metric label="CuePoint memory" value={`${report.hardware.appMemoryMb} MB`} hint="Working set of the renderer and main process" />
            </div>

            <Panel title="NDI" icon="ndi">
              <div className="row row--wrap">
                <StatusDot tone={report.ndi.available ? (report.ndi.helperRunning ? 'ok' : 'idle') : 'warn'} label={report.ndi.available ? 'Runtime detected' : 'Runtime missing'} />
                <span>
                  {report.ndi.available
                    ? `NDI runtime ${report.ndi.runtimeVersion ?? 'detected'}`
                    : report.ndi.reason ?? 'NDI runtime not detected'}
                </span>
                <Badge tone={report.ndi.helperRunning ? 'success' : 'neutral'}>
                  helper {report.ndi.helperRunning ? `pid ${report.ndi.helperPid ?? '—'}` : 'stopped'}
                </Badge>
                {report.ndi.restartCount > 0 ? <Badge tone="warning">{report.ndi.restartCount} restart(s)</Badge> : null}
              </div>
              <dl className="kv">
                <dt>Runtime DLL</dt>
                <dd className="mono truncate">{report.ndi.dllPath ?? 'not found'}</dd>
                <dt>Helper started</dt>
                <dd>{report.ndi.helperStartedAt ? new Date(report.ndi.helperStartedAt).toLocaleString() : '—'}</dd>
                <dt>Last error</dt>
                <dd>{report.ndi.lastError ?? 'none'}</dd>
              </dl>
              {report.ndiSources.length === 0 ? (
                <p className="muted">No connected sources.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Source</th>
                        <th scope="col">Size</th>
                        <th scope="col">Received</th>
                        <th scope="col">Rendered</th>
                        <th scope="col">Frame age</th>
                        <th scope="col">Avg age</th>
                        <th scope="col">Dropped</th>
                        <th scope="col">Skipped</th>
                        <th scope="col">Reconnects</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.ndiSources.map((stat) => (
                        <tr key={stat.sourceId}>
                          <td className="truncate">{stat.name}</td>
                          <td className="numeric">
                            {stat.width}×{stat.height}
                          </td>
                          <td className="numeric">{stat.receivedFps.toFixed(1)}</td>
                          <td className="numeric">{stat.renderedFps.toFixed(1)}</td>
                          <td className="numeric">{stat.frameAgeMs.toFixed(0)} ms</td>
                          <td className="numeric">{stat.averageFrameAgeMs.toFixed(0)} ms</td>
                          <td className="numeric">{stat.droppedFrames}</td>
                          <td className="numeric">{stat.skippedFrames}</td>
                          <td className="numeric">{stat.reconnects}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                <IconButton icon="refresh" label="Refresh NDI status" size="sm" onClick={() => void ndi.refreshRuntime()} /> NDI
                status is read from the helper. “Native” bandwidth is recommended: on NDI 6.2.1 the throughput setting
                was measured to deliver half resolution.
              </p>
            </Panel>

            <Panel title="Storage and database" icon="database">
              <dl className="kv">
                <dt>User data</dt>
                <dd className="mono truncate">{report.paths.userData}</dd>
                <dt>Logs</dt>
                <dd className="mono truncate">{report.paths.logs}</dd>
                <dt>Library database</dt>
                <dd className="mono truncate">
                  {report.database.libraryPath} · {formatBytes(report.database.libraryBytes)} · schema v{report.database.librarySchema}
                </dd>
                <dt>Project file</dt>
                <dd className="mono truncate">
                  {report.database.projectPath ?? 'no project open'}
                  {report.database.projectBytes !== null ? ` · ${formatBytes(report.database.projectBytes)}` : ''}
                  {report.database.projectSchema !== null ? ` · schema v${report.database.projectSchema}` : ''}
                </dd>
                <dt>Recent projects</dt>
                <dd>{report.database.recentProjects}</dd>
                <dt>Export destination</dt>
                <dd>
                  {report.storage.exportDrive ?? '—'}
                  {report.storage.exportFreeBytes !== null ? ` · ${formatBytes(report.storage.exportFreeBytes)} free` : ''}
                </dd>
                <dt>Recording destination</dt>
                <dd>
                  {report.storage.recordingDrive ?? '—'}
                  {report.storage.recordingFreeBytes !== null ? ` · ${formatBytes(report.storage.recordingFreeBytes)} free` : ''}
                </dd>
              </dl>
            </Panel>

            <div className="grid-2">
              <Panel title="Project" icon="stage">
                <dl className="kv">
                  <dt>Path</dt>
                  <dd className="mono truncate">{report.project.path ?? 'no project open'}</dd>
                  <dt>Screens</dt>
                  <dd>{report.project.screens}</dd>
                  <dt>Outputs</dt>
                  <dd>{report.project.outputs}</dd>
                  <dt>Validation</dt>
                  <dd>
                    {report.project.validationErrors.length === 0
                      ? 'no errors'
                      : `${report.project.validationErrors.length} error(s)`}
                  </dd>
                  <dt>Mapping issues</dt>
                  <dd>
                    {report.project.mappingIssues.error} error(s) · {report.project.mappingIssues.warning} warning(s) ·{' '}
                    {report.project.mappingIssues.info} notice(s)
                  </dd>
                </dl>
                {report.project.validationErrors.length > 0 ? (
                  <IssueList issues={report.project.validationErrors.map((message) => ({ level: 'error', message }))} />
                ) : null}
              </Panel>

              <Panel title="Recording" icon="record">
                <dl className="kv">
                  <dt>State</dt>
                  <dd>{report.recording.state}</dd>
                  <dt>Last file</dt>
                  <dd className="mono truncate">{report.recording.lastFile ?? '—'}</dd>
                  <dt>Encoder available</dt>
                  <dd>{report.recording.encoderAvailable ? 'yes' : 'no'}</dd>
                  <dt>Encoder detail</dt>
                  <dd>{report.recording.encoderDetail}</dd>
                  <dt>Last verification</dt>
                  <dd>
                    {report.recording.lastVerified
                      ? `${report.recording.lastVerified.decodable ? 'decodable' : 'unverified'} · ${report.recording.lastVerified.detail}`
                      : 'not checked'}
                  </dd>
                </dl>
              </Panel>
            </div>

            <Panel
              title="Recent log entries"
              icon="activity"
              actions={
                <>
                  <SearchInput label="Search log entries" placeholder="Filter by message, scope or detail" value={query} onChange={setQuery} />
                  <Button
                    size="sm"
                    variant="danger"
                    icon="trash"
                    tooltip="Delete the log files for this installation"
                    onClick={() => {
                      void (async () => {
                        const api = window.cuepoint
                        if (!api) return
                        const result = await api.diagnostics.clearLogs()
                        if (result.ok) {
                          setLogs([])
                          notify('info', 'Logs cleared')
                        }
                      })()
                    }}
                  >
                    Clear logs
                  </Button>
                </>
              }
            >
              <div className="row row--wrap">
                {report.logs.recentErrors.length > 0 ? (
                  <Badge tone="danger">{report.logs.recentErrors.length} recent error(s)</Badge>
                ) : null}
                {report.logs.recentWarnings.length > 0 ? (
                  <Badge tone="warning">{report.logs.recentWarnings.length} recent warning(s)</Badge>
                ) : null}
              </div>
              {filteredLogs.length === 0 ? (
                <p className="muted">No log entries match the current filter.</p>
              ) : (
                <pre className="code-block" aria-label="Application log">
                  {filteredLogs
                    .slice(-200)
                    .map(
                      (entry) =>
                        `${entry.ts}  ${entry.level.toUpperCase().padEnd(5)} ${entry.scope.padEnd(12)} ${entry.message}${entry.detail ? `\n    ${entry.detail}` : ''}`
                    )
                    .join('\n')}
                </pre>
              )}
            </Panel>

            <Panel title="Long-duration checks" icon="clock">
              <IssueList
                issues={[
                  {
                    level: 'info',
                    message:
                      'Memory: watch “CuePoint memory” while NDI previews run. With the default single-frame-per-source buffer this figure is expected to stay flat; sustained growth indicates a leak and should be reported with the log file.'
                  },
                  {
                    level: 'info',
                    message:
                      'Frame age: the measured age includes the helper queue and the bridge hop. Values that climb steadily mean a consumer cannot keep up with the source rate.'
                  },
                  {
                    level: 'info',
                    message:
                      `Recording state and elapsed time can be checked here during a long capture. Current status: ${report.recording.state}${report.recording.lastFile ? ` (${formatDuration(0)} last run ${report.recording.lastFile})` : ''}.`
                  }
                ]}
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}
