#!/usr/bin/env node
/**
 * Generates every CuePoint icon asset from the supplied `public/Logo.png`.
 *
 * The original PNG is never modified: it is decoded, resized with a box filter and
 * re-encoded into the derived files the application and installer consume.
 *
 * Outputs:
 *   assets/icon.ico              multi-size Windows icon (16..256 px)
 *   build/icon.ico               electron-builder default icon location
 *   src/renderer/public/logo-64.png    title bar / About dialog
 *   src/renderer/public/logo-256.png   larger in-app uses
 *   assets/logo-512.png          source-resolution PNG copy for packaging
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'public', 'Logo.png')

/** Resizes an RGBA PNG using box filtering (area average), preserving alpha. */
function resize(image, width, height) {
  const out = new PNG({ width, height })
  const scaleX = image.width / width
  const scaleY = image.height / height
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scaleY)
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)))
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scaleX)
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (image.width * sy + sx) << 2
          const alpha = image.data[index + 3] / 255
          // Weight colour by alpha so transparent pixels do not darken the edge.
          r += image.data[index] * alpha
          g += image.data[index + 1] * alpha
          b += image.data[index + 2] * alpha
          a += image.data[index + 3]
          count += 1
        }
      }
      const outIndex = (width * y + x) << 2
      const alphaSum = a / count
      const weight = alphaSum / 255 || 1
      out.data[outIndex] = Math.round(r / count / weight)
      out.data[outIndex + 1] = Math.round(g / count / weight)
      out.data[outIndex + 2] = Math.round(b / count / weight)
      out.data[outIndex + 3] = Math.round(alphaSum)
    }
  }
  return out
}

function encode(image) {
  return PNG.sync.write(image, { colorType: 6, deflateLevel: 9 })
}

async function main() {
  if (!existsSync(source)) {
    throw new Error(`The source logo was not found at ${source}`)
  }
  const input = await readFile(source)
  const decoded = PNG.sync.read(input)
  console.log(`Source logo: ${decoded.width} x ${decoded.height}`)

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = new Map()
  for (const size of sizes) {
    pngs.set(size, encode(resize(decoded, size, size)))
  }

  await mkdir(path.join(root, 'assets'), { recursive: true })
  await mkdir(path.join(root, 'build'), { recursive: true })
  await mkdir(path.join(root, 'src', 'renderer', 'public'), { recursive: true })

  const ico = await pngToIco(sizes.map((size) => pngs.get(size)))
  await writeFile(path.join(root, 'assets', 'icon.ico'), ico)
  await writeFile(path.join(root, 'build', 'icon.ico'), ico)
  await writeFile(path.join(root, 'src', 'renderer', 'public', 'logo-64.png'), pngs.get(64))
  await writeFile(path.join(root, 'src', 'renderer', 'public', 'logo-256.png'), pngs.get(256))
  await writeFile(path.join(root, 'assets', 'logo-256.png'), pngs.get(256))
  await writeFile(path.join(root, 'assets', 'logo-512.png'), encode(resize(decoded, 512, 512)))

  console.log('Wrote:')
  console.log('  assets/icon.ico              ', ico.length, 'bytes')
  console.log('  build/icon.ico               ', ico.length, 'bytes')
  console.log('  assets/logo-256.png')
  console.log('  assets/logo-512.png')
  console.log('  src/renderer/public/logo-64.png')
  console.log('  src/renderer/public/logo-256.png')
}

main().catch((error) => {
  console.error('Icon generation failed:', error.message)
  process.exitCode = 1
})
