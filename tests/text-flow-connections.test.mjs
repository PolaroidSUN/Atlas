import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
const flow = await readFile(path.join(root, 'src/features/canvas/card-image-flow.js'), 'utf8')
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8')

test('drop finalization can still split a paragraph when an image returns to the text flow', () => {
  assert.match(flow, /export function settleCardImageInTextFlow/)
  assert.match(flow, /editor\.view\.posAtCoords\(/)
  assert.match(flow, /transaction\.split\(mapped\)/)
  assert.match(flow, /offsetY: 0/)
})

test('live movement can place the image in the middle of the text', () => {
  const start = app.indexOf('const move = e => {', app.indexOf('function CardImageNodeView'))
  const end = app.indexOf('const end = e => {', start)
  const body = app.slice(start, end)
  const moveBranch = body.slice(body.indexOf("if (current.mode === 'move')"), body.indexOf('// Resize and crop'))
  assert.match(moveBranch, /paintFlowWrap\(/)
  assert.match(body, /dataset\.positionMode = 'free'/)
  assert.match(body, /position', 'absolute'/)
  assert.match(app, /applyWrappedCardText\(/)
  assert.doesNotMatch(moveBranch, /placeCardImageInTextFlow\(/)
})

test('connection zones sit in the middle of each side so the edges can resize the shape', () => {
  assert.match(app, /width: `\$\{span\}px`, height: `\$\{depth\}px`, top: outside \? `\$\{-depth\}px` : '0px', transform: 'translateX\(-50%\)'/)
  assert.match(app, /width: `\$\{depth\}px`, height: `\$\{span\}px`, left: outside \? `\$\{-depth\}px` : '0px', transform: 'translateY\(-50%\)'/)
  assert.match(app, /handleStyle\('top', -1\)/)
  assert.match(app, /handleStyle\('top', 1\)/)
  assert.doesNotMatch(app.slice(app.indexOf('function ConnectionPorts'), app.indexOf('function CenteredConnectionEdge')), /height: '100%'/)
})

test('all visible connection edges snap to the exact center of the relevant node side', () => {
  assert.match(app, /function CenteredConnectionEdge\(props\)/)
  assert.match(app, /bounds\.x \+ bounds\.width \/ 2, y: bounds\.y/)
  assert.match(app, /bounds\.x \+ bounds\.width, y: bounds\.y \+ bounds\.height \/ 2/)
  assert.match(app, /bounds\.x \+ bounds\.width \/ 2, y: bounds\.y \+ bounds\.height/)
  assert.match(app, /const edgeTypes = \{ smoothstep: CenteredConnectionEdge \}/)
  assert.match(app, /edgeTypes=\{edgeTypes\}/)
})

test('connection ports stay above resize rails at the side center', () => {
  assert.match(css, /--z-connection-hit: 12/)
  assert.match(css, /z-index: var\(--z-connection-hit\) !important/)
})
