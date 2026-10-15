import { useMemo, useState } from 'react'
import type { BackgroundFit, LengthUnit, Project, Screen, ScreenType } from '@shared/types'
import { LIMITS } from '@shared/validation'
import { LENGTH_UNITS, UNIT_LABEL, formatLength, fromMm, toMm } from '@shared/units'
import { SCREEN_COLORS } from '@shared/project'
import {
  Button,
  Callout,
  CheckboxField,
  Icon,
  IconButton,
  NumberField,
  Panel,
  PanelSection,
  Segmented,
  SelectField,
  SliderField,
  TextArea,
  TextField
} from '../../components/ui'
import { Badge } from '../../components/ui'
import { editorStore, type EditorState } from '../../state/editor'
import { useApp } from '../../state/AppState'
import { aspectRatioLabel, aspectDecimal } from '@shared/geometry'

/**
 * Property inspector.
 *
 * The inspector is driven entirely by the current selection: every field reads the value
 * from the selected screen and writes back through the reducer, so switching selection can
 * never leave stale values behind. Numeric input is validated against the shared limits,
 * and invalid text keeps the last valid number instead of corrupting the model.
 */

const SCREEN_TYPES: { value: ScreenType; label: string }[] = [
  { value: 'led', label: 'LED wall' },
  { value: 'projection', label: 'Projection' },
  { value: 'lcd', label: 'LCD / video wall' },
  { value: 'custom', label: 'Custom' }
]

const FIT_OPTIONS: { value: BackgroundFit; label: string }[] = [
  { value: 'contain', label: 'Contain (fit inside)' },
  { value: 'cover', label: 'Cover (fill and crop)' },
  { value: 'stretch', label: 'Stretch to stage' },
  { value: 'none', label: 'Original size' }
]

