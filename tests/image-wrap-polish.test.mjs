import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
const css = await readFile(path.join(root, 'src/styles-redesign.css'), 'utf8')

test('image movement repositions the real text-flow node during pointermove', () => {
  const moveStart = app.indexOf('const move = e => {', app.indexOf('function CardImageNodeView'))
  const moveEnd = app.indexOf('const end = e => {', moveStart)
  const pointerMoveBody = app.slice(moveStart, moveEnd)
  assert.match(pointerMoveBody, /if \(current\.mode === 'move'\)/)
  assert.match(pointerMoveBody, /placeCardImageInTextFlow\(/)
  assert.match(pointerMoveBody, /current\.lastFlowCommit/)
  assert.doesNotMatch(pointerMoveBody.slice(0, pointerMoveBody.indexOf('// Resize and crop')), /position', 'absolute'/)
})

test('Ctrl moves, edge drag resizes, and Alt edge drag crops', () => {
  assert.match(app, /if \(event\.ctrlKey\) \{ startGesture\(event, 'move'\); return \}/)
  assert.match(app, /if \(event\.altKey && edge\) \{ startGesture\(event, 'crop', edge\); return \}/)
  assert.match(app, /if \(edge\) \{ startGesture\(event, 'resize', edge\); return \}/)
})

test('image resize hit zone is larger than its visible marker', () => {
  assert.match(css, /width: calc\(24px \/ var\(--canvas-zoom, 1\)\) !important/)
  assert.match(css, /card-image-resize-grip::after[\s\S]*?width: calc\(9px \/ var\(--canvas-zoom, 1\)\)/)
})

test('document tab strip is not rendered; files remain opened through the explorer', () => {
  assert.doesNotMatch(app, /className="document-tabs-bar"/)
  assert.match(app, /className="sidebar-file-main"/)
})

test('dark accent uses the green highlight from the browser reference', () => {
  assert.match(css, /--accent: #00cc8f;/)
  assert.doesNotMatch(css, /--accent: #38d7c2;/)
})

test('resizing a flow image preserves its adjusted horizontal anchor', () => {
  assert.match(app, /xPercent: Math\.round\(nextX \* 100\) \/ 100, offsetY:/)
})


test('vertical offset is connected to the CSS variable that overrides margin-top', () => {
  assert.match(app, /'--card-image-flow-top': `\$\{flowOffsetY \+ \(align === 'center' \? 2 : 1\)\}px`/)
  assert.match(css, /margin-top: calc\(var\(--card-image-flow-top, 1px\)\) !important/)
})
