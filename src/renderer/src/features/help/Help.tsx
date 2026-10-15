import { useEffect, useMemo, useState } from 'react'
import type { DocEntry } from '@shared/ipc'
import { CANVAS_KEYS, SHORTCUT_ACTIONS, SHORTCUT_CATEGORIES, formatAccelerator } from '@shared/shortcuts'
import { Badge, Button, Callout, IconButton, Panel, PanelSection, SearchInput, Segmented } from '../../components/ui'
import { useApp } from '../../state/AppState'

/**
 * Help workspace.
 *
 * Reads the shipped documentation from disk (so the manual always matches the installed
 * build), and renders the shortcut reference from the same catalogue the application uses
 * to register accelerators — the documentation cannot drift from the implementation.
 */

type Tab = 'docs' | 'shortcuts' | 'about'

export function Help(): JSX.Element {
  const { info, notify, openModal } = useApp()
  const [tab, setTab] = useState<Tab>('docs')
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [activeDoc, setActiveDoc] = useState<string>('user-manual')
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      const api = window.cuepoint
      if (!api) return
      const result = await api.docs.list()
      if (result.ok) {
        setDocs(result.data)
        const preferred = result.data.find((entry) => entry.exists) ?? result.data[0]
        if (preferred) setActiveDoc(preferred.id)
      }
    })()
  }, [])

  const loadDoc = async (id: string): Promise<void> => {
    const api = window.cuepoint
    if (!api) return
    setLoading(true)
    const result = await api.docs.read(id)
    setLoading(false)
    if (!result.ok) {
      setContent(`# ${id}\n\nThis document could not be read.\n\n${result.error.message}`)
      return
    }
    setContent(result.data)
  }

  useEffect(() => {
    // Re-reads only when the selected document changes; `loadDoc` reads the live search text.
    void loadDoc(activeDoc)
  }, [activeDoc])

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail
      const match = docs.find((entry) => entry.id === detail)
      if (match) {
        setTab('docs')
        setActiveDoc(match.id)
      }
    }
    window.addEventListener('cuepoint:help-doc', handler)
    return () => window.removeEventListener('cuepoint:help-doc', handler)
  }, [docs])

  const activeEntry = docs.find((entry) => entry.id === activeDoc)

  return (
    <div className="workspace">
      <div className="toolbar toolbar--wrap">
        <span className="toolbar__title">Help</span>
        <Segmented
          label=""
          value={tab}
          options={[
            { value: 'docs', label: 'Documentation', tooltip: 'User manual, architecture, testing and troubleshooting' },
            { value: 'shortcuts', label: 'Keyboard shortcuts', tooltip: 'Every action and its accelerator (Shift+F1)' },
            { value: 'about', label: 'About', tooltip: 'Version, licence and support information (Shift+F3)' }
          ]}
          onChange={(value) => setTab(value)}
        />
        <div className="toolbar__spacer" />
        <Button size="sm" variant="ghost" icon="external" tooltip="Open this document in your default editor" disabled={!activeEntry?.exists} onClick={() => void window.cuepoint?.docs.open(activeDoc)}>
          Open in editor
        </Button>
        <Button size="sm" variant="ghost" icon="folder" tooltip="Open the documentation folder" onClick={() => void window.cuepoint?.app.openPath(info?.docsPath ?? '')}>
          Docs folder
        </Button>
        <IconButton icon="info" label="About CuePoint" onClick={() => openModal({ kind: 'about' })} />
      </div>

      {tab === 'docs' ? (
        <div className="workspace-split">
          <div className="scroll-area">
            <Panel
              title={activeEntry?.title ?? 'Documentation'}
              icon="text"
              actions={
                <>
                  <Badge tooltip={activeEntry?.description ?? ''}>{activeEntry?.exists ? 'installed' : 'not found'}</Badge>
                  <Badge tone="neutral" tooltip="Documents are read from the installed application, so the manual always matches the shipped build">
                    from disk
                  </Badge>
                </>
              }
            >
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <MarkdownView source={content} />
              )}
              <div className="row row--wrap">
                <Button
                  size="sm"
                  variant="ghost"
                  icon="copy"
                  tooltip="Copy this document’s text to the clipboard"
                  onClick={() => {
                    void (async () => {
                      const api = window.cuepoint
                      if (!api) return
                      await api.app.writeClipboard(content)
                      notify('success', 'Document copied to the clipboard')
                    })()
                  }}
                >
                  Copy text
                </Button>
              </div>
            </Panel>
          </div>
          <Panel title="Documents" icon="text">
            {docs.length === 0 ? (
              <p className="muted">No documentation files were found next to the application.</p>
            ) : (
              <ul className="list">
                {docs.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={entry.id === activeDoc ? 'list__item is-selected' : 'list__item'}
                      onClick={() => setActiveDoc(entry.id)}
                    >
                      <span className="list__label">{entry.title}</span>
                      {!entry.exists ? <Badge tone="warning">missing</Badge> : null}
                    </button>
                    <p className="muted" style={{ fontSize: 'var(--text-2xs)', padding: '0 var(--space-5) var(--space-2)' }}>
                      {entry.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <PanelSection title="Where to find things">
              <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                The installed build stores its documentation in the application folder. CuePoint never links to online
                documentation, so help is always available offline.
              </p>
            </PanelSection>
          </Panel>
        </div>
      ) : null}

      {tab === 'shortcuts' ? <ShortcutReference /> : null}

      {tab === 'about' ? (
        <div className="scroll-area">
          <Panel title="About CuePoint" icon="info">
            <div className="row">
              <img src="./logo-64.png" alt="CuePoint" width={64} height={64} />
              <div className="column">
                <h2 className="section-title">CuePoint {info?.version ?? ''}</h2>
                <p className="section-subtitle">{info?.license ?? 'Proprietary'}</p>
              </div>
            </div>
            <dl className="kv">
              <dt>Version</dt>
              <dd>
                {info?.version ?? '—'} {info?.packaged ? '(installed)' : '(development)'}
              </dd>
              <dt>Author</dt>
              <dd>{info?.author ?? 'Sandila Fernando'}</dd>
              <dt>Copyright</dt>
              <dd>{info?.copyright ?? '© 2026 Sandila Fernando'}</dd>
              <dt>Electron</dt>
              <dd className="mono">{info?.electron ?? '—'}</dd>
              <dt>Chromium</dt>
              <dd className="mono">{info?.chrome ?? '—'}</dd>
              <dt>Node.js</dt>
              <dd className="mono">{info?.node ?? '—'}</dd>
              <dt>Platform</dt>
              <dd className="mono">
                {info?.platform ?? '—'} {info?.arch ?? ''}
              </dd>
              <dt>User data</dt>
              <dd className="mono truncate">{info?.userDataPath ?? '—'}</dd>
              <dt>Logs</dt>
              <dd className="mono truncate">{info?.logsPath ?? '—'}</dd>
            </dl>
            <Callout tone="info" title="Third-party notices">
              NDI® is a registered trademark of Vizrt Group. CuePoint loads the NDI runtime that you install and does not
              redistribute it. Optional MP4 transcoding uses FFmpeg, which you install yourself. Screens are rendered with
              CuePoint’s own canvas engine; no third-party graphics service is contacted.
            </Callout>
            <div className="row row--wrap">
              <Button size="sm" icon="copy" tooltip="Copy a diagnostic report to the clipboard" onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:copy-diagnostics'))}>
                Copy diagnostic report
              </Button>
              <Button size="sm" variant="ghost" icon="folder" tooltip="Open the logs folder" onClick={() => void window.cuepoint?.app.openPath(info?.logsPath ?? '')}>
                Open logs folder
              </Button>
              <Button size="sm" variant="ghost" icon="external" tooltip="Open the NDI runtime download page" onClick={() => void window.cuepoint?.app.openExternal('https://ndi.video/tools/ndi-runtime/')}>
                NDI runtime
              </Button>
            </div>
            <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              CuePoint sends no telemetry, requires no account and makes no network requests other than optional local
              NDI discovery.
            </p>
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

function ShortcutReference(): JSX.Element {
  const [query, setQuery] = useState('')
  const actions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return SHORTCUT_ACTIONS
    return SHORTCUT_ACTIONS.filter(
      (action) =>
        action.label.toLowerCase().includes(needle) ||
        action.description.toLowerCase().includes(needle) ||
        action.category.toLowerCase().includes(needle) ||
        action.default.toLowerCase().includes(needle)
    )
  }, [query])

  return (
    <div className="scroll-area">
      <div className="row">
        <h2 className="section-title">Keyboard shortcuts</h2>
        <div style={{ width: 320 }}>
          <SearchInput label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={setQuery} />
        </div>
      </div>
      <div className="grid-2">
        {SHORTCUT_CATEGORIES.map((category) => {
          const items = actions.filter((action) => action.category === category)
          if (items.length === 0) return null
          return (
            <Panel key={category} title={category} icon="text">
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Shortcut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((action) => (
                      <tr key={action.id}>
                        <td>
                          <div className="column" style={{ gap: 2 }}>
                            <span>{action.label}</span>
                            <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
                              {action.description}
                            </span>
                          </div>
                        </td>
                        <td className="mono nowrap">{formatAccelerator(action.default)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )
        })}
      </div>
      <Panel title="Canvas and mouse" icon="stage">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Input</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
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
        <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          Shortcuts can be changed in Settings → Keyboard shortcuts. Keys handled by the workspace are ignored while a
          text field has focus, so typing never triggers an action.
        </p>
      </Panel>
    </div>
  )
}

/**
 * Minimal Markdown renderer.
 *
 * The shipped documentation is Markdown; this renders the subset it uses (headings,
 * paragraphs, lists, tables, fenced code and inline code) without adding a dependency or
 * executing any HTML from disk.
 */
export function MarkdownView({ source }: { source: string }): JSX.Element {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return <div className="markdown">{blocks}</div>
}

function parseMarkdown(source: string): JSX.Element[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: JSX.Element[] = []
  let index = 0
  let key = 0

  const flushList = (items: string[], ordered: boolean): void => {
    if (items.length === 0) return
    const children = items.map((item, itemIndex) => (
      <li key={itemIndex}>{renderInline(item)}</li>
    ))
    out.push(
      ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>
    )
    items.length = 0
  }

  while (index < lines.length) {
    const line = lines[index]

    if (line.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      out.push(
        <pre className="code-block" key={key++}>
          {code.join('\n')}
        </pre>
      )
      continue
    }

    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? '')) {
      const header = splitRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        rows.push(splitRow(lines[index]))
        index += 1
      }
      out.push(
        <div className="table-scroll" key={key++}>
          <table className="table">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th scope="col" key={cellIndex}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const text = heading[2]
      if (level === 1) out.push(<h1 key={key++} className="section-title">{renderInline(text)}</h1>)
      else if (level === 2) out.push(<h2 key={key++} className="section-title">{renderInline(text)}</h2>)
      else if (level === 3) out.push(<h3 key={key++} className="panel__section-title">{renderInline(text)}</h3>)
      else out.push(<h4 key={key++} className="card__title">{renderInline(text)}</h4>)
      index += 1
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      flushList(items, false)
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''))
        index += 1
      }
      flushList(items, true)
      continue
    }

    if (line.trim() === '') {
      index += 1
      continue
    }

    out.push(
      <p key={key++} className="markdown__paragraph">
        {renderInline(line)}
      </p>
    )
    index += 1
  }

  return out
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Inline formatting for `code`, **bold** and *italic*. */
function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const token = match[0]
    if (token.startsWith('`')) {
      parts.push(
        <code className="code-inline" key={key++}>
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}
