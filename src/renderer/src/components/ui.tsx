import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'

/**
 * CuePoint component primitives.
 *
 * Class names come from `styles/app.css` (the shared design system). Every control
 * renders an accessible name and, when it is icon-only or ambiguous, a tooltip that
 * explains what it does. Nothing here is decorative: if a control is visible it has a
 * real handler behind it.
 */

// ---------------------------------------------------------------------------
// Icons — 24x24 stroke geometry, currentColor, consistent stroke weight
// ---------------------------------------------------------------------------

export type IconName =
  | 'home'
  | 'stage'
  | 'mapping'
  | 'ndi'
  | 'record'
  | 'settings'
  | 'diagnostics'
  | 'help'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'copy'
  | 'duplicate'
  | 'lock'
  | 'unlock'
  | 'eye'
  | 'eyeOff'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'grid'
  | 'magnet'
  | 'guides'
  | 'chevronDown'
  | 'chevronUp'
  | 'chevronRight'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'play'
  | 'pause'
  | 'stop'
  | 'refresh'
  | 'folder'
  | 'save'
  | 'import'
  | 'export'
  | 'alert'
  | 'check'
  | 'info'
  | 'search'
  | 'link'
  | 'unlink'
  | 'image'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignTop'
  | 'alignMiddle'
  | 'alignBottom'
  | 'distribute'
  | 'rotate'
  | 'external'
  | 'activity'
  | 'cpu'
  | 'disk'
  | 'database'
  | 'screen'
  | 'layers'
  | 'text'
  | 'pencil'
  | 'power'
  | 'clock'
  | 'download'

const ICON_PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M10 20v-6h4v6" />,
  stage: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="M7 9h6v6H7z" />
    </>
  ),
  mapping: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  ndi: (
    <>
      <circle cx="12" cy="10" r="2" />
      <path d="M7.8 5.8a6 6 0 0 0 0 8.4M16.2 5.8a6 6 0 0 1 0 8.4" />
      <path d="M4.9 2.9a10 10 0 0 0 0 14.2M19.1 2.9a10 10 0 0 1 0 14.2" />
      <path d="M12 12v9" />
    </>
  ),
  record: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </>
  ),
  diagnostics: <path d="M3 12h3.5l2-6 3 12 2.5-7 1.7 3H21" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4M12 17h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  copy: (
    <>
      <path d="M9 9h11v11H9z" />
      <path d="M15 5H4v11h2" />
    </>
  ),
  duplicate: (
    <>
      <path d="M8 8h12v12H8z" />
      <path d="M16 5H4v12h2" />
      <path d="M14 12v4M12 14h4" />
    </>
  ),
  lock: (
    <>
      <path d="M6 11h12v9H6z" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  unlock: (
    <>
      <path d="M6 11h12v9H6z" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.9 3.6" />
      <path d="M6.3 7.9A17 17 0 0 0 2.5 12S6 18 12 18a9.3 9.3 0 0 0 3.4-.6" />
      <path d="M9.8 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  undo: <path d="M9 7H5V3M5 7a9 9 0 1 1-1.6 8" />,
  redo: <path d="M15 7h4V3M19 7a9 9 0 1 0 1.6 8" />,
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4 21 21M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4 21 21M7.5 10.5h6" />
    </>
  ),
  fit: (
    <>
      <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />
      <path d="M7 12h10" />
    </>
  ),
  grid: <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" />,
  magnet: <path d="M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4z" />,
  guides: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  minimize: <path d="M5 12h14" />,
  maximize: <path d="M6 6h12v12H6z" />,
  restore: (
    <>
      <path d="M9 9h10v10H9z" />
      <path d="M6 15V5h10" />
    </>
  ),
  play: <path d="M7 4.5 19 12 7 19.5z" />,
  pause: <path d="M8.5 5h3v14h-3zM12.5 5h3v14h-3z" />,
  stop: <path d="M6 6h12v12H6z" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.4 5.7M20 5v6h-6" />,
  folder: <path d="M3 6.5h6l2 2.5h10V19H3z" />,
  save: (
    <>
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M8 4v6h7V4M8 20v-6h8v6" />
    </>
  ),
  import: <path d="M12 3v11M8 10.5l4 4 4-4M4 19h16" />,
  export: <path d="M12 15V4M8 7.5l4-4 4 4M4 19h16" />,
  alert: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9.5v5M12 17.4h.01" />
    </>
  ),
  check: <path d="M4.5 12.5 10 18 20 6.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.6h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l6 6" />
    </>
  ),
  link: <path d="M9.5 14.5 14.5 9.5M8 12l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 12l2-2a3.5 3.5 0 0 0-5-5l-2 2" />,
  unlink: <path d="M8 12H3M21 12h-5M9.5 14.5 6.5 17.5M14.5 9.5l3-3M6.5 6.5l3 3M17.5 17.5l-3-3" />,
  image: (
    <>
      <path d="M3 5h18v14H3z" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M3 17l5-5 4 4 3-3 6 6" />
    </>
  ),
  alignLeft: <path d="M4 4v16M8 8h9M8 14h6" />,
  alignCenter: <path d="M12 4v16M6.5 8h11M8.5 14h7" />,
  alignRight: <path d="M20 4v16M7 8h9M10 14h6" />,
  alignTop: <path d="M4 4h16M8 8v9M14 8v6" />,
  alignMiddle: <path d="M4 12h16M8 6.5v11M14 8.5v7" />,
  alignBottom: <path d="M4 20h16M8 7v9M14 10v6" />,
  distribute: <path d="M3 4v16M21 4v16M10 8h4v8h-4z" />,
  rotate: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />,
  external: <path d="M14 4h6v6M20 4l-8 8M18 14v6H4V6h6" />,
  activity: <path d="M3 12h3l2.5-7 3.5 14 3-9 1.5 2H21" />,
  cpu: (
    <>
      <path d="M7 7h10v10H7z" />
      <path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" />
    </>
  ),
  disk: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  screen: (
    <>
      <path d="M3 4.5h18v11H3z" />
      <path d="M8.5 20.5h7M12 15.5v5" />
    </>
  ),
  layers: <path d="M12 3 2.5 8 12 13l9.5-5zM2.5 13 12 18l9.5-5M2.5 17.5 12 22.5l9.5-5" />,
  text: <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />,
  pencil: <path d="M4 20l4-1 10-10-3-3L5 16zM14 6l3 3" />,
  power: <path d="M12 4v8M7.5 6.8a7 7 0 1 0 9 0" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3.5 2" />
    </>
  ),
  download: <path d="M12 4v11M7.5 11l4.5 4.5L16.5 11M4 20h16" />
}