export function Inspector({ state }: { state: EditorState }): JSX.Element {
  const { notify, settings, updateSettings } = useApp()
  const project = state.project
  const selected = useMemo(
    () => (project?.screens ?? []).filter((screen) => state.selection.includes(screen.id)),
    [project, state.selection]
  )

  if (!project) {
    return (
      <Panel title="Inspector" icon="pencil">
        <Callout tone="info" title="No project open">
          Create or open a project to edit stage, screen and mapping properties.
        </Callout>
      </Panel>
    )
  }

  const unit = project.stage.defaultUnit

  return (
    <Panel
      title={selected.length === 1 ? 'Screen' : selected.length > 1 ? `${selected.length} screens` : 'Stage'}
      icon="pencil"
      actions={
        selected.length > 0 ? (
          <IconButton
            icon="close"
            label="Clear the selection (Escape)"
            onClick={() => editorStore.dispatch({ type: 'select', ids: [] })}
          />
        ) : null
      }
    >
      {selected.length === 1 ? (
        <ScreenInspector project={project} screen={selected[0]} unit={unit} />
      ) : selected.length > 1 ? (
        <MultiInspector project={project} screens={selected} unit={unit} />
      ) : (
        <StageInspector project={project} onNotify={notify} />
      )}

      <BackgroundInspector project={project} onNotify={notify} />

      <PanelSection title="Working units" hint="Physical geometry is always stored in millimetres; this only changes how values are shown.">
        <SelectField
          label="Default unit"
          value={unit}
          options={LENGTH_UNITS.map((candidate) => ({ value: candidate, label: UNIT_LABEL[candidate] }))}
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateStage', patch: { defaultUnit: value as LengthUnit } })
          }
          hint="Applies to the inspector, exports and the status bar."
        />
        <SelectField
          label="App preference unit"
          value={settings.defaultUnit}
          options={LENGTH_UNITS.map((candidate) => ({ value: candidate, label: UNIT_LABEL[candidate] }))}
          onChange={(value) => void updateSettings({ defaultUnit: value as LengthUnit })}
          hint="Used for new projects and for values shown outside a project."
        />
      </PanelSection>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Single screen
// ---------------------------------------------------------------------------

function ScreenInspector({
  project,
  screen,
  unit
}: {
  project: Project
  screen: Screen
  unit: LengthUnit
}): JSX.Element {
  const { notify } = useApp()
  const patch = (next: Partial<Screen>, label: string, coalesce?: string): void => {
    editorStore.dispatch({ type: 'updateScreen', id: screen.id, patch: next, label, coalesce })
  }

  const pitchMm = screen.pixelPitchMm
  const pixelDensity =
    pitchMm && pitchMm > 0
      ? {
          perMetre: 1000 / pitchMm,
          perSquareMetre: (1000 / pitchMm) ** 2,
          physicalWidthMm: screen.pixelWidth * pitchMm,
          physicalHeightMm: screen.pixelHeight * pitchMm
        }
      : null

  return (
    <>
      <PanelSection title="Identity">
        <TextField
          label="Screen name"
          value={screen.name}
          onChange={(value) => {
            if (value.trim()) patch({ name: value }, 'Rename screen', `name:${screen.id}`)
          }}
          hint="Shown on the stage canvas, in the screen list and in exports."
          maxLength={LIMITS.maxNameLength}
        />
        <div className="field">
          <span className="field__label">Screen colour</span>
          <div className="row row--wrap">
            {SCREEN_COLORS.slice(0, 10).map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use colour ${color}`}
                title={`Use colour ${color}`}
                onClick={() => patch({ color }, 'Change screen colour')}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: color,
                  border: screen.color === color ? '2px solid var(--accent)' : '1px solid var(--border)',
                  cursor: 'pointer'
                }}
              />
            ))}
          </div>
        </div>
        <SelectField
          label="Screen type"
          value={screen.type}
          options={SCREEN_TYPES}
          onChange={(value) => patch({ type: value as ScreenType }, 'Change screen type')}
          hint="Documentation only; it does not change geometry."
        />
        <div className="row row--wrap">
          <CheckboxField
            label="Visible"
            checked={screen.visible}
            onChange={(value) => patch({ visible: value }, value ? 'Show screen' : 'Hide screen')}
            hint="Hidden screens stay in the project but are excluded from the canvas and exports."
          />
          <CheckboxField
            label="Locked"
            checked={screen.locked}
            onChange={(value) => patch({ locked: value }, value ? 'Lock screen' : 'Unlock screen')}
            hint="Locked screens cannot be moved, resized or rotated."
          />
          <CheckboxField
            label="Include in exports"
            checked={screen.mapping.exportVisible}
            onChange={() => editorStore.dispatch({ type: 'toggleExportVisible', ids: [screen.id] })}
            hint="Exclude a screen from mapping output without hiding it on the stage."
          />
        </div>
        <TextField
          label="Stable id"
          value={screen.id}
          onChange={() => undefined}
          hint="Generated once and preserved across save/load, duplication and reordering. Used by exports and NDI mapping."
        />
        <TextArea
          label="Notes"
          value={screen.notes}
          onChange={(value) => patch({ notes: value.slice(0, LIMITS.maxNotesLength) }, 'Edit notes', `notes:${screen.id}`)}
          hint="Maintenance notes, cabinet counts, signal routing — anything the operator needs."
        />
      </PanelSection>

      <PanelSection title="Physical geometry" hint="Real-world size of the screen. Independent of pixel resolution.">
        <div className="row row--wrap">
          <Button
            size="sm"
            variant="ghost"
            icon="fit"
            tooltip={`Fit the whole screen inside the stage (${formatLength(project.stage.widthMm, unit)} × ${formatLength(project.stage.heightMm, unit)})`}
            onClick={() => {
              const scale = Math.min(
                project.stage.widthMm / screen.widthMm,
                project.stage.heightMm / screen.heightMm,
                1
              )
              patch(
                {
                  widthMm: Math.round(screen.widthMm * scale),
                  heightMm: Math.round(screen.heightMm * scale)
                },
                'Fit screen to stage'
              )
            }}
          >
            Fit to stage
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="alignCenter"
            tooltip="Centre this screen on the stage without changing its size"
            onClick={() => editorStore.dispatch({ type: 'centerOnStage', axis: 'both' })}
          >
            Centre on stage
          </Button>
        </div>

        <div className="field__row">
          <NumberField
            label="Width"
            unit={UNIT_LABEL[unit]}
            value={round(fromMm(screen.widthMm, unit), unit)}
            min={fromMm(LIMITS.minDimensionMm, unit)}
            max={fromMm(LIMITS.maxDimensionMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            hint="Physical width, independent of the native pixel resolution."
            onChange={(value) =>
              patch({ widthMm: toMm(value, unit) }, 'Edit screen width', `width:${screen.id}`)
            }
          />
          <NumberField
            label="Height"
            unit={UNIT_LABEL[unit]}
            value={round(fromMm(screen.heightMm, unit), unit)}
            min={fromMm(LIMITS.minDimensionMm, unit)}
            max={fromMm(LIMITS.maxDimensionMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            hint="Physical height. Non-standard aspect ratios are supported."
            onChange={(value) =>
              patch({ heightMm: toMm(value, unit) }, 'Edit screen height', `height:${screen.id}`)
            }
          />
        </div>

        <div className="field__row">
          <NumberField
            label="X position"
            unit={UNIT_LABEL[unit]}
            value={round(fromMm(screen.xMm, unit), unit)}
            min={fromMm(-LIMITS.maxCoordinateMm, unit)}
            max={fromMm(LIMITS.maxCoordinateMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            hint="Distance from the stage's left edge to the screen's left edge."
            onChange={(value) => patch({ xMm: toMm(value, unit) }, 'Move screen', `x:${screen.id}`)}
          />
          <NumberField
            label="Y position"
            unit={UNIT_LABEL[unit]}
            value={round(fromMm(screen.yMm, unit), unit)}
            min={fromMm(-LIMITS.maxCoordinateMm, unit)}
            max={fromMm(LIMITS.maxCoordinateMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            hint="Distance from the stage's top edge to the screen's top edge."
            onChange={(value) => patch({ yMm: toMm(value, unit) }, 'Move screen', `y:${screen.id}`)}
          />
        </div>

        <NumberField
          label="Rotation"
          unit="°"
          value={round(screen.rotationDeg, 'mm')}
          min={LIMITS.minRotationDeg}
          max={LIMITS.maxRotationDeg}
          step={1}
          precision={1}
          hint="Clockwise rotation about the screen's own centre."
          onChange={(value) => patch({ rotationDeg: value }, 'Rotate screen', `rotation:${screen.id}`)}
        />
        <div className="row row--wrap">
          {[0, 45, 90, 180, 270].map((angle) => (
            <Button
              key={angle}
              size="sm"
              variant="ghost"
              tooltip={`Set rotation to ${angle}°`}
              onClick={() => patch({ rotationDeg: angle }, 'Rotate screen')}
            >
              {angle}°
            </Button>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title="Native pixel resolution"
        hint="The pixel dimensions of the LED processor or media server output for this screen."
      >
        <div className="field__row">
          <NumberField
            label="Pixel width"
            unit="px"
            value={screen.pixelWidth}
            min={LIMITS.minPixel}
            max={LIMITS.maxPixel}
            step={8}
            precision={0}
            hint="Native horizontal resolution."
            validate={(value) =>
              value * screen.pixelHeight > LIMITS.maxPixelCount
                ? `Total pixel count would exceed ${LIMITS.maxPixelCount.toLocaleString()} px.`
                : null
            }
            onChange={(value) => patch({ pixelWidth: Math.round(value) }, 'Edit pixel width', `px:${screen.id}`)}
          />
          <NumberField
            label="Pixel height"
            unit="px"
            value={screen.pixelHeight}
            min={LIMITS.minPixel}
            max={LIMITS.maxPixel}
            step={8}
            precision={0}
            hint="Native vertical resolution."
            validate={(value) =>
              value * screen.pixelWidth > LIMITS.maxPixelCount
                ? `Total pixel count would exceed ${LIMITS.maxPixelCount.toLocaleString()} px.`
                : null
            }
            onChange={(value) => patch({ pixelHeight: Math.round(value) }, 'Edit pixel height', `px:${screen.id}`)}
          />
        </div>

        <div className="row row--wrap">
          {[
            { label: '1920×1080', w: 1920, h: 1080 },
            { label: '3840×2160', w: 3840, h: 2160 },
            { label: '1280×720', w: 1280, h: 720 },
            { label: '1024×768', w: 1024, h: 768 }
          ].map((preset) => (
            <Button
              key={preset.label}
              size="sm"
              variant="ghost"
              tooltip={`Set the native resolution to ${preset.label} (physical size is not changed)`}
              onClick={() =>
                patch({ pixelWidth: preset.w, pixelHeight: preset.h }, 'Set native resolution')
              }
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="grid-3">
          <div className="metric">
            <span className="metric__value">{aspectRatioLabel(screen.pixelWidth, screen.pixelHeight)}</span>
            <span className="metric__label">Pixel aspect</span>
          </div>
          <div className="metric">
            <span className="metric__value">{aspectDecimal(screen.pixelWidth, screen.pixelHeight)}</span>
            <span className="metric__label">Ratio (w/h)</span>
          </div>
          <div className="metric">
            <span className="metric__value">{screen.pixelWidth * screen.pixelHeight}</span>
            <span className="metric__label">Total pixels</span>
          </div>
        </div>

        <NumberField
          label="LED pixel pitch"
          unit="mm"
          value={pitchMm ?? 0}
          min={0}
          max={LIMITS.maxPixelPitchMm}
          step={0.05}
          precision={2}
          hint="Optional. Set 0 to leave pixel pitch unset (no pixel density is reported)."
          onChange={(value) =>
            patch({ pixelPitchMm: value > 0 ? value : null }, 'Edit pixel pitch', `pitch:${screen.id}`)
          }
        />

        {pixelDensity ? (
          <>
            <div className="grid-3">
              <div className="metric">
                <span className="metric__value">{pixelDensity.perMetre.toFixed(0)}</span>
                <span className="metric__label">Pixels / m</span>
              </div>
              <div className="metric">
                <span className="metric__value">{Math.round(pixelDensity.perSquareMetre).toLocaleString()}</span>
                <span className="metric__label">Pixels / m²</span>
              </div>
              <div className="metric">
                <span className="metric__value">
                  {(pixelDensity.physicalWidthMm / 1000).toFixed(2)} ×{' '}
                  {(pixelDensity.physicalHeightMm / 1000).toFixed(2)}
                </span>
                <span className="metric__label">Cabinet size m</span>
              </div>
            </div>
            <Callout tone="info">
              At {pitchMm} mm pitch these pixels measure{' '}
              {formatLength(pixelDensity.physicalWidthMm, unit)} × {formatLength(pixelDensity.physicalHeightMm, unit)},
              while the screen's physical size is {formatLength(screen.widthMm, unit)} ×{' '}
              {formatLength(screen.heightMm, unit)}. Use “Match physical size to pixels” to reconcile them.
            </Callout>
            <Button
              size="sm"
              tooltip="Set the physical size from the native resolution and pixel pitch"
              onClick={() =>
                patch(
                  {
                    widthMm: Math.round(pixelDensity.physicalWidthMm),
                    heightMm: Math.round(pixelDensity.physicalHeightMm)
                  },
                  'Match physical size to pixels'
                )
              }
            >
              Match physical size to pixels
            </Button>
          </>
        ) : (
          <Callout tone="info">
            Pixel density is only reported when a pixel pitch is set. Physical size and native resolution always
            remain independent values.
          </Callout>
        )}
      </PanelSection>

      <PanelSection title="Mapping" hint="Where this screen's pixels are placed inside an output.">
        <SelectField
          label="Output assignment"
          value={screen.mapping.outputId ?? ''}
          options={[
            { value: '', label: 'Not assigned' },
            ...project.outputs.map((output) => ({
              value: output.id,
              label: `${output.name} — ${output.width}×${output.height}`
            }))
          ]}
          onChange={(value) =>
            editorStore.dispatch({ type: 'assignOutput', ids: [screen.id], outputId: value || null })
          }
          hint="Assigning places the screen automatically; you can then edit the region."
        />

        <div className="field__row">
          <NumberField
            label="Region X"
            unit="px"
            value={Math.round(screen.mapping.region.x)}
            min={-LIMITS.maxOutputPixel}
            max={LIMITS.maxOutputPixel}
            precision={0}
            hint="Left edge of this screen's pixels inside the output."
            onChange={(value) =>
              editorStore.dispatch({
                type: 'setRegion',
                id: screen.id,
                region: { ...screen.mapping.region, x: Math.round(value) },
                coalesce: `region-x:${screen.id}`
              })
            }
          />
          <NumberField
            label="Region Y"
            unit="px"
            value={Math.round(screen.mapping.region.y)}
            min={-LIMITS.maxOutputPixel}
            max={LIMITS.maxOutputPixel}
            precision={0}
            onChange={(value) =>
              editorStore.dispatch({
                type: 'setRegion',
                id: screen.id,
                region: { ...screen.mapping.region, y: Math.round(value) },
                coalesce: `region-y:${screen.id}`
              })
            }
          />
        </div>
        <div className="field__row">
          <NumberField
            label="Region width"
            unit="px"
            value={Math.round(screen.mapping.region.width)}
            min={LIMITS.minPixel}
            max={LIMITS.maxOutputPixel}
            precision={0}
            hint="Native pixel width is used when “Track native size” is on."
            onChange={(value) =>
              editorStore.dispatch({
                type: 'setRegion',
                id: screen.id,
                region: { ...screen.mapping.region, width: Math.round(value) },
                coalesce: `region-w:${screen.id}`
              })
            }
          />
          <NumberField
            label="Region height"
            unit="px"
            value={Math.round(screen.mapping.region.height)}
            min={LIMITS.minPixel}
            max={LIMITS.maxOutputPixel}
            precision={0}
            onChange={(value) =>
              editorStore.dispatch({
                type: 'setRegion',
                id: screen.id,
                region: { ...screen.mapping.region, height: Math.round(value) },
                coalesce: `region-h:${screen.id}`
              })
            }
          />
        </div>
        <CheckboxField
          label="Track native size"
          checked={screen.mapping.autoRegion}
          onChange={(value) => {
            if (value) {
              editorStore.dispatch({ type: 'assignOutput', ids: [screen.id], outputId: screen.mapping.outputId })
              return
            }
            editorStore.dispatch({
              type: 'setRegion',
              id: screen.id,
              region: screen.mapping.region,
              auto: false
            })
          }}
          hint="When on, the region mirror's this screen's native pixel resolution."
        />
        <SliderField
          label="Output scale"
          value={screen.mapping.scale}
          min={0.1}
          max={4}
          step={0.05}
          format={(value) => `${value.toFixed(2)}×`}
          hint="Scales this screen inside its region when the physical pixels do not match the output."
          onChange={(value) =>
            editorStore.dispatch({ type: 'setMappingScale', id: screen.id, scale: value, coalesce: `scale:${screen.id}` })
          }
        />
        {screen.mapping.outputId === null ? (
          <Callout tone="warning" title="No output assigned">
            This screen is excluded from output maps until it is assigned to an output on the Pixel Mapping page.
          </Callout>
        ) : null}
      </PanelSection>

      <PanelSection title="Arrange">
        <ArrangeButtons state={{ selection: [screen.id] } as unknown as EditorState} />
        <Button
          size="sm"
          variant="ghost"
          icon="copy"
          tooltip="Duplicate this screen with a new stable id"
          onClick={() => {
            editorStore.dispatch({ type: 'duplicateScreens', ids: [screen.id] })
            notify('info', 'Screen duplicated', 'The copy has a new id and independent mapping settings.')
          }}
        >
          Duplicate
        </Button>
      </PanelSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Multi-selection
// ---------------------------------------------------------------------------

function MultiInspector({
  project,
  screens,
  unit
}: {
  project: Project
  screens: Screen[]
  unit: LengthUnit
}): JSX.Element {
  const ids = screens.map((screen) => screen.id)
  const [widthDraft, setWidthDraft] = useState(
    round(fromMm(screens[0].widthMm, unit), unit)
  )
  const [heightDraft, setHeightDraft] = useState(
    round(fromMm(screens[0].heightMm, unit), unit)
  )
  const [xShift, setXShift] = useState(0)
  const [yShift, setYShift] = useState(0)

  const bounds = useMemo(() => {
    const xs = screens.map((screen) => screen.xMm)
    const ys = screens.map((screen) => screen.yMm)
    const rights = screens.map((screen) => screen.xMm + screen.widthMm)
    const bottoms = screens.map((screen) => screen.yMm + screen.heightMm)
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...rights),
      maxY: Math.max(...bottoms)
    }
  }, [screens])

  return (
    <>
      <PanelSection title="Selection summary">
        <div className="grid-3">
          <div className="metric">
            <span className="metric__value">{screens.length}</span>
            <span className="metric__label">Screens</span>
          </div>
          <div className="metric">
            <span className="metric__value">
              {formatLength(bounds.maxX - bounds.minX, unit)} × {formatLength(bounds.maxY - bounds.minY, unit)}
            </span>
            <span className="metric__label">Combined bounds</span>
          </div>
          <div className="metric">
            <span className="metric__value">{screens.filter((screen) => screen.locked).length}</span>
            <span className="metric__label">Locked</span>
          </div>
        </div>
        <div className="row row--wrap">
          <CheckboxField
            label="Lock all selected"
            checked={screens.every((screen) => screen.locked)}
            onChange={(value) =>
              screens
                .filter((screen) => screen.locked !== value)
                .forEach((screen) => editorStore.dispatch({ type: 'toggleLock', ids: [screen.id] }))
            }
          />
          <CheckboxField
            label="Visible"
            checked={screens.every((screen) => screen.visible)}
            onChange={(value) =>
              screens
                .filter((screen) => screen.visible !== value)
                .forEach((screen) => editorStore.dispatch({ type: 'toggleVisible', ids: [screen.id] }))
            }
          />
        </div>
      </PanelSection>

      <PanelSection title="Arrange" hint="Alignment uses logical stage coordinates, never the zoomed viewport.">
        <ArrangeButtons state={{ selection: ids } as unknown as EditorState} />
      </PanelSection>

      <PanelSection title="Set size and position">
        <div className="field__row">
          <NumberField
            label={`Width for all (${UNIT_LABEL[unit]})`}
            value={widthDraft}
            min={fromMm(LIMITS.minDimensionMm, unit)}
            max={fromMm(LIMITS.maxDimensionMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            onChange={setWidthDraft}
            hint="Applied to every selected screen."
          />
          <NumberField
            label={`Height for all (${UNIT_LABEL[unit]})`}
            value={heightDraft}
            min={fromMm(LIMITS.minDimensionMm, unit)}
            max={fromMm(LIMITS.maxDimensionMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            onChange={setHeightDraft}
          />
        </div>
        <Button
          size="sm"
          icon="check"
          tooltip="Apply these physical dimensions to every selected screen"
          onClick={() =>
            editorStore.dispatch({
              type: 'updateScreens',
              ids,
              patch: { widthMm: toMm(widthDraft, unit), heightMm: toMm(heightDraft, unit) },
              label: 'Set size for selection'
            })
          }
        >
          Apply size
        </Button>

        <div className="field__row">
          <NumberField
            label={`Move X by (${UNIT_LABEL[unit]})`}
            value={xShift}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            onChange={setXShift}
            hint="Positive moves right; negative moves left."
          />
          <NumberField
            label={`Move Y by (${UNIT_LABEL[unit]})`}
            value={yShift}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            onChange={setYShift}
          />
        </div>
        <div className="row row--wrap">
          <Button
            size="sm"
            icon="check"
            tooltip="Move every selected screen by the entered distances"
            onClick={() =>
              editorStore.dispatch({
                type: 'setGeometry',
                changes: screens.map((screen) => ({
                  id: screen.id,
                  geometry: { xMm: screen.xMm + toMm(xShift, unit), yMm: screen.yMm + toMm(yShift, unit) }
                })),
                label: 'Move selection'
              })
            }
          >
            Apply move
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="rotate"
            tooltip="Reset the rotation of every selected screen to 0°"
            onClick={() =>
              editorStore.dispatch({
                type: 'updateScreens',
                ids,
                patch: { rotationDeg: 0 },
                label: 'Reset rotation'
              })
            }
          >
            Reset rotation
          </Button>
        </div>

        <SelectField
          label="Match sizes to the first selected screen"
          value=""
          options={[
            { value: '', label: 'Choose an axis…' },
            { value: 'width', label: 'Match width' },
            { value: 'height', label: 'Match height' },
            { value: 'both', label: 'Match width and height' }
          ]}
          onChange={(value) => {
            if (!value) return
            editorStore.dispatch({ type: 'matchSize', axis: value as 'width' | 'height' | 'both' })
          }}
        />
      </PanelSection>

      <PanelSection title="Mapping">
        <SelectField
          label="Assign all selected to output"
          value=""
          options={[
            { value: '', label: 'Choose an output…' },
            ...project.outputs.map((output) => ({
              value: output.id,
              label: `${output.name} — ${output.width}×${output.height}`
            }))
          ]}
          onChange={(value) => {
            if (!value) return
            editorStore.dispatch({ type: 'assignOutput', ids, outputId: value })
          }}
          hint="Regions are placed automatically to avoid overlapping what is already assigned."
        />
        <div className="row row--wrap">
          <Button
            size="sm"
            variant="ghost"
            icon="unlink"
            tooltip="Remove every selected screen from its output"
            onClick={() => editorStore.dispatch({ type: 'assignOutput', ids, outputId: null })}
          >
            Unassign
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="eye"
            tooltip="Toggle export visibility for the whole selection"
            onClick={() => editorStore.dispatch({ type: 'toggleExportVisible', ids })}
          >
            Toggle export
          </Button>
        </div>
      </PanelSection>
    </>
  )
}

// ---------------------------------------------------------------------------
// Stage + background
// ---------------------------------------------------------------------------

function StageInspector({
  project,
  onNotify
}: {
  project: Project
  onNotify: (level: 'info' | 'success' | 'warning' | 'error', message: string, detail?: string) => void
}): JSX.Element {
  const unit = project.stage.defaultUnit
  const stage = project.stage

  return (
    <>
      <Callout tone="info" title="Nothing selected">
        Stage properties are shown here. Select a screen on the canvas or in the list to edit its geometry, native
        resolution and mapping.
      </Callout>

      <PanelSection title="Stage" hint="Everything on the stage is measured from the top-left corner, +X right, +Y down.">
        <TextField
          label="Stage name"
          value={stage.name}
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateStage', patch: { name: value }, coalesce: 'stage-name' })
          }
        />
        <div className="field__row">
          <NumberField
            label="Stage width"
            unit={UNIT_LABEL[unit]}
            value={round(fromMm(stage.widthMm, unit), unit)}
            min={fromMm(LIMITS.minStageMm, unit)}
            max={fromMm(LIMITS.maxStageMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            hint="The real-world width of the performance space."
            onChange={(value) =>
              editorStore.dispatch({
                type: 'updateStage',
                patch: { widthMm: toMm(value, unit) },
                coalesce: 'stage-width'
              })
            }
          />
          <NumberField
            label="Stage height"
            unit={UNIT_LABEL[unit]}
            value={round(fromMm(stage.heightMm, unit), unit)}
            min={fromMm(LIMITS.minStageMm, unit)}
            max={fromMm(LIMITS.maxStageMm, unit)}
            step={unitStep(unit)}
            precision={precisionFor(unit)}
            onChange={(value) =>
              editorStore.dispatch({
                type: 'updateStage',
                patch: { heightMm: toMm(value, unit) },
                coalesce: 'stage-height'
              })
            }
          />
        </div>
        <NumberField
          label="Canvas resolution"
          unit="px/m"
          value={stage.canvasPxPerMeter}
          min={LIMITS.minCanvasPxPerMeter / 1000}
          max={LIMITS.maxCanvasPxPerMeter / 1000}
          step={1}
          precision={0}
          hint="Logical drawing scale only. At 40 px/m a 6 m stage is 240 logical units wide. This never changes screen geometry or exports."
          onChange={(value) =>
            editorStore.dispatch({
              type: 'updateStage',
              patch: { canvasPxPerMeter: Math.round(value * 1000) },
              coalesce: 'stage-canvas'
            })
          }
        />
        <div className="grid-3">
          <div className="metric">
            <span className="metric__value">{Math.round(stage.widthMm / 10)}</span>
            <span className="metric__label">Width cm</span>
          </div>
          <div className="metric">
            <span className="metric__value">{Math.round(stage.widthMm / 1000)}</span>
            <span className="metric__label">Width m</span>
          </div>
          <div className="metric">
            <span className="metric__value">{(stage.widthMm / stage.heightMm).toFixed(2)}</span>
            <span className="metric__label">Stage ratio</span>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Grid and snapping">
        <CheckboxField
          label="Show grid"
          checked={stage.gridVisible}
          onChange={(value) => editorStore.dispatch({ type: 'updateStage', patch: { gridVisible: value } })}
          hint="Ctrl+G toggles the grid from anywhere."
        />
        <NumberField
          label="Grid spacing"
          unit={UNIT_LABEL[unit]}
          value={round(fromMm(stage.gridSpacingMm, unit), unit)}
          min={fromMm(LIMITS.minGridSpacingMm, unit)}
          max={fromMm(LIMITS.maxGridSpacingMm, unit)}
          step={unitStep(unit)}
          precision={precisionFor(unit)}
          hint="Distance between major grid lines."
          onChange={(value) =>
            editorStore.dispatch({
              type: 'updateStage',
              patch: { gridSpacingMm: toMm(value, unit) },
              coalesce: 'grid-spacing'
            })
          }
        />
        <NumberField
          label="Minor subdivisions"
          value={stage.gridSubdivisions}
          min={1}
          max={20}
          precision={0}
          hint="Number of minor cells between major lines."
          onChange={(value) =>
            editorStore.dispatch({
              type: 'updateStage',
              patch: { gridSubdivisions: Math.round(value) },
              coalesce: 'grid-subdivisions'
            })
          }
        />
        <CheckboxField label="Snap to grid" checked={stage.snapToGrid} onChange={(value) => editorStore.dispatch({ type: 'updateStage', patch: { snapToGrid: value } })} />
        <CheckboxField label="Snap to other screens" checked={stage.snapToScreens} onChange={(value) => editorStore.dispatch({ type: 'updateStage', patch: { snapToScreens: value } })} />
        <CheckboxField label="Snap to stage edges and centre" checked={stage.snapToStage} onChange={(value) => editorStore.dispatch({ type: 'updateStage', patch: { snapToStage: value } })} />
        <CheckboxField label="Show alignment guides" checked={stage.guidesVisible} onChange={(value) => editorStore.dispatch({ type: 'updateStage', patch: { guidesVisible: value } })} />
        <CheckboxField label="Show ruler labels" checked={stage.rulersVisible} onChange={(value) => editorStore.dispatch({ type: 'updateStage', patch: { rulersVisible: value } })} />
        <SliderField
          label="Snap tolerance"
          value={stage.snapTolerancePx}
          min={LIMITS.minSnapTolerancePx}
          max={LIMITS.maxSnapTolerancePx}
          step={1}
          unit="px"
          format={(value) => `${value} px`}
          hint="How close (in screen pixels) a screen must be before it snaps. Hold Alt while dragging to bypass snapping."
          onChange={(value) =>
            editorStore.dispatch({
              type: 'updateStage',
              patch: { snapTolerancePx: Math.round(value) },
              coalesce: 'snap-tolerance'
            })
          }
        />
      </PanelSection>

      <PanelSection title="Project">
        <TextField
          label="Project name"
          value={project.meta.name}
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateProjectMeta', patch: { name: value }, coalesce: 'project-name' })
          }
        />
        <TextField
          label="Author"
          value={project.meta.author}
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateProjectMeta', patch: { author: value }, coalesce: 'project-author' })
          }
          hint="Stored with the project and written into export metadata."
        />
        <TextArea
          label="Project notes"
          value={project.meta.notes}
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateProjectMeta', patch: { notes: value }, coalesce: 'project-notes' })
          }
        />
        <CheckboxField
          label="Autosave"
          checked={project.settings.autosaveEnabled}
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateProjectSettings', patch: { autosaveEnabled: value } })
          }
          hint="Writes recovery snapshots without blocking the canvas."
        />
        <NumberField
          label="Autosave interval"
          unit="s"
          value={Math.round(project.settings.autosaveIntervalMs / 1000)}
          min={5}
          max={3600}
          precision={0}
          onChange={(value) =>
            editorStore.dispatch({
              type: 'updateProjectSettings',
              patch: { autosaveIntervalMs: Math.round(value) * 1000 },
              coalesce: 'autosave-interval'
            })
          }
        />
        <div className="row row--wrap">
          <Button
            size="sm"
            variant="ghost"
            icon="clock"
            tooltip="Open the recovery snapshot browser"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('cuepoint:recovery'))
              onNotify('info', 'Recovery snapshots', 'Choose a snapshot to restore the project to an earlier state.')
            }}
          >
            Recovery snapshots
          </Button>
        </div>
      </PanelSection>

      <PanelSection title="Outputs">
        {project.outputs.map((output) => (
          <div key={output.id} className="card">
            <div className="row">
              <Icon name="screen" size={14} />
              <span className="card__title">{output.name}</span>
              <div className="spacer" />
              <Badge tooltip="Output resolution in pixels">
                {output.width}×{output.height}
              </Badge>
            </div>
            <NumberField
              label="Width"
              unit="px"
              value={output.width}
              min={LIMITS.minOutputPixel}
              max={LIMITS.maxOutputPixel}
              step={8}
              precision={0}
              onChange={(value) =>
                editorStore.dispatch({
                  type: 'updateOutput',
                  id: output.id,
                  patch: { width: Math.round(value) },
                  coalesce: `out-w:${output.id}`
                })
              }
            />
            <NumberField
              label="Height"
              unit="px"
              value={output.height}
              min={LIMITS.minOutputPixel}
              max={LIMITS.maxOutputPixel}
              step={8}
              precision={0}
              onChange={(value) =>
                editorStore.dispatch({
                  type: 'updateOutput',
                  id: output.id,
                  patch: { height: Math.round(value) },
                  coalesce: `out-h:${output.id}`
                })
              }
            />
            <div className="row">
              <Button
                size="sm"
                variant="danger"
                icon="trash"
                tooltip="Delete this output and unassign its screens"
                disabled={project.outputs.length <= 1}
                onClick={() => editorStore.dispatch({ type: 'deleteOutput', id: output.id })}
              >
                Delete output
              </Button>
            </div>
          </div>
        ))}
        <Button
          size="sm"
          icon="plus"
          tooltip="Add another output device"
          onClick={() => editorStore.dispatch({ type: 'addOutput' })}
        >
          Add output
        </Button>
      </PanelSection>
    </>
  )
}

function BackgroundInspector({
  project,
  onNotify
}: {
  project: Project
  onNotify: (level: 'info' | 'success' | 'warning' | 'error', message: string, detail?: string) => void
}): JSX.Element {
  const background = project.stage.background
  const unit = project.stage.defaultUnit

  return (
    <PanelSection title="Stage background" hint="Photographs and plans are reference imagery only — a background is never treated as an LED screen.">
      {background.assetMissing ? (
        <Callout tone="warning" title="Background image missing">
          The referenced file could not be found. Import a replacement or remove the background.
        </Callout>
      ) : null}
      <div className="row row--wrap">
        <Button
          size="sm"
          icon="image"
          tooltip="Import a background image (PNG, JPEG or WebP) (Ctrl+Shift+I)"
          onClick={() => window.dispatchEvent(new CustomEvent('cuepoint:import-background'))}
        >
          {background.assetPath ? 'Replace image' : 'Import image'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="fit"
          tooltip="Reset the background offset, scale and rotation"
          disabled={!background.assetPath}
          onClick={() =>
            editorStore.dispatch({
              type: 'updateBackground',
              patch: { offsetXMm: 0, offsetYMm: 0, scale: 1, rotationDeg: 0 }
            })
          }
        >
          Reset transform
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon="trash"
          tooltip="Remove the background image reference from this project"
          disabled={!background.assetPath}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('cuepoint:remove-background'))
            onNotify('info', 'Background removed', 'The imported copy in the project folder can also be deleted.')
          }}
        >
          Remove
        </Button>
      </div>

      {background.assetPath ? (
        <p className="muted mono truncate" title={background.assetPath} style={{ fontSize: 'var(--text-xs)' }}>
          {background.assetPath}
        </p>
      ) : (
        <p className="muted">No background image. The stage is drawn as a flat surface.</p>
      )}

      <CheckboxField
        label="Show background"
        checked={background.visible}
        onChange={(value) =>
          editorStore.dispatch({ type: 'updateBackground', patch: { visible: value } })
        }
        hint="Hide the image without removing it from the project."
      />
      <CheckboxField
        label="Lock background"
        checked={background.locked}
        onChange={(value) => editorStore.dispatch({ type: 'updateBackground', patch: { locked: value } })}
        hint="Prevents accidental background edits; the background is never selectable on the canvas."
      />
      <SelectField
        label="Fit mode"
        value={background.fit}
        options={FIT_OPTIONS}
        onChange={(value) =>
          editorStore.dispatch({ type: 'updateBackground', patch: { fit: value as BackgroundFit } })
        }
        hint="Contain keeps the whole image visible; cover fills the stage and crops."
      />
      <SliderField
        label="Opacity"
        value={background.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(value) =>
          editorStore.dispatch({ type: 'updateBackground', patch: { opacity: value }, coalesce: 'bg-opacity' })
        }
      />
      <div className="field__row">
        <NumberField
          label="Offset X"
          unit={UNIT_LABEL[unit]}
          value={round(fromMm(background.offsetXMm, unit), unit)}
          step={unitStep(unit)}
          precision={precisionFor(unit)}
          onChange={(value) =>
            editorStore.dispatch({
              type: 'updateBackground',
              patch: { offsetXMm: toMm(value, unit) },
              coalesce: 'bg-offset-x'
            })
          }
        />
        <NumberField
          label="Offset Y"
          unit={UNIT_LABEL[unit]}
          value={round(fromMm(background.offsetYMm, unit), unit)}
          step={unitStep(unit)}
          precision={precisionFor(unit)}
          onChange={(value) =>
            editorStore.dispatch({
              type: 'updateBackground',
              patch: { offsetYMm: toMm(value, unit) },
              coalesce: 'bg-offset-y'
            })
          }
        />
      </div>
      <div className="field__row">
        <NumberField
          label="Scale"
          value={background.scale}
          min={0.02}
          max={50}
          step={0.05}
          precision={2}
          hint="Multiplies the fit scale."
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateBackground', patch: { scale: value }, coalesce: 'bg-scale' })
          }
        />
        <NumberField
          label="Rotation"
          unit="°"
          value={background.rotationDeg}
          min={-180}
          max={180}
          step={1}
          precision={1}
          onChange={(value) =>
            editorStore.dispatch({ type: 'updateBackground', patch: { rotationDeg: value }, coalesce: 'bg-rotation' })
          }
        />
      </div>
      {background.sourceWidth && background.sourceHeight ? (
        <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          Source image {background.sourceWidth} × {background.sourceHeight} px
        </p>
      ) : null}
    </PanelSection>
  )
}

function ArrangeButtons({ state }: { state: EditorState }): JSX.Element {
  const single = state.selection.length === 1
  return (
    <div className="column">
      <div className="row row--wrap">
        <IconButton icon="alignLeft" label="Align left (with the leftmost selected screen)" disabled={single} onClick={() => editorStore.dispatch({ type: 'align', mode: 'left' })} />
        <IconButton icon="alignCenter" label="Align horizontal centres" disabled={single} onClick={() => editorStore.dispatch({ type: 'align', mode: 'hcenter' })} />
        <IconButton icon="alignRight" label="Align right" disabled={single} onClick={() => editorStore.dispatch({ type: 'align', mode: 'right' })} />
        <IconButton icon="alignTop" label="Align top" disabled={single} onClick={() => editorStore.dispatch({ type: 'align', mode: 'top' })} />
        <IconButton icon="alignMiddle" label="Align vertical centres" disabled={single} onClick={() => editorStore.dispatch({ type: 'align', mode: 'vcenter' })} />
        <IconButton icon="alignBottom" label="Align bottom" disabled={single} onClick={() => editorStore.dispatch({ type: 'align', mode: 'bottom' })} />
      </div>
      <div className="row row--wrap">
        <IconButton icon="distribute" label="Distribute horizontally (needs 3 or more screens)" disabled={state.selection.length < 3} onClick={() => editorStore.dispatch({ type: 'distribute', axis: 'horizontal' })} />
        <IconButton icon="distribute" label="Distribute vertically (needs 3 or more screens)" disabled={state.selection.length < 3} onClick={() => editorStore.dispatch({ type: 'distribute', axis: 'vertical' })} />
        <IconButton icon="alignLeft" label="Align every selected screen to the stage's left edge" onClick={() => editorStore.dispatch({ type: 'align', mode: 'left', toStage: true })} />
        <IconButton icon="alignCenter" label="Centre the selection horizontally on the stage" onClick={() => editorStore.dispatch({ type: 'centerOnStage', axis: 'horizontal' })} />
        <IconButton icon="alignMiddle" label="Centre the selection vertically on the stage" onClick={() => editorStore.dispatch({ type: 'centerOnStage', axis: 'vertical' })} />
        <IconButton icon="fit" label="Centre the selection on the stage in both directions" onClick={() => editorStore.dispatch({ type: 'centerOnStage', axis: 'both' })} />
      </div>
      <div className="row row--wrap">
        <Segmented
          label=""
          value="none"
          options={[
            { value: 'none', label: 'Match width', tooltip: 'Set every selected screen to the first one’s width' },
            { value: 'none2', label: 'Match height', tooltip: 'Set every selected screen to the first one’s height' }
          ]}
          onChange={(value) =>
            editorStore.dispatch({ type: 'matchSize', axis: value === 'none' ? 'width' : 'height' })
          }
        />
        <Button
          size="sm"
          variant="ghost"
          icon="undo"
          tooltip="Undo the last change (Ctrl+Z)"
          onClick={() => editorStore.dispatch({ type: 'undo' })}
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="redo"
          tooltip="Redo the last undone change (Ctrl+Shift+Z)"
          onClick={() => editorStore.dispatch({ type: 'redo' })}
        >
          Redo
        </Button>
      </div>
    </div>
  )
}

function round(value: number, unit: LengthUnit): number {
  return Number(value.toFixed(precisionFor(unit)))
}

function precisionFor(unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return 0
    case 'cm':
      return 1
    case 'ft':
      return 2
    default:
      return 3
  }
}

function unitStep(unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return 10
    case 'cm':
      return 1
    case 'm':
      return 0.1
    case 'in':
      return 0.5
    case 'ft':
      return 0.5
    default:
      return 1
  }
}
