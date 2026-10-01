import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  clampZoom,
  coverScale,
  cropRect,
  displayedSize,
  imageOffset,
  panLimit,
} from '../crop'

const landscape = { width: 1600, height: 900 }
const portrait = { width: 900, height: 1600 }
const square = { width: 1000, height: 1000 }
const V = 320

describe('coverScale', () => {
  it('fills the viewport with the shorter side', () => {
    expect(coverScale(landscape, V)).toBeCloseTo(V / 900)
    expect(coverScale(portrait, V)).toBeCloseTo(V / 900)
    expect(coverScale(square, V)).toBeCloseTo(V / 1000)
  })

  it('is zero for a degenerate image or viewport rather than Infinity', () => {
    expect(coverScale({ width: 0, height: 100 }, V)).toBe(0)
    expect(coverScale(square, 0)).toBe(0)
  })
})

describe('clampZoom', () => {
  it('holds zoom inside the slider range', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM)
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(2.5)).toBe(2.5)
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM)
  })
})

describe('cropRect at zoom 1', () => {
  it('takes a centred, full-height square from a landscape image', () => {
    const r = cropRect(landscape, V, 1, { x: 0, y: 0 })
    expect(r.sw).toBeCloseTo(900)
    expect(r.sh).toBeCloseTo(900)
    expect(r.sy).toBeCloseTo(0)
    expect(r.sx).toBeCloseTo((1600 - 900) / 2)
  })

  it('takes a centred, full-width square from a portrait image', () => {
    const r = cropRect(portrait, V, 1, { x: 0, y: 0 })
    expect(r.sw).toBeCloseTo(900)
    expect(r.sx).toBeCloseTo(0)
    expect(r.sy).toBeCloseTo((1600 - 900) / 2)
  })

  it('takes the whole of a square image', () => {
    const r = cropRect(square, V, 1, { x: 0, y: 0 })
    expect(r).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 1000 })
  })

  it('ignores a pan along the axis that already fits', () => {
    // Landscape at zoom 1: height fits exactly, so vertical pan has nowhere to go.
    const r = cropRect(landscape, V, 1, { x: 0, y: 500 })
    expect(r.sy).toBeCloseTo(0)
  })
})

describe('clampPan', () => {
  it('is zero in both axes for a square image at zoom 1', () => {
    expect(clampPan(square, V, 1, { x: 40, y: -40 })).toEqual({ x: 0, y: 0 })
  })

  it('allows exactly half the overflow at zoom 2', () => {
    // 1000px square at cover for 320 is 320px; at 2x it is 640px, overflow 320.
    expect(panLimit(square, V, 2)).toEqual({ x: 160, y: 160 })
    expect(clampPan(square, V, 2, { x: 500, y: -500 })).toEqual({ x: 160, y: -160 })
    expect(clampPan(square, V, 2, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
  })

  it('treats a non-finite pan as centred', () => {
    expect(clampPan(square, V, 2, { x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({
      x: 0,
      y: 0,
    })
  })
})

describe('cropRect never leaves the image', () => {
  it('stops at the left edge when panned fully right', () => {
    const limit = panLimit(landscape, V, 1).x
    const r = cropRect(landscape, V, 1, { x: limit, y: 0 })
    expect(r.sx).toBeCloseTo(0)
  })

  it('stops at the right edge when panned fully left', () => {
    const limit = panLimit(landscape, V, 1).x
    const r = cropRect(landscape, V, 1, { x: -limit, y: 0 })
    expect(r.sx + r.sw).toBeCloseTo(1600)
  })

  it('clamps an unclamped pan — a stale pan after zooming out cannot expose the background', () => {
    const r = cropRect(square, V, 1.5, { x: 99999, y: -99999 })
    expect(r.sx).toBeGreaterThanOrEqual(0)
    expect(r.sy).toBeGreaterThanOrEqual(0)
    expect(r.sx + r.sw).toBeLessThanOrEqual(1000 + 1e-9)
    expect(r.sy + r.sh).toBeLessThanOrEqual(1000 + 1e-9)
  })

  it('is square at every zoom', () => {
    for (const zoom of [1, 1.7, 2.5, 4]) {
      const r = cropRect(portrait, V, zoom, { x: 12, y: -7 })
      expect(r.sw).toBeCloseTo(r.sh)
      expect(r.sw).toBeCloseTo(V / (coverScale(portrait, V) * zoom))
    }
  })

  it('zoom 2 with no pan is centred', () => {
    const r = cropRect(landscape, V, 2, { x: 0, y: 0 })
    expect(r.sw).toBeCloseTo(450)
    expect(r.sx).toBeCloseTo((1600 - 450) / 2)
    expect(r.sy).toBeCloseTo((900 - 450) / 2)
  })
})

describe('imageOffset and displayedSize', () => {
  it('positions the displayed image so it is centred at pan 0', () => {
    const shown = displayedSize(landscape, V, 1)
    expect(shown.height).toBeCloseTo(V)
    expect(shown.width).toBeCloseTo((1600 * V) / 900)
    const off = imageOffset(landscape, V, 1, { x: 0, y: 0 })
    expect(off.y).toBeCloseTo(0)
    expect(off.x).toBeCloseTo((V - shown.width) / 2)
  })
})
