import '@testing-library/jest-dom/vitest'

/**
 * Renderer test setup.
 *
 * jsdom has no canvas implementation, and the Stage Designer draws through
 * `HTMLCanvasElement.getContext`. Components under test never assert on pixels here — the
 * painter is covered by the raster tests — so a no-op 2D context is installed to keep the
 * mount path working instead of throwing "not implemented".
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = (): void => undefined
  const fakeContext = {
    canvas: null as unknown as HTMLCanvasElement,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save: noop,
    restore: noop,
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    setLineDash: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 0 }),
    drawImage: noop,
    putImageData: noop,
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb'
    }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb'
    })
  }

  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement): unknown {
    fakeContext.canvas = this
    return fakeContext
  } as typeof HTMLCanvasElement.prototype.getContext
}

// jsdom does not implement ResizeObserver, which the canvas host uses for sizing.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

// jsdom does not implement pointer capture either.
if (typeof Element !== 'undefined') {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
}
