import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecordingConfig, RecordingTarget } from '@shared/appTypes'
import { LIMITS } from '@shared/validation'
import { formatBytes, formatDuration } from '../../components/Shell'
import {
  Badge,
  Button,
  Callout,
  CheckboxField,
  EmptyState,
  IconButton,
  IssueList,
  Metric,
  NumberField,
  Panel,
  PanelSection,
  ProgressBar,
  Segmented,
  SelectField,
  StatusDot,
  TextField
} from '../../components/ui'
import { useApp } from '../../state/AppState'
import type { EditorState } from '../../state/editor'
import { formatAccelerator } from '@shared/shortcuts'
import { CaptureSession, pickMimeType, type CaptureProgress } from './capture'

/**
 * Recording workspace.
 *
 * The renderer draws the target and encodes it; the main process owns the file and writes
 * encoded chunks in order. A recording is only reported as finished once the file has been
 * finalised and verified by the core.
 */

const TARGETS: { value: RecordingTarget; label: string; tooltip: string }[] = [
  { value: 'stage', label: 'Stage', tooltip: 'Record a clean top-down render of the whole stage layout.' },
  { value: 'screen', label: 'Screen', tooltip: 'Record a single screen at its native pixel resolution.' },
  { value: 'ndi', label: 'NDI source', tooltip: 'Record the live frames received from one NDI source.' }
]

