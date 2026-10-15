import { deflateSync } from 'node:zlib'
import type { RgbaImage } from '@shared/raster/draw'

/**
 * Minimal, dependency-free PNG encoder (8-bit RGBA, non-interlaced).
 *
 * The export pipeline already produces raw RGBA buffers from the stored logical model,
 * so encoding them here keeps the export path free of native image libraries and makes
 * the byte output deterministic and testable.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0)
  return Buffer.concat([length, typeBuffer, payload, crc])
}

export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('PNG dimensions must be positive.')
  }
  if (data.length !== width * height * 4) {
    throw new Error(
      `PNG buffer size mismatch: expected ${width * height * 4} bytes for ${width}x${height}, received ${data.length}.`
    )
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // colour type: truecolour with alpha
  ihdr.writeUInt8(0, 10) // deflate
  ihdr.writeUInt8(0, 11) // adaptive filtering
  ihdr.writeUInt8(0, 12) // no interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter type: none
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    )
  }

  const idat = deflateSync(raw, { level: 6 })
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}
