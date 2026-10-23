import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
const flow = await readFile(path.join(root, 'src/features/canvas/card-image-flow.js'), 'utf8')
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8')

test('drop finalization anchors image at text coordinates and splits a long paragraph when needed', () => {
  assert.match(flow, /export function settleCardImageInTextFlow/)
  assert.match(flow, /editor\.view\.posAtCoords\(/)
  assert.match(flow, /transaction\.split\(mapped\)/)
  assert.match(flow, /offsetY: 0/)
  assert.match(app, /settleCardImageInTextFlow\(/)
})

test('live movement remains in real text flow instead of switching to an absolute overlay', () => {
  const start = app.indexOf('const move = e => {', app.indexOf('function CardImageNodeView'))
  const end = app.indexOf('const end = e => {', start)
  const body = app.slice(start, end)
  const moveBranch = body.slice(body.indexOf("if (current.mode === 'move')"), body.indexOf('// Resize and crop'))
  assert.match(moveBranch, /placeCardImageInTextFlow\(/)
  assert.doesNotMatch(moveBranch, /position', 'absolute'/)
})

test('connection zones span the full side and separate incoming/outgoing hit areas', () => {
  assert.match(app, /width: '100%', height: `\$\{depth\}px`, top: outside \? `\$\{-depth\}px` : '0px'/)
  assert.match(app, /width: `\$\{depth\}px`, height: '100%', left: outside \? `\$\{-depth\}px` : '0px'/)
  assert.match(app, /handleStyle\('top', -1\)/)
  assert.match(app, /handleStyle\('top', 1\)/)
})

test('all visible connection edges snap to the exact center of the relevant node side', () => {
  assert.match(app, /function CenteredConnectionEdge\(props\)/)
  assert.match(app, /bounds\.x \+ bounds\.width \/ 2, y: bounds\.y/)
  assert.match(app, /bounds\.x \+ bounds\.width, y: bounds\.y \+ bounds\.height \/ 2/)
  assert.match(app, /bounds\.x \+ bounds\.width \/ 2, y: bounds\.y \+ bounds\.height/)
  assert.match(app, /const edgeTypes = \{ smoothstep: CenteredConnectionEdge \}/)
  assert.match(app, /edgeTypes=\{edgeTypes\}/)
})

test('connection ports are above resize rails so the full-side target remains usable', () => {
  assert.match(css, /--z-connection-hit: 12/)
  assert.match(css, /z-index: var\(--z-connection-hit\) !important/)
})