export interface IconProps {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({ name, size = 16, className, strokeWidth = 1.6 }: IconProps): JSX.Element {
  return (
    <svg
      className={className ? `nav-icon ${className}` : 'nav-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  /** Explanation shown as a tooltip; also used as the accessible name. */
  tooltip?: string
  active?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, tooltip, active, children, className, ...rest },
  ref
) {
  const label = tooltip ?? (typeof children === 'string' ? children : undefined)
  const classes = [
    'btn',
    variant === 'primary' ? 'btn--primary' : '',
    variant === 'ghost' ? 'btn--ghost' : '',
    variant === 'danger' ? 'btn--danger' : '',
    size === 'sm' ? 'btn--small' : '',
    active ? 'btn--active' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      data-tooltip={label}
      title={label}
      aria-label={!children && label ? label : undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 14} className="btn__icon" /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Required: icon-only buttons must explain themselves. */
  label: string
  size?: 'sm' | 'md'
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active, className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={['btn', 'btn--icon', size === 'sm' ? 'btn--small' : '', active ? 'btn--active' : '', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 12 : 14} className="btn__icon" />
    </button>
  )
})

// ---------------------------------------------------------------------------
// Panels and layout
// ---------------------------------------------------------------------------

export function Panel({
  title,
  actions,
  children,
  className,
  icon,
  bodyClassName
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  icon?: IconName
  bodyClassName?: string
}): JSX.Element {
  return (
    <section className={['panel', className].filter(Boolean).join(' ')}>
      {title ? (
        <header className="panel__header">
          <h2 className="panel__title">
            {icon ? <Icon name={icon} size={13} /> : null}
            {title}
          </h2>
          <div className="spacer" />
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      ) : null}
      <div className={['panel__body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
    </section>
  )
}

export function PanelSection({
  title,
  children,
  hint
}: {
  title: string
  children: ReactNode
  hint?: string
}): JSX.Element {
  return (
    <div className="panel__section">
      <h3 className="panel__section-title" title={hint} data-tooltip={hint}>
        {title}
      </h3>
      {children}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  tooltip
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'
  tooltip?: string
}): JSX.Element {
  return (
    <span
      className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}
      data-tooltip={tooltip}
      title={tooltip}
    >
      {children}
    </span>
  )
}

export function StatusDot({
  tone = 'idle',
  label
}: {
  tone?: 'idle' | 'ok' | 'warn' | 'error' | 'live'
  label: string
}): JSX.Element {
  const cls = tone === 'idle' ? 'status-dot' : `status-dot status-dot--${tone}`
  return <span className={cls} role="img" aria-label={label} title={label} />
}

export function EmptyState({
  icon = 'info',
  title,
  message,
  actions
}: {
  icon?: IconName
  title: string
  message: string
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className="empty-state">
      <Icon name={icon} size={26} />
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__body">{message}</p>
      {actions ? <div className="row row--wrap">{actions}</div> : null}
    </div>
  )
}

export function ProgressBar({
  value,
  max = 1,
  label
}: {
  value: number
  max?: number
  label: string
}): JSX.Element {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Metric({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent'
}): JSX.Element {
  return (
    <div className="metric" data-tooltip={hint} title={hint}>
      <span className={tone && tone !== 'default' ? `metric__value text-${tone}` : 'metric__value'}>{value}</span>
      <span className="metric__label">{label}</span>
    </div>
  )
}

export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }): JSX.Element {
  return (
    <dl className="kv">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </dl>
  )
}

export function Callout({
  tone = 'info',
  title,
  children,
  actions
}: {
  tone?: 'info' | 'warning' | 'error' | 'success'
  title?: string
  children: ReactNode
  actions?: ReactNode
}): JSX.Element {
  const icon: IconName = tone === 'error' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info'
  return (
    <div className={`callout callout--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} size={15} />
      <div className="callout__body">
        {title ? <p className="callout__title">{title}</p> : null}
        <div className="callout__content">{children}</div>
      </div>
      {actions ? <div className="callout__actions">{actions}</div> : null}
    </div>
  )
}

export function IssueList({
  issues
}: {
  issues: { level: 'error' | 'warning' | 'info'; message: string }[]
}): JSX.Element {
  if (issues.length === 0) return <p className="muted">No issues found.</p>
  return (
    <ul className="issue-list">
      {issues.map((issue, index) => (
        <li key={`${issue.level}-${index}`} className={`issue issue--${issue.level}`}>
          <span className="issue__level">{issue.level}</span>
          <span className="issue__message">{issue.message}</span>
        </li>
      ))}
    </ul>
  )
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose(): void
  wide?: boolean
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const headingId = useId()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !ref.current) return
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={wide ? 'modal modal--wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={ref}
      >
        <header className="modal__header">
          <h2 id={headingId} className="modal__title">
            {title}
          </h2>
          <IconButton icon="close" label="Close dialog" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

function FieldShell({
  label,
  hint,
  error,
  children,
  htmlFor,
  unit
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
  htmlFor: string
  unit?: string
}): JSX.Element {
  return (
    <div className={error ? 'field field--invalid' : 'field'}>
      {/* The unit sits outside the <label> element on purpose: a label that also carries the
          unit would give the input an accessible name of "Width m" instead of "Width",
          which breaks screen readers and assists automation. */}
      <div className="field__label">
        <label htmlFor={htmlFor} title={hint}>
          {label}
        </label>
        {unit ? <span className="muted mono">{unit}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  disabled,
  commitOnBlur = false,
  maxLength,
  autoFocus
}: {
  label: string
  value: string
  onChange(value: string): void
  hint?: string
  error?: string | null
  placeholder?: string
  disabled?: boolean
  /** Commit on blur/Enter rather than on every keystroke. */
  commitOnBlur?: boolean
  maxLength?: number
  autoFocus?: boolean
}): JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const lastExternal = useRef(value)
  const focused = useRef(false)

  useEffect(() => {
    if (lastExternal.current !== value) {
      lastExternal.current = value
      if (!focused.current) setDraft(value)
    }
  }, [value])

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        className={`input${error ? ' input--invalid' : ''}`}
        type="text"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        spellCheck={false}
        autoFocus={autoFocus}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          if (!commitOnBlur) onChange(event.target.value)
        }}
        onBlur={() => {
          focused.current = false
          if (commitOnBlur) {
            onChange(draft)
            setDraft(value)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && commitOnBlur) event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            event.currentTarget.blur()
          }
        }}
      />
    </FieldShell>
  )
}

export function TextArea({
  label,
  value,
  onChange,
  hint,
  rows = 3,
  placeholder
}: {
  label: string
  value: string
  onChange(value: string): void
  hint?: string
  rows?: number
  placeholder?: string
}): JSX.Element {
  const id = useId()
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <textarea
        id={id}
        className="input"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldShell>
  )
}

export interface NumberFieldProps {
  label: string
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  step?: number
  unit?: string
  hint?: string
  disabled?: boolean
  precision?: number
  /** Returns an error message when the committed value must be rejected. */
  validate?(value: number): string | null
}

/**
 * Numeric field.
 *
 * The typed string is local state so a partially entered value such as "-" or "1." does
 * not immediately overwrite the model. Valid values commit live so the canvas follows the
 * typing; invalid values keep the last good number and report the limit beside the field.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
  disabled,
  precision = 2,
  validate
}: NumberFieldProps): JSX.Element {
  const id = useId()
  const [text, setText] = useState(() => formatNumber(value, precision))
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  const externalValue = useRef(value)

  useEffect(() => {
    if (externalValue.current !== value) {
      externalValue.current = value
      if (!focused.current) {
        setText(formatNumber(value, precision))
        setError(null)
      }
    }
  }, [value, precision])

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
        setError('Enter a number.')
        setText(formatNumber(value, precision))
        return
      }
      const parsed = Number(trimmed.replace(',', '.'))
      if (!Number.isFinite(parsed)) {
        setError('Enter a valid number.')
        setText(formatNumber(value, precision))
        return
      }
      if (min !== undefined && parsed < min) {
        setError(`Minimum is ${formatNumber(min, precision)}${unit ? ` ${unit}` : ''}.`)
        setText(formatNumber(value, precision))
        return
      }
      if (max !== undefined && parsed > max) {
        setError(`Maximum is ${formatNumber(max, precision)}${unit ? ` ${unit}` : ''}.`)
        setText(formatNumber(value, precision))
        return
      }
      const custom = validate?.(parsed)
      if (custom) {
        setError(custom)
        setText(formatNumber(value, precision))
        return
      }
      setError(null)
      setText(formatNumber(parsed, precision))
      if (parsed !== value) onChange(parsed)
    },
    [max, min, onChange, precision, unit, validate, value]
  )

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={id} unit={unit}>
      <div className="input-group">
        <input
          id={id}
          className={`input input--number${error ? ' input--invalid' : ''}`}
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          spellCheck={false}
          onFocus={() => {
            focused.current = true
          }}
          onChange={(event) => {
            const raw = event.target.value
            setText(raw)
            const parsed = Number(raw.replace(',', '.'))
            const inRange =
              Number.isFinite(parsed) &&
              raw.trim() !== '' &&
              (min === undefined || parsed >= min) &&
              (max === undefined || parsed <= max) &&
              !validate?.(parsed)
            if (inRange) {
              setError(null)
              onChange(parsed)
            }
          }}
          onBlur={() => {
            focused.current = false
            commit(text)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit(text)
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setText(formatNumber(value, precision))
              setError(null)
              event.currentTarget.blur()
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)
              commit(String(clampNumber((Number(text.replace(',', '.')) || 0) + delta, min, max)))
            }
          }}
        />
        {unit ? <span className="input-group__suffix">{unit}</span> : null}
      </div>
      <div className="row row--wrap">
        <Button
          size="sm"
          variant="ghost"
          icon="minus"
          tooltip={`Decrease ${label} by ${formatNumber(step, 3)}${unit ? ` ${unit}` : ''}`}
          disabled={disabled || (min !== undefined && value <= min)}
          onClick={() => commit(String(clampNumber(value - step, min, max)))}
        />
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          tooltip={`Increase ${label} by ${formatNumber(step, 3)}${unit ? ` ${unit}` : ''}`}
          disabled={disabled || (max !== undefined && value >= max)}
          onClick={() => commit(String(clampNumber(value + step, min, max)))}
        />
      </div>
    </FieldShell>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
  disabled
}: {
  label: string
  value: string
  options: { value: string; label: string; disabled?: boolean }[]
  onChange(value: string): void
  hint?: string
  disabled?: boolean
}): JSX.Element {
  const id = useId()
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        className="select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
  hint,
  disabled
}: {
  label: string
  checked: boolean
  onChange(value: boolean): void
  hint?: string
  disabled?: boolean
}): JSX.Element {
  const id = useId()
  return (
    <div className="field">
      <label className={disabled ? 'checkbox checkbox--disabled' : 'checkbox'} htmlFor={id} title={hint}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string; tooltip?: string }[]
  onChange(value: T): void
}): JSX.Element {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            title={option.tooltip ?? option.label}
            data-tooltip={option.tooltip ?? option.label}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  hint,
  unit
}: {
  label: string
  value: number
  onChange(value: number): void
  min: number
  max: number
  step?: number
  format?(value: number): string
  hint?: string
  unit?: string
}): JSX.Element {
  const id = useId()
  return (
    <FieldShell label={label} hint={hint} htmlFor={id} unit={unit}>
      <div className="slider">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="slider__value mono">{format ? format(value) : String(value)}</span>
      </div>
    </FieldShell>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label
}: {
  value: string
  onChange(value: string): void
  placeholder?: string
  label: string
}): JSX.Element {
  return (
    <div className="search">
      <Icon name="search" size={13} />
      <input
        type="search"
        className="search__input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? <IconButton icon="close" label="Clear search" size="sm" onClick={() => onChange('')} /> : null}
    </div>
  )
}

export function formatNumber(value: number, precision = 2): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Number(value.toFixed(precision))
  return String(rounded)
}

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value
  if (min !== undefined) next = Math.max(min, next)
  if (max !== undefined) next = Math.min(max, next)
  return next
}
