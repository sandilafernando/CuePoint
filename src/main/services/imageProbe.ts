/**
 * Image header probing.
 *
 * Stage backgrounds only need their intrinsic size and format, so the headers are
 * parsed directly instead of pulling in an image decoding library. Anything that does
 * not parse cleanly is rejected, which is also the first line of defence against
 * handing a non-image file to the renderer.
 */

export interface ImageInfo {
  width: number
  height: number
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp'
}

export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']

export function probeImage(buffer: Uint8Array): ImageInfo | null {
  return probePng(buffer) ?? probeJpeg(buffer) ?? probeWebp(buffer) ?? probeGif(buffer) ?? probeBmp(buffer)
}

function probePng(buffer: Uint8Array): ImageInfo | null {
  if (buffer.length < 24) return null
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return null
  }
  if (buffer[12] !== 0x49 || buffer[13] !== 0x48 || buffer[14] !== 0x44 || buffer[15] !== 0x52) {
    return null
  }
  return {
    width: readUint32(buffer, 16),
    height: readUint32(buffer, 20),
    format: 'png'
  }
}

function probeJpeg(buffer: Uint8Array): ImageInfo | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    // Start-of-frame markers carry the dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (buffer[offset + 5] << 8) | buffer[offset + 6],
        width: (buffer[offset + 7] << 8) | buffer[offset + 8],
        format: 'jpeg'
      }
    }
    const length = (buffer[offset + 2] << 8) | buffer[offset + 3]
    if (length <= 0) return null
    offset += 2 + length
  }
  return null
}

function probeWebp(buffer: Uint8Array): ImageInfo | null {
  if (buffer.length < 30) return null
  const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3])
  const webp = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11])
  if (riff !== 'RIFF' || webp !== 'WEBP') return null
  const chunk = String.fromCharCode(buffer[12], buffer[13], buffer[14], buffer[15])

  if (chunk === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
    return { width, height, format: 'webp' }
  }
  if (chunk === 'VP8 ') {
    return {
      width: (buffer[26] | (buffer[27] << 8)) & 0x3fff,
      height: (buffer[28] | (buffer[29] << 8)) & 0x3fff,
      format: 'webp'
    }
  }
  if (chunk === 'VP8L') {
    const bits = buffer[21] | (buffer[22] << 8) | (buffer[23] << 16) | (buffer[24] << 24)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      format: 'webp'
    }
  }
  return null
}

function probeGif(buffer: Uint8Array): ImageInfo | null {
  if (buffer.length < 10) return null
  const header = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3], buffer[4], buffer[5])
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  return {
    width: buffer[6] | (buffer[7] << 8),
    height: buffer[8] | (buffer[9] << 8),
    format: 'gif'
  }
}

function probeBmp(buffer: Uint8Array): ImageInfo | null {
  if (buffer.length < 26) return null
  if (buffer[0] !== 0x42 || buffer[1] !== 0x4d) return null
  return {
    width: Math.abs(readInt32(buffer, 18)),
    height: Math.abs(readInt32(buffer, 22)),
    format: 'bmp'
  }
}

function readUint32(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] << 24) >>> 0) +
    (buffer[offset + 1] << 16) +
    (buffer[offset + 2] << 8) +
    buffer[offset + 3]
  )
}

function readInt32(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]
  )
}

export function extensionOf(filePath: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filePath)
  return match ? match[1].toLowerCase() : ''
}

export function isSupportedImagePath(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(extensionOf(filePath))
}