export function Recording({ state }: { state: EditorState }): JSX.Element {
  const { recording, ndi, notify, openModal, closeModal, command } = useApp()
  const sessionRef = useRef<CaptureSession | null>(null)
  const [active, setActive] = useState(false)
  const [progress, setProgress] = useState<CaptureProgress | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [starting, setStarting] = useState(false)

  const config = recording.config
  const status = recording.status
  const encoderAvailable = status?.encoder.available ?? false
  const mimeType = useMemo(() => pickMimeType(), [])

  const patch = useCallback(
    (next: Partial<RecordingConfig>) => void recording.updateConfig(next),
    [recording]
  )

  const pushLog = useCallback((message: string) => {
    setLogs((current) => [...current.slice(-40), `${new Date().toLocaleTimeString()} — ${message}`])
  }, [])

  const stopRecording = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    setActive(false)
    try {
      const entry = await session.stop()
      await recording.refresh()
      if (entry) {
        notify(
          'success',
          `Recording finalised (${formatBytes(entry.sizeBytes)})`,
          entry.verified?.decodable
            ? `Verified: ${entry.verified.detail}`
            : 'Finalised. Verification could not confirm decodability — see the recording entry.'
        )
      }
      pushLog('Recording finalised.')
    } catch (error) {
      notify('error', 'Recording could not be finalised', String(error))
      pushLog(`Finalise failed: ${String(error)}`)
    } finally {
      setProgress(null)
    }
  }, [notify, pushLog, recording])

  const cancelRecording = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    setActive(false)
    await session.cancel('Cancelled by the operator.')
    await recording.refresh()
    setProgress(null)
    notify('warning', 'Recording cancelled', 'Written bytes were kept and the file is marked as failed.')
  }, [notify, recording])

  const startRecording = useCallback(async () => {
    if (active || starting) return
    if (!state.project) {
      notify('warning', 'No project open', 'Open a project before recording.')
      return
    }
    if (!mimeType) {
      notify(
        'error',
        'Recording is unavailable in this build',
        'Chromium reports that MediaRecorder cannot encode video, so CuePoint cannot capture output on this machine.'
      )
      return
    }
    const preflight = await window.cuepoint?.recording.start(config)
    if (preflight && !preflight.ok) {
      notify('error', 'Recording cannot start', `${preflight.error.message} ${preflight.error.hint ?? ''}`.trim())
      return
    }
    setStarting(true)
    const session = new CaptureSession(
      {
        project: state.project,
        screen: config.target === 'screen' ? state.project.screens.find((screen) => screen.id === config.screenId) ?? null : null,
        ndiSourceId: config.ndiSourceId
      },
      config,
      {
        onProgress: (next) => {
          setProgress(next)
          recording.reportProgress(next.framesCaptured, next.framesDropped, next.estimatedBytes)
        },
        onError: (message, detail) => {
          notify('error', message, detail)
          pushLog(`${message}${detail ? ` — ${detail}` : ''}`)
        },
        onLog: pushLog
      }
    )
    try {
      await session.start()
      sessionRef.current = session
      setActive(true)
      setLogs([])
      pushLog(`Started ${config.target} recording at ${config.width}×${config.height} @ ${config.fps} fps.`)
      notify('info', 'Recording started', `${config.width}×${config.height} · ${config.fps} fps · ${mimeType}`)
    } catch (error) {
      notify('error', 'Recording could not start', String(error))
      await session.cancel('Start failed.')
    } finally {
      setStarting(false)
    }
  }, [active, config, mimeType, notify, pushLog, recording, starting, state.project])

  useEffect(() => {
    const onToggle = (): void => {
      if (active) void stopRecording()
      else void startRecording()
    }
    window.addEventListener('cuepoint:recording-toggle', onToggle)
    window.addEventListener('cuepoint:recording-start', () => void startRecording())
    window.addEventListener('cuepoint:recording-stop', () => void stopRecording())
    window.addEventListener('cuepoint:recording-abort', () => void cancelRecording())
    return () => {
      window.removeEventListener('cuepoint:recording-toggle', onToggle)
    }
  }, [active, cancelRecording, startRecording, stopRecording])

  useEffect(
    () => () => {
      void sessionRef.current?.cancel('The recording workspace was closed.')
    },
    []
  )

  const elapsedMs = progress?.elapsedMs ?? 0
  const estimatedBytes = progress?.estimatedBytes ?? 0

  if (!state.project) {
    return (
      <div className="workspace">
        <div className="toolbar toolbar--wrap">
          <span className="toolbar__title">Recording</span>
        </div>
        <div className="scroll-area">
          <EmptyState
            icon="record"
            title="No project open"
            message="Recording captures the stage layout, a single screen or an NDI source, so a project must be open first."
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

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">Recording</span>
        <StatusDot
          tone={active ? 'live' : status?.state === 'failed' ? 'error' : 'idle'}
          label={active ? 'Recording in progress' : 'Not recording'}
        />
        <span className="toolbar__field">{active ? `Recording · ${formatDuration(elapsedMs)}` : 'Idle'}</span>
        <span className="toolbar__divider" />
        <Button
          variant="primary"
          icon="record"
          tooltip={`Start capturing the selected target (${formatAccelerator('F9')})`}
          disabled={active || starting}
          onClick={() => void startRecording()}
        >
          {starting ? 'Starting…' : 'Start recording'}
        </Button>
        <Button
          icon="pause"
          tooltip="Pause capture. Reception and the stage remain live."
          disabled={!active}
          onClick={() => {
            void window.cuepoint?.recording.pause().then(() => {
              pushLog('Paused.')
            })
          }}
        >
          Pause
        </Button>
        <Button
          icon="play"
          tooltip="Resume capture after a pause"
          disabled={!active}
          onClick={() => {
            void window.cuepoint?.recording.resume().then(() => pushLog('Resumed.'))
          }}
        >
          Resume
        </Button>
        <Button
          icon="stop"
          tooltip={`Stop capture and finalise the recording file (${formatAccelerator('Shift+F9')})`}
          disabled={!active}
          onClick={() => void stopRecording()}
        >
          Stop &amp; finalise
        </Button>
        <IconButton icon="trash" label="Cancel this recording and mark the file as failed" disabled={!active} onClick={() => void cancelRecording()} />
        <div className="toolbar__spacer" />
        <Button size="sm" variant="ghost" icon="folder" tooltip="Open the recording output folder" onClick={() => void recording.openFolder()}>
          Open folder
        </Button>
      </div>

      <div className="workspace-split">
        <div className="scroll-area">
          {!mimeType ? (
            <Callout tone="error" title="Video encoding is unavailable in this build">
              Chromium reports that MediaRecorder cannot encode WebM video, so CuePoint cannot capture output on this
              machine. No placeholder file will be produced.
            </Callout>
          ) : null}
          {!encoderAvailable && status?.encoder.detail ? (
            <Callout tone="warning" title="FFmpeg was not found">
              {status.encoder.detail} WebM capture still works; MP4 transcoding after finalisation needs FFmpeg on the
              PATH or an explicit path in Settings.
            </Callout>
          ) : null}

          <div className="grid-3">
            <Metric label="Captured frames" value={progress?.framesCaptured ?? status?.framesCaptured ?? 0} hint="Frames drawn and handed to the encoder" />
            <Metric label="Dropped frames" value={progress?.framesDropped ?? status?.framesDropped ?? 0} tone={(progress?.framesDropped ?? 0) > 0 ? 'warning' : 'default'} hint="Frames the pipeline could not render in time" />
            <Metric label="Elapsed" value={formatDuration(elapsedMs)} />
            <Metric label="Estimated size" value={formatBytes(estimatedBytes || status?.estimatedBytes || 0)} hint="Estimated from the configured bitrate" />
            <Metric label="Encoder" value={mimeType ? 'MediaRecorder' : 'unavailable'} hint={mimeType ?? ''} />
            <Metric label="Container" value={config.container.toUpperCase()} />
          </div>

          <Panel title="Progress" icon="activity">
            <ProgressBar
              value={progress?.framesCaptured ?? 0}
              max={Math.max(1, (progress?.framesCaptured ?? 0) + 1)}
              label="Frames captured"
            />
            <p className="muted">
              {config.width} × {config.height} px · {config.fps} fps · {config.bitrateMbps} Mbps ·{' '}
              {progress ? `${formatDuration(elapsedMs)} elapsed` : 'idle'}
            </p>
            {logs.length > 0 ? (
              <pre className="code-block" aria-label="Recording log">
                {logs.join('\n')}
              </pre>
            ) : (
              <p className="muted">Recording events appear here.</p>
            )}
          </Panel>

          <Panel title="Recording history" icon="folder">
            {recording.entries.length === 0 ? (
              <p className="muted">No recordings yet. Finished recordings appear here with their verification result.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Started</th>
                      <th scope="col">Target</th>
                      <th scope="col">Size</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Resolution</th>
                      <th scope="col">State</th>
                      <th scope="col">Verified</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recording.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="nowrap">{new Date(entry.startedAt).toLocaleString()}</td>
                        <td className="truncate" title={entry.label}>
                          {entry.label}
                        </td>
                        <td className="numeric">{formatBytes(entry.sizeBytes)}</td>
                        <td className="numeric">{formatDuration(entry.durationMs)}</td>
                        <td className="numeric">
                          {entry.width}×{entry.height} @ {entry.fps}
                        </td>
                        <td>
                          <Badge tone={entry.state === 'complete' ? 'success' : entry.state === 'failed' ? 'danger' : 'warning'}>
                            {entry.state}
                          </Badge>
                        </td>
                        <td>
                          {entry.verified ? (
                            <Badge tone={entry.verified.decodable ? 'success' : 'warning'} tooltip={entry.verified.detail}>
                              {entry.verified.decodable ? 'decodable' : 'unverified'}
                            </Badge>
                          ) : (
                            <span className="muted">not checked</span>
                          )}
                        </td>
                        <td>
                          <IconButton size="sm" icon="play" label={`Open ${entry.filePath} in the default player`} onClick={() => void window.cuepoint?.app.openPath(entry.filePath)} />
                          <IconButton size="sm" icon="external" label="Reveal this recording in File Explorer" onClick={() => void window.cuepoint?.app.revealPath(entry.filePath)} />
                          <IconButton size="sm" icon="check" label="Re-run verification for this recording" onClick={() => void recording.verify(entry.id)} />
                          <IconButton
                            size="sm"
                            icon="trash"
                            label="Remove this entry from history (the file stays on disk)"
                            onClick={() => void recording.removeEntry(entry.id, false)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {recording.entries.some((entry) => entry.error) ? (
              <IssueList
                issues={recording.entries
                  .filter((entry) => entry.error)
                  .slice(0, 10)
                  .map((entry) => ({ level: 'warning' as const, message: `${entry.label}: ${entry.error}` }))}
              />
            ) : null}
          </Panel>
        </div>

        <Panel title="Capture settings" icon="settings">
          <PanelSection title="Target">
            <Segmented
              label="What to record"
              value={config.target}
              options={TARGETS}
              onChange={(value) => patch({ target: value })}
            />
            {config.target === 'screen' ? (
              <SelectField
                label="Screen"
                value={config.screenId ?? ''}
                options={[
                  { value: '', label: 'Choose a screen…' },
                  ...state.project.screens.map((screen) => ({
                    value: screen.id,
                    label: `${screen.name} (${screen.pixelWidth}×${screen.pixelHeight})`
                  }))
                ]}
                onChange={(value) => patch({ screenId: value || null })}
              />
            ) : null}
            {config.target === 'ndi' ? (
              <SelectField
                label="NDI source"
                value={config.ndiSourceId ?? ''}
                options={[
                  { value: '', label: 'Choose a connected source…' },
                  ...ndi.stats
                    .filter((stat) => stat.connected)
                    .map((stat) => ({ value: stat.sourceId, label: `${stat.name} (${stat.width}×${stat.height})` }))
                ]}
                onChange={(value) => patch({ ndiSourceId: value || null })}
                hint="Connect a source in NDI Studio first."
              />
            ) : null}
          </PanelSection>

          <PanelSection title="Output">
            <div className="field__row">
              <NumberField
                label="Width"
                unit="px"
                value={config.width}
                min={LIMITS.minPixel}
                max={LIMITS.maxPixel}
                step={2}
                precision={0}
                onChange={(value) => patch({ width: Math.round(value) })}
              />
              <NumberField
                label="Height"
                unit="px"
                value={config.height}
                min={LIMITS.minPixel}
                max={LIMITS.maxPixel}
                step={2}
                precision={0}
                onChange={(value) => patch({ height: Math.round(value) })}
              />
            </div>
            <div className="row row--wrap">
              {[
                { label: '1280×720', w: 1280, h: 720 },
                { label: '1920×1080', w: 1920, h: 1080 },
                { label: '2560×1440', w: 2560, h: 1440 }
              ].map((preset) => (
                <Button key={preset.label} size="sm" variant="ghost" tooltip={`Record at ${preset.label}`} onClick={() => patch({ width: preset.w, height: preset.h })}>
                  {preset.label}
                </Button>
              ))}
            </div>
            <NumberField
              label="Frame rate"
              unit="fps"
              value={config.fps}
              min={1}
              max={120}
              precision={0}
              hint="Frames drawn per second. High frame rates with large canvases can drop frames on slower machines — the captured frame count is reported honestly."
              onChange={(value) => patch({ fps: Math.round(value) })}
            />
            <SliderBitrate value={config.bitrateMbps} onChange={(value) => patch({ bitrateMbps: value })} />
            <SelectField
              label="Container"
              value={config.container}
              options={[
                { value: 'webm', label: 'WebM (written directly)' },
                { value: 'mp4', label: 'MP4 (transcoded with FFmpeg after stop)' }
              ]}
              onChange={(value) => patch({ container: value as RecordingConfig['container'] })}
              hint={
                config.container === 'mp4'
                  ? 'MediaRecorder encodes WebM; CuePoint transcodes to MP4 with FFmpeg when the recording is finalised.'
                  : 'WebM is written as captured, with no transcoding step.'
              }
            />
            <CheckboxField
              label="Transcode to MP4 after finalising"
              checked={config.transcodeToMp4}
              onChange={(value) => patch({ transcodeToMp4: value })}
              hint="Requires FFmpeg. Verified playback of the result is your responsibility — CuePoint reports what it could check."
            />
            <CheckboxField
              label="Capture audio"
              checked={config.captureAudio}
              disabled
              onChange={() => undefined}
              hint="Not implemented in this release. CuePoint records video only, and never claims to have captured audio it did not record."
            />
          </PanelSection>

          <PanelSection title="Destination">
            <TextField
              label="Output folder"
              value={config.outputDirectory ?? ''}
              commitOnBlur
              placeholder="Default: CuePoint Recordings in your user data folder"
              onChange={(value) => patch({ outputDirectory: value || null })}
            />
            <div className="row row--wrap">
              <Button
                size="sm"
                icon="folder"
                tooltip="Choose where recordings are written"
                onClick={() => {
                  void (async () => {
                    const api = window.cuepoint
                    if (!api) return
                    const result = await api.app.chooseDirectory({
                      title: 'Choose a recording folder',
                      defaultPath: config.outputDirectory ?? undefined
                    })
                    if (result.ok && result.data) patch({ outputDirectory: result.data })
                  })()
                }}
              >
                Choose folder
              </Button>
              <Button size="sm" variant="ghost" icon="folder" tooltip="Open the output folder" onClick={() => void recording.openFolder()}>
                Open
              </Button>
            </div>
            <TextField
              label="File name template"
              value={config.fileNameTemplate}
              commitOnBlur
              onChange={(value) => patch({ fileNameTemplate: value })}
              hint="Tokens: {project}, {target}, {date}, {time}, {index}. The extension is added automatically."
            />
            <dl className="kv">
              <dt>Example</dt>
              <dd className="mono truncate">
                {config.fileNameTemplate
                  .replace('{project}', state.project.meta.name)
                  .replace('{target}', config.target)
                  .replace('{date}', new Date().toISOString().slice(0, 10))
                  .replace('{time}', '14-32-05')
                  .replace('{index}', '01')}
                .{config.container}
              </dd>
            </dl>
          </PanelSection>

          <PanelSection title="Before you record">
            <IssueList
              issues={[
                {
                  level: config.target === 'ndi' && !config.ndiSourceId ? 'warning' : 'info',
                  message:
                    config.target === 'ndi'
                      ? config.ndiSourceId
                        ? 'NDI capture records the frames the helper actually received; a stalled source produces a stalled recording.'
                        : 'Choose a connected NDI source before recording.'
                      : 'The stage and screen targets are rendered by CuePoint itself and are deterministic for a given project.'
                },
                {
                  level: encoderAvailable ? 'info' : 'warning',
                  message: encoderAvailable
                    ? `FFmpeg detected for transcoding: ${status?.encoder.name ?? 'ffmpeg'}`
                    : 'FFmpeg was not found, so MP4 transcoding is unavailable. WebM capture is unaffected.'
                }
              ]}
            />
          </PanelSection>

          <PanelSection title="Danger zone">
            <Button
              size="sm"
              variant="danger"
              icon="trash"
              tooltip="Delete every recording entry and file listed in history"
              disabled={recording.entries.length === 0}
              onClick={() =>
                openModal({
                  kind: 'confirm',
                  title: 'Delete recordings',
                  message: `Delete ${recording.entries.length} recording file(s) from disk?`,
                  detail: 'This permanently deletes the video files. It cannot be undone.',
                  confirmLabel: 'Delete files',
                  onConfirm: () => {
                    void (async () => {
                      for (const entry of recording.entries) {
                        await recording.removeEntry(entry.id, true)
                      }
                      closeModal()
                      notify('info', 'Recordings deleted')
                    })()
                  }
                })
              }
            >
              Delete all recordings
            </Button>
          </PanelSection>
        </Panel>
      </div>
    </div>
  )
}

function SliderBitrate({ value, onChange }: { value: number; onChange(value: number): void }): JSX.Element {
  return (
    <div className="field">
      <label className="field__label" htmlFor="recording-bitrate">
        <span>Video bitrate</span>
        <span className="muted mono">{value} Mbps</span>
      </label>
      <div className="slider">
        <input
          id="recording-bitrate"
          type="range"
          min={1}
          max={60}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="slider__value mono">{value} Mbps</span>
      </div>
      <p className="field__hint">
        Higher bitrates preserve detail on busy content but produce larger files. The estimate uses this value.
      </p>
    </div>
  )
}
