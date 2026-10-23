import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = await readFile(path.join(root, 'src/App.jsx'), 'utf8')
const css = await readFile(path.join(root, 'src/styles-redesign.css'), 'utf8')

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing marker: ${endMarker}`)
  return source.slice(start, end)
}

test('connections use crisp orthogonal corners and square line caps', () => {
  const edge = between(app, 'function CenteredConnectionEdge(props)', 'function HoverNodeResizer')
  assert.match(edge, /borderRadius:\s*0/)
  assert.match(edge, /strokeLinecap:\s*'butt'/)
  assert.match(edge, /strokeLinejoin:\s*'miter'/)
})

test('existing edges can be reconnected through React Flow onReconnect', () => {
  assert.match(app, /reconnectEdge,/) 
  assert.match(app, /const onReconnect = useCallback\(\(oldEdge, newConnection\)/)
  assert.match(app, /onReconnect=\{onReconnect\} edgesReconnectable/)
  assert.match(app, /reconnectable:\s*true/)
})

test('image resize hit zones appear on hover and sit above the image viewport', () => {
  assert.match(app, /const \[imageHovered, setImageHovered\] = useState\(false\)/)
  assert.match(app, /onMouseEnter=\{\(\) => setImageHovered\(true\)\}/)
  assert.match(app, /onPointerEnter=\{\(\) => setImageHovered\(true\)\}/)
  assert.match(css, /\.card-image-node\.is-hovered \.card-image-resize-grip/)
  assert.match(css, /z-index:\s*1000 !important/)
  assert.match(css, /pointer-events:\s*auto !important/)
  assert.match(css, /\.card-image-node:not\(\.is-hovered\):not\(\.gesturing\)/)
})

test('toolbar list/alignment menu items do not cancel their pointer sequence', () => {
  const menuItem = between(app, 'const menuItem = (label, Icon, callback, active = false)', '  const setBlockStyle')
  assert.match(menuItem, /onSelect=\{\(\) => run\(callback\)\}/)
  assert.doesNotMatch(menuItem, /onPointerDown|onMouseDown|preventDefault/)
  assert.match(app, /menuItem\('Centralizar', AlignCenter/)
  assert.match(app, /menuItem\('Lista com marcadores', List/)
  const alignmentTrigger = between(app, '<AlignmentIcon size={14}', '</DropdownMenu.Trigger>')
  const listTrigger = between(app, '<List size={14} />', '</DropdownMenu.Trigger>')
  assert.doesNotMatch(alignmentTrigger, /preventDefault/)
  assert.doesNotMatch(listTrigger, /preventDefault/)
  assert.match(app, /setTextSelection\(\{ from: saved\.from, to: saved\.to \}\)/)
})
