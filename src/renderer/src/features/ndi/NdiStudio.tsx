import { useEffect, useMemo, useRef, useState } from 'react'
import type { NdiSourceInfo, NdiSourceStats } from '@shared/appTypes'
import { STATUS_REFRESH_MS } from '@shared/constants'
import { formatAccelerator } from '@shared/shortcuts'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  IconButton,
  IssueList,
  Metric,
  Panel,
  PanelSection,
  SliderField,
  StatusDot
} from '../../components/ui'
import { useApp } from '../../state/AppState'
import { blitFrame, frameHub, type FramePacket } from './frameHub'

/**
 * NDI Studio.
 *
 * Live preview tiles for every connected source. Frames arrive from the native helper over
 * a MessagePort subscribed once by `AppState`, so the hub keeps only the newest frame per
 * source and a slow tile can never stall reception.
 *
 * Every number shown here is measured. Received FPS, rendered FPS, frame age and
 * dropped/skipped counts come from the helper and the renderer, and are reported back to
 * the supervisor so the Diagnostics page sees the same figures.
 */

export function NdiStudio(): JSX.Element {
  const { ndi, notify, settings, updateSettings } = useApp()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullscreenId, setFullscreenId] = useState<string | null>(null)

  const sourcesByKey = useMemo(() => {
    const map = new Map<string, NdiSourceInfo>()
    for (const source of ndi.sources) map.set(source.urlAddress || source.name, source)
    return map
  }, [ndi.sources])

  useEffect(() => {
    const refresh = (): void => void ndi.discover()
    const connectSelected = (): void => {
      const source = selectedId ? sourcesByKey.get(selectedId) : undefined
      if (source) void ndi.connect(source)
      else notify('info', 'Select a source first', 'Highlight a discovered source, then press Ctrl+Enter.')
    }
    window.addEventListener('cuepoint:ndi-discover', refresh)
    window.addEventListener('cuepoint:ndi-connect', connectSelected)
    return () => {
      window.removeEventListener('cuepoint:ndi-discover', refresh)
      window.removeEventListener('cuepoint:ndi-connect', connectSelected)
    }
  }, [ndi, notify, selectedId, sourcesByKey])

  const connected = ndi.stats.filter((stat) => stat.connected)
  const runtime = ndi.runtime

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">NDI Studio</span>
        <div className="toolbar__field">
          <StatusDot
            tone={runtime?.available ? (runtime.helperRunning ? 'ok' : 'idle') : 'warn'}
            label={runtime?.available ? 'NDI runtime available' : 'NDI runtime unavailable'}
          />
          <span>
            {runtime?.available
              ? `NDI runtime ${runtime.runtimeVersion ?? 'detected'} · helper ${runtime.helperRunning ? `running (pid ${runtime.helperPid ?? '—'})` : 'stopped'}`
              : runtime?.reason ?? 'NDI runtime not detected yet'}
          </span>
        </div>
        <span className="toolbar__divider" />
        <Button
          size="sm"
          icon="refresh"
          tooltip={`Re-scan the network for NDI sources (${formatAccelerator('F5')})`}
          disabled={ndi.discovering}
          onClick={() => void ndi.discover()}
        >
          {ndi.discovering ? 'Searching…' : 'Discover sources'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="power"
          tooltip={runtime?.helperRunning ? 'Stop the native NDI helper process' : 'Start the native NDI helper process'}
          disabled={!runtime?.available}
          onClick={() => void (runtime?.helperRunning ? ndi.stopHelper() : ndi.startHelper())}
        >
          {runtime?.helperRunning ? 'Stop helper' : 'Start helper'}
        </Button>
        <div className="toolbar__spacer" />
        <div style={{ width: 220 }}>
          <SliderField
            label="Preview rate"
            value={settings.ndi.previewFps}
            min={1}
            max={60}
            step={1}
            unit="fps"
            format={(value) => `${value} fps`}
            hint="Frames drawn per second. Reception is never throttled — this only limits how often the UI redraws."
            onChange={(value) => {
              void updateSettings({ ndi: { ...settings.ndi, previewFps: Math.round(value) } })
              void window.cuepoint?.ndi.setPreviewFps(Math.round(value))
            }}
          />
        </div>
      </div>

      <div className="workspace-split">
        <div className="scroll-area">
          {!runtime?.available ? (
            <Callout
              tone="warning"
              title="NDI runtime not detected"
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  icon="external"
                  tooltip="Open the NDI runtime download page in your browser"
                  onClick={() => void window.cuepoint?.app.openExternal('https://ndi.video/tools/ndi-runtime/')}
                >
                  Get NDI runtime
                </Button>
              }
            >
              CuePoint loads `Processing.NDI.Lib.x64.dll` from the installed NDI runtime. Install the NDI Runtime
              (NDI Tools) from NewTek/Vizrt, then restart CuePoint. CuePoint does not bundle the runtime — redistribution
              is not permitted by its licence.
              {runtime?.dllPath ? <div className="mono truncate">{runtime.dllPath}</div> : null}
            </Callout>
          ) : null}

          {runtime?.lastError ? (
            <Callout tone="error" title="Last NDI error">
              {runtime.lastError}
              {runtime.restartCount > 0 ? ` The helper has been restarted ${runtime.restartCount} time(s).` : ''}
            </Callout>
          ) : null}

          {connected.length === 0 ? (
            <EmptyState
              icon="ndi"
              title="No sources connected"
              message="Connect to a discovered source to start a live preview. NDI reception runs in a separate native helper process, so stage editing stays responsive."
              actions={
                <Button variant="primary" icon="refresh" onClick={() => void ndi.discover()}>
                  Discover sources
                </Button>
              }
            />
          ) : (
            <div className="ndi-grid">
              {connected.map((stat) => (
                <NdiPreviewTile
                  key={stat.sourceId}
                  stats={stat}
                  previewFps={settings.ndi.previewFps}
                  colorFormat={settings.ndi.colorFormat}
                  onPause={() => void ndi.setPaused(stat.sourceId, !stat.paused)}
                  onDisconnect={() => void ndi.disconnect(stat.sourceId)}
                  onFullscreen={() => setFullscreenId(stat.sourceId)}
                />
              ))}
            </div>
          )}

          <Panel title="Measured statistics" icon="activity">
            {connected.length === 0 ? (
              <p className="muted">Statistics appear once a source is connected.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Resolution</th>
                      <th scope="col">Format</th>
                      <th scope="col">Nominal</th>
                      <th scope="col">Received FPS</th>
                      <th scope="col">Rendered FPS</th>
                      <th scope="col">Frame age</th>
                      <th scope="col">Frames</th>
                      <th scope="col">Dropped</th>
                      <th scope="col">Skipped</th>
                      <th scope="col">Reconnects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connected.map((stat) => (
                      <tr key={stat.sourceId}>
                        <td className="truncate" title={stat.name}>
                          {stat.name}
                        </td>
                        <td className="numeric">
                          {stat.width}×{stat.height}
                        </td>
                        <td className="mono">{fourCCLabel(stat.fourCC)}</td>
                        <td className="numeric">
                          {stat.frameRateDenominator
                            ? (stat.frameRateNumerator / stat.frameRateDenominator).toFixed(2)
                            : '—'}
                        </td>
                        <td className="numeric">{stat.receivedFps.toFixed(1)}</td>
                        <td className="numeric">{stat.renderedFps.toFixed(1)}</td>
                        <td className="numeric">{stat.frameAgeMs.toFixed(0)} ms</td>
                        <td className="numeric">{stat.receivedFrames}</td>
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
              Received FPS and frame counts are measured inside the native helper. Rendered FPS and frame age are
              measured where the frame reaches the UI. A paused preview still receives frames — only drawing stops.
            </p>
          </Panel>
        </div>

        <Panel
          title="Discovered sources"
          icon="ndi"
          actions={
            <IconButton
              icon="refresh"
              label="Scan the network again (F5)"
              disabled={ndi.discovering}
              onClick={() => void ndi.discover()}
            />
          }
        >
          <PanelSection title={`${ndi.sources.length} source(s) on the network`}>
            {ndi.sources.length === 0 ? (
              <p className="muted">
                Nothing discovered yet. Press Discover sources, check that the sender is on the same subnet and that
                Windows Firewall allows NDI.
              </p>
            ) : (
              <ul className="list">
                {ndi.sources.map((source) => {
                  const key = source.urlAddress || source.name
                  const isConnected = ndi.stats.some((stat) => stat.sourceId === key && stat.connected)
                  return (
                    <li key={key}>
                      <div
                        role="option"
                        aria-selected={selectedId === key}
                        tabIndex={0}
                        className={selectedId === key ? 'list__item is-selected' : 'list__item'}
                        onClick={() => setSelectedId(key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void ndi.connect(source)
                        }}
                        title={`${source.name}\n${source.urlAddress || 'address not published'}\ngroups: ${source.groups || 'default'}`}
                      >
                        <Icon name="ndi" size={14} />
                        <span className="list__label">{source.name}</span>
                        {isConnected ? <Badge tone="success">live</Badge> : null}
                        <IconButton
                          size="sm"
                          icon={isConnected ? 'unlink' : 'link'}
                          label={
                            isConnected
                              ? `Disconnect ${source.name} (other sources keep running)`
                              : `Connect to ${source.name}`
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            if (isConnected) void ndi.disconnect(key)
                            else void ndi.connect(source)
                          }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="unlink"
              tooltip="Disconnect every source without stopping the helper"
              disabled={connected.length === 0}
              onClick={() => {
                void (async () => {
                  for (const stat of connected) await ndi.disconnect(stat.sourceId)
                  notify('info', 'All sources disconnected')
                })()
              }}
            >
              Disconnect all
            </Button>
          </PanelSection>

          <PanelSection title="Runtime and settings">
            <dl className="kv">
              <dt>Runtime version</dt>
              <dd>{runtime?.runtimeVersion ?? '—'}</dd>
            </dl>
            <dl className="kv">
              <dt>Runtime DLL</dt>
              <dd className="mono truncate" title={runtime?.dllPath ?? ''}>
                {runtime?.dllPath ?? 'not found'}
              </dd>
            </dl>
            <dl className="kv">
              <dt>Helper process</dt>
              <dd>
                {runtime?.helperRunning ? `running · pid ${runtime.helperPid ?? '—'}` : 'stopped'}
                {runtime?.helperStartedAt
                  ? ` · since ${new Date(runtime.helperStartedAt).toLocaleTimeString()}`
                  : ''}
              </dd>
            </dl>
            <dl className="kv">
              <dt>Receive bandwidth</dt>
              <dd>
                <Badge tone={settings.ndi.bandwidth === 'native' ? 'success' : 'warning'}>
                  {settings.ndi.bandwidth === 'native' ? 'native resolution' : 'throughput (may halve resolution)'}
                </Badge>
              </dd>
            </dl>
            <IssueList
              issues={[
                {
                  level: 'info',
                  message:
                    'Measured on NDI 6.2.1: requesting “throughput” (bandwidth enum 0) delivers half resolution; “native” delivers the full frame size. CuePoint defaults to native.'
                }
              ]}
            />
            <Button
              size="sm"
              variant="ghost"
              icon="settings"
              tooltip="Open the NDI section of Settings"
              onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:open-settings', { detail: 'ndi' }))}
            >
              NDI settings
            </Button>
          </PanelSection>
        </Panel>
      </div>

      {fullscreenId ? (
        <FullscreenPreview
          sourceId={fullscreenId}
          stats={ndi.stats.find((stat) => stat.sourceId === fullscreenId) ?? null}
          previewFps={settings.ndi.previewFps}
          colorFormat={settings.ndi.colorFormat}
          onClose={() => setFullscreenId(null)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview tile
// ---------------------------------------------------------------------------

function NdiPreviewTile({
  stats,
  previewFps,
  colorFormat,
  onPause,
  onDisconnect,
  onFullscreen
}: {
  stats: NdiSourceStats
  previewFps: number
  colorFormat: 'rgba' | 'bgra' | 'uyvy'
  onPause(): void
  onDisconnect(): void
  onFullscreen(): void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null)
  const measure = usePreviewPipeline(canvasRef, stats, previewFps, colorFormat)

  const stale = lastFrameAt !== null && Date.now() - lastFrameAt > 2000

  return (
    <div className="ndi-tile">
      <div className="ndi-tile__header">
        <StatusDot
          tone={stats.paused ? 'warn' : stale ? 'error' : 'live'}
          label={stats.paused ? 'Preview paused' : stale ? 'No frames received recently' : 'Receiving'}
        />
        <span className="ndi-tile__name" title={stats.name}>
          {stats.name}
        </span>
        <div className="spacer" />
        <Badge tooltip="Frame format reported by the sender">{fourCCLabel(stats.fourCC)}</Badge>
        {stats.paused ? <Badge tone="warning">paused</Badge> : null}
        {stale && !stats.paused ? (
          <Badge tone="danger" tooltip="No new frame has arrived for more than two seconds">
            no signal
          </Badge>
        ) : null}
      </div>
      <div className="ndi-tile__surface">
        <canvas ref={canvasRef} width={640} height={360} aria-label={`Live preview of ${stats.name}`} />
        {measure.hasFrame ? null : (
          <div className="ndi-tile__placeholder">
            {stats.paused
              ? 'Preview paused. Reception continues in the background.'
              : 'Waiting for the first frame…'}
          </div>
        )}
      </div>
      <div className="ndi-tile__stats">
        <Metric label="Resolution" value={`${stats.width}×${stats.height}`} />
        <Metric label="Received" value={`${stats.receivedFps.toFixed(1)} fps`} />
        <Metric label="Rendered" value={`${measure.renderedFps.toFixed(1)} fps`} />
        <Metric
          label="Frame age"
          value={`${measure.frameAgeMs.toFixed(0)} ms`}
          hint="Time between the helper receiving the frame and this preview drawing it"
        />
        <Metric label="Dropped" value={stats.droppedFrames} hint="Frames lost in the helper queue" />
        <Metric label="Skipped" value={stats.skippedFrames} hint="Frames produced but not forwarded (preview throttling)" />
      </div>
      <div className="ndi-tile__actions">
        <Button
          size="sm"
          icon={stats.paused ? 'play' : 'pause'}
          tooltip={stats.paused ? 'Resume drawing frames in this preview' : 'Pause drawing only — reception continues'}
          onClick={onPause}
        >
          {stats.paused ? 'Resume' : 'Pause'}
        </Button>
        <Button size="sm" variant="ghost" icon="maximize" tooltip="Show this source fullscreen" onClick={onFullscreen}>
          Fullscreen
        </Button>
        <Button size="sm" variant="danger" icon="unlink" tooltip="Disconnect this source only" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
      <span className="sr-only">
        Last frame received {lastFrameAt ? new Date(lastFrameAt).toLocaleTimeString() : 'never'}
      </span>
      <FrameTimestampReporter onFrame={setLastFrameAt} sourceId={stats.sourceId} />
    </div>
  )
}

function FrameTimestampReporter({
  sourceId,
  onFrame
}: {
  sourceId: string
  onFrame(at: number): void
}): null {
  useEffect(() => frameHub.subscribe(sourceId, () => onFrame(Date.now())), [onFrame, sourceId])
  return null
}

/**
 * Draws the newest frame for a source onto a canvas at the requested preview rate and
 * measures the rendered rate and frame age. Reception itself is never throttled.
 */
function usePreviewPipeline(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stats: NdiSourceStats,
  previewFps: number,
  colorFormat: 'rgba' | 'bgra' | 'uyvy'
): { renderedFps: number; frameAgeMs: number; hasFrame: boolean } {
  const [measure, setMeasure] = useState({ renderedFps: 0, frameAgeMs: 0, hasFrame: false })
  const pending = useRef<FramePacket | null>(null)
  const drawn = useRef(0)
  const lastReport = useRef(performance.now())
  const lastFrame = useRef<FramePacket | null>(null)

  useEffect(() => {
    const unsubscribe = frameHub.subscribe(stats.sourceId, (packet) => {
      pending.current = packet
    })
    return unsubscribe
  }, [stats.sourceId])

  useEffect(() => {
    if (stats.paused) return
    let raf = 0
    let lastDraw = 0
    const interval = 1000 / Math.max(1, previewFps)

    const loop = (): void => {
      raf = window.requestAnimationFrame(loop)
      const now = performance.now()
      if (now - lastDraw < interval) return
      const packet = pending.current
      if (!packet) return
      pending.current = null
      const canvas = canvasRef.current
      if (!canvas) return
      const result = blitFrame(canvas, packet, colorFormat)
      if (!result) return
      lastDraw = now
      drawn.current += 1
      lastFrame.current = packet
      if (now - lastReport.current >= STATUS_REFRESH_MS) {
        const renderedFps = (drawn.current * 1000) / (now - lastReport.current)
        const frameAgeMs = now - (packet.receivedAt - packet.meta.frameAgeMs) - packet.meta.frameAgeMs
        setMeasure({
          renderedFps,
          frameAgeMs: Math.max(0, performance.now() - lastFrame.current.receivedAt),
          hasFrame: true
        })
        window.cuepoint?.ndi.reportRenderStats(stats.sourceId, renderedFps, Math.max(0, frameAgeMs))
        drawn.current = 0
        lastReport.current = now
      }
    }
    raf = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(raf)
  }, [canvasRef, colorFormat, previewFps, stats.paused, stats.sourceId])

  useEffect(() => {
    setMeasure((current) => ({ ...current, hasFrame: Boolean(frameHub.latest(stats.sourceId)) }))
  }, [stats.sourceId])

  return measure
}

function FullscreenPreview({
  sourceId,
  stats,
  previewFps,
  colorFormat,
  onClose
}: {
  sourceId: string
  stats: NdiSourceStats | null
  previewFps: number
  colorFormat: 'rgba' | 'bgra' | 'uyvy'
  onClose(): void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const measure = usePreviewPipeline(
    canvasRef,
    stats ?? {
      sourceId,
      name: sourceId,
      connected: true,
      paused: false,
      width: 0,
      height: 0,
      frameRateNumerator: 0,
      frameRateDenominator: 0,
      fourCC: 0,
      receivedFps: 0,
      renderedFps: 0,
      frameAgeMs: 0,
      averageFrameAgeMs: 0,
      receivedFrames: 0,
      droppedFrames: 0,
      skippedFrames: 0,
      reconnects: 0,
      lastFrameAt: null,
      error: null
    },
    previewFps,
    colorFormat
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="preview-fullscreen" role="dialog" aria-modal="true" aria-label="Fullscreen NDI preview">
      <div className="preview-fullscreen__bar">
        <span className="toolbar__title">{stats?.name ?? sourceId}</span>
        <Badge>
          {stats?.width ?? 0}×{stats?.height ?? 0}
        </Badge>
        <Badge>{measure.renderedFps.toFixed(1)} fps rendered</Badge>
        <Badge>{measure.frameAgeMs.toFixed(0)} ms frame age</Badge>
        <div className="spacer" />
        <span className="muted">Press Escape to close</span>
        <Button size="sm" icon="close" tooltip="Close the fullscreen preview" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="preview-fullscreen__stage">
        <canvas ref={canvasRef} width={1920} height={1080} aria-label="Fullscreen NDI preview" />
      </div>
    </div>
  )
}

/** NDI FourCC byte codes rendered as their channel letters. */
function fourCCLabel(fourCC: number): string {
  if (!fourCC) return '—'
  const bytes = [fourCC & 0xff, (fourCC >> 8) & 0xff, (fourCC >> 16) & 0xff, (fourCC >> 24) & 0xff]
  return bytes.map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '?')).join('')
}
