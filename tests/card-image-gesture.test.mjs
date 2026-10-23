import test from 'node:test'
import assert from 'node:assert/strict'
import { constrainCardImagePosition } from '../src/features/canvas/card-image-gesture.js'
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
test('normal image movement reanchors the ProseMirror image node in text flow', async () => {
  const source = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
  assert.match(source, /placeCardImageInTextFlow\(/)
  assert.match(source, /positionMode:\s*'flow'/)
  assert.doesNotMatch(source, /Atlas 1\.7: normal drag always persists the exact drop coordinates/)
})
test('flow image persists horizontal and vertical offsets for reload', async () => {
  const source = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
  assert.match(source, /data-flow-x-percent/)
  assert.match(source, /data-flow-offset-y/)
  assert.match(source, /--card-image-flow-margin/)
})
