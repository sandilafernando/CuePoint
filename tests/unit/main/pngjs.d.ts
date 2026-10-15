/**
 * Minimal ambient types for `pngjs`, which ships without declarations.
 *
 * Only the decoding surface the encoder tests use is declared: the encoder's output is
 * decoded again so a wrong CRC, byte order or filter byte cannot pass unnoticed.
 */
declare module 'pngjs' {
  export interface PngData {
    width: number
    height: number
    data: Buffer
  }

  export interface PngOptions {
    width?: number
    height?: number
    fill?: boolean
    colorType?: number
    inputColorType?: number
  }

  export class PNG {
    constructor(options?: PngOptions)
    static sync: {
      read(buffer: Buffer, options?: PngOptions): PngData
      write(png: PNG): Buffer
    }
    width: number
    height: number
    data: Buffer
  }
}
