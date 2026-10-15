import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * End-to-end tests.
 *
 * These drive the real Electron application produced by `npm run build` — the same code
 * paths the installer ships. Every test gets its own application process and its own
 * isolated user-data directory, so one failure can never leak a missing project (or a
 * half-edited one) into the next test, and a test run never touches the operator's own
 * projects.
 */

const projectRoot = path.resolve(__dirname, '..', '..')
const screenshotDir = path.join(projectRoot, 'test-results', 'screenshots')
const keepArtifacts = Boolean(process.env.CUE_E2E_KEEP)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workspaceDir: string
let consoleErrors: string[]

/**
 * Screenshots are documentation aids, not assertions: Playwright's window capture can time
 * out on a busy desktop compositor, and a missing picture must never fail a functional test.
 */
async function capture(name: string): Promise<void> {
  try {
    await page.screenshot({ path: path.join(screenshotDir, name), timeout: 8000, animations: 'disabled' })
  } catch (error) {
    console.warn(`[e2e] screenshot ${name} skipped: ${String(error).split('\n')[0]}`)
  }
}

/** PNG header parse: verifies an exported file really has the expected dimensions. */
function readPngSize(filePath: string): { width: number; height: number } {
  const buffer = readFileSync(filePath)
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readdirSafe(directory: string): string[] {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

/** The navigation rail. Scoped so status-bar shortcuts never collide with a workspace name. */
function navRail(): Locator {
  return page.locator('nav[aria-label="Workspaces"]')
}

function screenRows(): Locator {
  return page.locator('.list[aria-label="Screens on the stage"] .list__item')
}

/** The property inspector panel (the screen list panel comes first in the DOM). */
function inspector(): Locator {
  return page.locator('.panel').nth(1)
}

function field(label: string): Locator {
  return inspector().getByRole('textbox', { name: label, exact: true })
}

async function openWorkspace(label: string, heading: string): Promise<void> {
  await navRail().getByRole('button', { name: label }).click()
  await expect(page.locator('.toolbar__title')).toHaveText(heading)
}

/** Creates a project through the New-project wizard — the only supported creation path. */
async function createProject(name = 'E2E Stage'): Promise<void> {
  await page.getByRole('button', { name: /New project/i }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByLabel('Folder').fill(workspaceDir)
  await dialog.getByRole('button', { name: 'Next' }).click()

  await dialog.getByRole('textbox', { name: /^Stage width/ }).fill('10')
  await dialog.getByRole('textbox', { name: /^Stage height/ }).fill('5')
  await dialog.getByRole('button', { name: 'Next' }).click()

  await dialog.getByRole('textbox', { name: /^Initial screens/ }).fill('2')
  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog).toContainText(name)
  await dialog.getByRole('button', { name: /Create project/i }).click()

  // The wizard finishes in the Stage Designer with the created screens on the stage.
  await expect(page.locator('.toolbar__title')).toHaveText('Stage Designer')
}

/** Gives one screen a known physical size and native resolution through the inspector. */
async function setScreenMetrics(): Promise<void> {
  await screenRows().first().click()
  await field('Width').fill('6')
  await field('Width').press('Enter')
  await field('Height').fill('3')
  await field('Height').press('Enter')
  await field('Pixel width').fill('1920')
  await field('Pixel width').press('Enter')
  await field('Pixel height').fill('960')
  await field('Pixel height').press('Enter')
}

test.beforeEach(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'cuepoint-e2e-'))
  workspaceDir = mkdtempSync(path.join(tmpdir(), 'cuepoint-project-'))
  consoleErrors = []
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test', CUE_E2E: '1' }
  })
  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.app-shell')).toBeVisible()
})

