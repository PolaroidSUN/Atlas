import test from 'node:test'
import assert from 'node:assert/strict'
import { contourFromPixels, markBackground, polygonFromRows, rowsFromMask } from '../src/features/canvas/card-image-contour.js'

function solid(width, height, fill) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    pixels[offset] = fill[0]
    pixels[offset + 1] = fill[1]
    pixels[offset + 2] = fill[2]
    pixels[offset + 3] = 255
  }
  return pixels
}

test('background connected to the frame is removed and an interior subject stays', () => {
  const width = 12
  const height = 10
  const pixels = solid(width, height, [250, 250, 250])
  for (let y = 3; y <= 7; y += 1) {
    for (let x = 4; x <= 8; x += 1) {
      const offset = (y * width + x) * 4
      pixels[offset] = 20
      pixels[offset + 1] = 30
      pixels[offset + 2] = 40
    }
  }
  const outside = markBackground(pixels, width, height)
  assert.equal(outside[0], 1)
  assert.equal(outside[5 * width + 6], 0)
  const { coverage } = rowsFromMask(outside, width, height)
  assert.ok(coverage > 0.1 && coverage < 0.5)
})

test('polygon follows a silhouette that is narrow at the ends and wide in the middle', () => {
  const rows = [
    null,
    { left: 0.42, right: 0.58 },
    { left: 0.42, right: 0.58 },
    { left: 0.2, right: 0.8 },
    { left: 0.18, right: 0.82 },
    { left: 0.2, right: 0.8 },
    { left: 0.4, right: 0.6 },
    null,
  ]
  const polygon = polygonFromRows(rows, 6)
  assert.match(polygon, /^polygon\(/)
  assert.match(polygon, /16\.8%/)
  assert.match(polygon, /83\.2%/)
  assert.match(polygon, /40\.8%/)
  const contour = contourFromPixels((() => {
    const width = 20
    const height = 16
    const pixels = solid(width, height, [255, 255, 255])
    for (let y = 2; y < 14; y += 1) {
      const reach = y < 6 || y > 10 ? 3 : 7
      for (let x = 10 - reach; x <= 10 + reach; x += 1) {
        const offset = (y * width + x) * 4
        pixels[offset] = 10
        pixels[offset + 1] = 12
        pixels[offset + 2] = 16
      }
    }
    return pixels
  })(), 20, 16)
  assert.ok(contour.polygon.startsWith('polygon('))
  assert.ok(contour.coverage < 0.8)
})

test('a photo that fills the frame keeps a rectangular wrap', () => {
  const pixels = solid(8, 8, [30, 40, 50])
  assert.equal(contourFromPixels(pixels, 8, 8), null)
})
