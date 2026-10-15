import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { encodePng } from '@main/services/pngEncoder'
import { createImage, fillRect, rgba, setPixel } from '@shared/raster/draw'

/**
 * The PNG encoder is the only binary format CuePoint writes itself, so the output is decoded
 * again here rather than merely round-tripped through the encoder. A wrong CRC, byte order or
 * filter byte would be invisible to a weaker test but would produce an unreadable file.
 */
describe('PNG encoder', () => {
  it('writes a valid PNG signature and header', () => {
    const buffer = encodePng(createImage(4, 3, rgba(0, 0, 0)))
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    // IHDR is the first chunk after the signature.
    expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(buffer.readUInt32BE(16)).toBe(4)
    expect(buffer.readUInt32BE(20)).toBe(3)
    expect(buffer[24]).toBe(8) // bit depth
    expect(buffer[25]).toBe(6) // colour type: RGBA
    // IEND terminates the file.
    expect(buffer.subarray(buffer.length - 8, buffer.length - 4).toString('ascii')).toBe('IEND')
  })

  it('preserves exact pixel values when decoded', () => {
    const image = createImage(8, 4, rgba(0, 0, 0, 255))
    fillRect(image, { x: 2, y: 1, width: 3, height: 2 }, rgba(255, 0, 128, 255))
    setPixel(image, 0, 0, rgba(1, 2, 3, 255))

    const decoded = PNG.sync.read(encodePng(image))
    expect(decoded.width).toBe(8)
    expect(decoded.height).toBe(4)
    const at = (x: number, y: number): number[] => {
      const index = (decoded.width * y + x) << 2
      return [decoded.data[index], decoded.data[index + 1], decoded.data[index + 2], decoded.data[index + 3]]
    }
    expect(at(0, 0)).toEqual([1, 2, 3, 255])
    expect(at(2, 1)).toEqual([255, 0, 128, 255])
    expect(at(4, 2)).toEqual([255, 0, 128, 255])
    expect(at(0, 3)).toEqual([0, 0, 0, 255])
    expect(at(5, 1)).toEqual([0, 0, 0, 255])
  })

  it('writes a large image without corruption', () => {
    const image = createImage(600, 400, rgba(10, 20, 30, 255))
    fillRect(image, { x: 100, y: 100, width: 200, height: 100 }, rgba(200, 40, 60, 255))
    const decoded = PNG.sync.read(encodePng(image))
    const index = (decoded.width * 150 + 200) << 2
    expect([decoded.data[index], decoded.data[index + 1], decoded.data[index + 2]]).toEqual([200, 40, 60])
  })

  it('rejects nonsense dimensions instead of writing a broken file', () => {
    expect(() => encodePng({ width: 0, height: 10, data: new Uint8ClampedArray(0) })).toThrow()
    expect(() => encodePng({ width: 10, height: -1, data: new Uint8ClampedArray(0) })).toThrow()
    expect(() => encodePng({ width: Number.NaN, height: 10, data: new Uint8ClampedArray(0) })).toThrow()
  })
})
