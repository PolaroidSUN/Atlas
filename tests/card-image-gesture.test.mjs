import test from 'node:test'
import assert from 'node:assert/strict'
import { constrainCardImagePosition, flowWrapForImage, textReserveForFreeImage } from '../src/features/canvas/card-image-gesture.js'
import { slotsForBand } from '../src/features/canvas/card-text-wrap.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('keeps image inside horizontal bounds when dragged left', () => {
  assert.deepEqual(constrainCardImagePosition(-30, 20, 42), { x: 0, y: 20 })
})
test('keeps image inside horizontal bounds when dragged right', () => {
  assert.deepEqual(constrainCardImagePosition(90, 20, 42), { x: 58, y: 20 })
})
test('allows vertical placement below existing text so the card can grow', () => {
  assert.deepEqual(constrainCardImagePosition(15, 840, 30), { x: 15, y: 840 })
})
test('prevents a negative top coordinate', () => {
  assert.deepEqual(constrainCardImagePosition(15, -100, 30), { x: 15, y: 0 })
})
test('handles a frame wider than its allowed content', () => {
  assert.deepEqual(constrainCardImagePosition(50, 12, 120), { x: 0, y: 12 })
})
test('an image in the middle of the card does not turn the text into an empty margin', () => {
  assert.equal(textReserveForFreeImage(80, 180, 280), null)
})
test('an image against the left side reserves only that side', () => {
  assert.deepEqual(textReserveForFreeImage(0, 90, 280), { side: 'left', reserve: 102 })
})
test('an image that would crush the line leaves the paragraph editable', () => {
  assert.equal(textReserveForFreeImage(0, 220, 280), null)
})
test('dragging an image stores a free position so it can sit in the middle', async () => {
  const source = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
  assert.match(source, /positionMode: 'free', layoutPreset: 'free', positionX:/)
  assert.match(source, /aspectRatio: 'auto'/)
})
test('a moved image indents only the side it left, so text wraps the other side', () => {
  const wrap = flowWrapForImage(0, 12, 40, 'left')
  assert.equal(wrap.align, 'left')
  assert.equal(wrap.margin, '13px 8px 4px 0%')
})
test('an image moved inward still leaves the paragraph beside it', () => {
  const wrap = flowWrapForImage(28, 0, 36)
  assert.equal(wrap.align, 'left')
  assert.match(wrap.margin, /4px 28%/)
})
test('an image in the middle of a line opens text on both sides', () => {
  const slots = slotsForBand(10, 28, [{ left: 90, right: 170, top: 0, bottom: 120 }], 280)
  assert.equal(slots.length, 2)
  assert.equal(slots[0].x, 0)
  assert.ok(slots[0].width < 90)
  assert.ok(slots[1].x > 170)
})
test('an image centered in the card leaves a column on each side', () => {
  const slots = slotsForBand(0, 20, [{ left: 70, right: 175, top: 0, bottom: 140 }], 250)
  assert.equal(slots.length, 2)
  assert.equal(slots[0].x, 0)
  assert.ok(slots[0].width >= 28)
  assert.ok(slots[1].x >= 175)
  assert.ok(slots[1].width >= 28)
})
test('a line follows the png silhouette instead of the rectangular frame', () => {
  const rows = []
  for (let index = 0; index < 20; index += 1) {
    const half = 0.12 + 0.38 * Math.sin((index / 19) * Math.PI)
    rows.push({ left: 0.5 - half, right: 0.5 + half })
  }
  const obstacle = { left: 40, right: 200, top: 0, bottom: 100, rows }
  const blocked = slots => (slots.length === 2 ? slots[1].x - (slots[0].x + slots[0].width) : 0)
  const shoulder = blocked(slotsForBand(0, 8, [obstacle], 280))
  const waist = blocked(slotsForBand(46, 54, [obstacle], 280))
  assert.ok(waist > shoulder + 20)
})
test('an image against the left edge leaves the line on the right only', () => {
  const slots = slotsForBand(0, 20, [{ left: 0, right: 80, top: 0, bottom: 40 }], 280)
  assert.equal(slots.length, 1)
  assert.ok(slots[0].x >= 80)
})
test('flow image persists horizontal and vertical offsets for reload', async () => {
  const source = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
  assert.match(source, /data-flow-x-percent/)
  assert.match(source, /data-flow-offset-y/)
  assert.match(source, /--card-image-flow-margin/)
})