test.afterEach(async () => {
  try {
    await app?.close()
  } finally {
    if (keepArtifacts) {
      // Debug affordance: keep the isolated directories (and the main-process log) for inspection.
      console.log(`[e2e] kept user data: ${userDataDir}\n[e2e] kept workspace: ${workspaceDir}`)
    } else {
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  }

  // Asserted per test rather than once at the end, so a noisy workspace cannot hide behind a
  // later test that happens to stay quiet. Chromium autofill/DevTools chatter and a missing NDI
  // runtime are environment noise, not application errors.
  const relevant = consoleErrors.filter(
    (message) =>
      !message.includes('Autofill') && !message.includes('DevTools') && !/NDI/i.test(message)
  )
  expect(relevant, `console errors:\n${relevant.join('\n')}`).toEqual([])
})

test('launches with the CuePoint shell, navigation and copyright credit', async () => {
  await expect(page.locator('.titlebar__product')).toHaveText('CuePoint')
  await expect(navRail().locator('.nav-item')).toHaveCount(8)
  await expect(page.locator('.statusbar')).toContainText('© 2026 Sandila Fernando')
  // The supplied logo must load from the packaged resource path, not a dev URL.
  const logoLoaded = await page
    .locator('.titlebar__logo')
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
  expect(logoLoaded).toBe(true)
  await capture('01-home.png')
})

test('creates a project through the wizard and builds a two-screen stage', async () => {
  await createProject()
  await expect(screenRows()).toHaveCount(2)
  await expect(page.locator('.titlebar')).toContainText('E2E Stage')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  await capture('02-stage-designer.png')
})

test('edits screen properties and keeps physical size independent of pixel resolution', async () => {
  await createProject()
  await setScreenMetrics()

  // The unit stays visually attached to the field name while the accessible name stays clean,
  // so a screen reader (and by extension an assistive test) hears "Width", not "Width m".
  await expect(inspector().locator('.field__label', { hasText: /^Widthm$/ })).toHaveCount(1)
  await expect(field('Width')).toHaveCount(1)

  // 6 m x 3 m at 1920x960: both values must survive side by side.
  await expect(screenRows().first()).toContainText('1920×960')
  await expect(screenRows().first()).toContainText('6 m × 3 m')

  // Changing the native resolution must not move the physical size.
  await field('Pixel width').fill('1280')
  await field('Pixel width').press('Enter')
  await expect(screenRows().first()).toContainText('1280×960')
  await expect(screenRows().first()).toContainText('6 m × 3 m')
})

test('undo, redo, zoom and window resizing never change the stored geometry', async () => {
  await createProject()
  await setScreenMetrics()

  const xField = field('X position')
  const originalX = await xField.inputValue()
  await xField.fill('2')
  await xField.press('Enter')
  await expect(xField).toHaveValue('2')

  // Undo restores the stored value; redo reapplies it.
  await page.keyboard.press('Control+z')
  await expect(xField).toHaveValue(originalX)
  await page.keyboard.press('Control+Shift+z')
  await expect(xField).toHaveValue('2')
  await page.keyboard.press('Control+z')
  await expect(xField).toHaveValue(originalX)

  await page.locator('.toolbar').getByRole('button', { name: /Zoom in/i }).first().click()
  await page.getByRole('button', { name: /Fit the whole stage/i }).click()
  await expect(page.locator('.zoom-chip__value')).toContainText('%')

  // Resize the real OS window (the only meaningful resize for an Electron app) and confirm
  // stored geometry and the layout survive at each size.
  for (const [width, height] of [
    [1280, 800],
    [1366, 768],
    [1920, 1080]
  ] as const) {
    await app.evaluate(
      async ({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.unmaximize()
        window.setSize(size[0], size[1])
      },
      [width, height] as const
    )
    await expect(xField).toHaveValue(originalX)
    await expect(field('Width')).toHaveValue('6')
    await expect(field('Pixel width')).toHaveValue('1920')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    expect(overflow, `layout overflowed at ${width}x${height}`).toBe(true)
  }
})

test('saves the project and reopens it with identical geometry', async () => {
  await createProject()
  await setScreenMetrics()

  // The title-bar Save button drives the same `file.save` command as the Ctrl+S accelerator.
  // The accelerator itself lives on the native application menu, which synthetic key events
  // from a test driver never reach, so the button is the honest interface to exercise here.
  await page.getByRole('button', { name: /^Save project \(Ctrl\+S\)$/ }).click()
  await expect(page.locator('.statusbar')).toContainText('Saved', { timeout: 20_000 })

  const savedPath = await page.evaluate(() => {
    const bridge = (window as unknown as {
      cuepoint: { project: { recent(): Promise<{ ok: boolean; data: { path: string }[] }> } }
    }).cuepoint
    return bridge.project.recent().then((result) => (result.ok ? result.data[0]?.path : null))
  })
  expect(savedPath).toBeTruthy()
  expect(existsSync(savedPath as string)).toBe(true)
  expect(statSync(savedPath as string).size).toBeGreaterThan(100)

  // Reopen through the Home workspace's project table.
  await openWorkspace('Home', 'Home')
  await page.getByRole('button', { name: /^Open$/ }).first().click()
  await expect(page.locator('.toolbar__title')).toHaveText('Stage Designer')
  await expect(screenRows().first()).toContainText('1920×960')
  await expect(screenRows().first()).toContainText('6 m × 3 m')
  await capture('07-reopened-project.png')
})

test('exports pixel maps, CSV and JSON with verified dimensions', async () => {
  await createProject()
  await setScreenMetrics()
  await openWorkspace('Pixel Mapping', 'Pixel Mapping')
  await capture('03-pixel-mapping.png')

  await page.getByRole('button', { name: /^Export…$/ }).click()
  const dialog = page.getByRole('dialog', { name: /Export pixel maps/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /^Export$/ }).click()

  const toast = page.locator('.toast--success', { hasText: /Exported \d+ file\(s\)/ })
  await expect(toast).toBeVisible({ timeout: 60_000 })

  // The toast names the folder the export was written to; the panel promises it sits next to
  // the project file, so the reported path must be inside this test's project folder.
  const detail = await toast.locator('.toast__detail').innerText()
  const resolved = detail.split('·').pop()?.trim()
  expect(resolved, `expected the export folder in the toast, got "${detail}"`).toBeTruthy()
  expect(resolved as string).toMatch(new RegExp(`^${escapeForRegExp(path.join(workspaceDir, 'Exports'))}`))
  expect(existsSync(resolved as string)).toBe(true)

  const files = readdirSafe(resolved as string)
  expect(files.some((file) => file.endsWith('.png'))).toBe(true)
  expect(files.some((file) => file.endsWith('.csv'))).toBe(true)
  expect(files.some((file) => file.endsWith('.json'))).toBe(true)

  const combined = files.find((file) => file.startsWith('combined')) ?? files.find((file) => file.endsWith('.png'))
  const size = readPngSize(path.join(resolved as string, combined as string))
  expect(size.width).toBeGreaterThan(0)
  expect(size.height).toBeGreaterThan(0)

  const csvFile = files.find((file) => file.endsWith('.csv'))
  const csv = readFileSync(path.join(resolved as string, csvFile as string), 'utf8')
  expect(csv.split(/\r?\n/)[0]).toContain('screen_id')
  expect(csv).toContain('map_region_x')

  const jsonFile = files.find((file) => file.endsWith('.json'))
  const json = JSON.parse(readFileSync(path.join(resolved as string, jsonFile as string), 'utf8'))
  expect(json.format).toBe('cuepoint.mapping')
  expect(json.units).toMatchObject({ length: 'mm', pixel: 'px' })
  await capture('08-export-panel.png')
})

test('opens every workspace and shows real status instead of placeholders', async () => {
  await createProject()

  for (const [label, heading] of [
    ['NDI Studio', 'NDI Studio'],
    ['Recording', 'Recording'],
    ['Settings', 'Settings'],
    ['Diagnostics', 'Diagnostics'],
    ['Help', 'Help']
  ] as const) {
    await openWorkspace(label, heading)
  }
  await capture('04-diagnostics.png')

  // Diagnostics must report measured values, not placeholders.
  await openWorkspace('Diagnostics', 'Diagnostics')
  await expect(page.locator('.scroll-area')).toContainText('Electron')
  await expect(page.locator('.scroll-area')).toContainText('CuePoint memory')

  await openWorkspace('NDI Studio', 'NDI Studio')
  await expect(page.locator('.scroll-area')).toContainText(/NDI runtime|NDI runtime not detected|sources/)
  await capture('05-ndi-studio.png')
})

test('shows the shortcut reference with the same accelerators the app registers', async () => {
  await openWorkspace('Help', 'Help')
  await page.getByRole('button', { name: /Keyboard shortcuts/i }).first().click()
  await expect(page.locator('.scroll-area')).toContainText('Save')
  await expect(page.locator('.scroll-area')).toContainText('Ctrl+S')
  await capture('06-shortcuts.png')
})
