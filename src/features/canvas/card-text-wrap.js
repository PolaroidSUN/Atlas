/**
 * Both-sides text wrap, the same idea as Pretext's editorial engine:
 * each line asks which horizontal slots are free and fills every one,
 * so an image in the middle has words on its left and on its right.
 * CSS float cannot do that — a float only ever opens one side.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { layoutNextLineRange, materializeLineRange, prepareWithSegments } from '@chenglou/pretext'
import { buildCardImageContour, spanForRows } from './card-image-contour.js'

export const cardTextWrapKey = new PluginKey('cardTextWrap')

// 28px is about four characters. A centered image in a card still leaves
// a usable column on each side; anything narrower is not a text column.
export function slotsForBand(bandTop, bandBottom, obstacles, columnWidth, gap = 12, minSlot = 28) {
  const width = Math.max(0, Number(columnWidth) || 0)
  if (!(width > 0) || !(bandBottom > bandTop)) return [{ x: 0, width }]
  const blocked = []
  for (const obstacle of obstacles || []) {
    const top = Number(obstacle.top) || 0
    const bottom = Number(obstacle.bottom) || 0
    if (bottom <= bandTop || top >= bandBottom) continue
    let blockLeft = Number(obstacle.left) || 0
    let blockRight = Number(obstacle.right) || 0
    if (obstacle.rows?.length) {
      const frame = blockRight - blockLeft
      const height = bottom - top
      const span = height > 0 ? spanForRows(obstacle.rows, (bandTop - top) / height, (bandBottom - top) / height) : null
      if (!span) continue
      blockLeft += span.left * frame
      blockRight = (Number(obstacle.left) || 0) + span.right * frame
    }
    const start = Math.max(0, blockLeft - gap)
    const end = Math.min(width, blockRight + gap)
    if (end > start) blocked.push([start, end])
  }
  blocked.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const span of blocked) {
    const last = merged[merged.length - 1]
    if (!last || span[0] > last[1]) merged.push([span[0], span[1]])
    else last[1] = Math.max(last[1], span[1])
  }
  const slots = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start - cursor >= minSlot) slots.push({ x: cursor, width: start - cursor })
    cursor = Math.max(cursor, end)
  }
  if (width - cursor >= minSlot) slots.push({ x: cursor, width: width - cursor })
  return slots
}

const preparedCache = new Map()

function preparedFor(text, font) {
  const key = `${font}\n${text}`
  const cached = preparedCache.get(key)
  if (cached) return cached
  const prepared = prepareWithSegments(text, font)
  if (preparedCache.size > 40) preparedCache.clear()
  preparedCache.set(key, prepared)
  return prepared
}

/**
 * Lay `text` into the free slots around `obstacles`. Coordinates are local
 * to the column: y grows downward from the top of the paragraph.
 */
export function layoutAroundObstacles({ text, font, columnWidth, lineHeight, obstacles }) {
  const source = String(text || '').replace(/\s+/g, ' ').trim()
  const heightOf = lines => (lines.length ? lines[lines.length - 1].y + lineHeight : 0)
  if (!source || !(columnWidth > 0) || !(lineHeight > 0)) return { lines: [], height: 0 }
  const prepared = preparedFor(source, font || '12px sans-serif')
  const lines = []
  let cursor = { segmentIndex: 0, graphemeIndex: 0 }
  let consumed = 0
  let y = 0
  const limit = Math.max(lineHeight * 80, lineHeight + (obstacles || []).reduce((max, obstacle) => Math.max(max, Number(obstacle.bottom) || 0), 0))
  while (y < limit) {
    const slots = slotsForBand(y, y + lineHeight, obstacles, columnWidth)
    if (!slots.length) {
      y += lineHeight
      continue
    }
    let progressed = false
    const widerExists = slot => slots.some(other => other.width > slot.width + 8)
    for (const slot of slots) {
      const range = layoutNextLineRange(prepared, Math.max(1, slot.width), cursor)
      if (!range) return { lines, height: heightOf(lines) }
      const line = materializeLineRange(prepared, range)
      const next = range.end
      if (next.segmentIndex === cursor.segmentIndex && next.graphemeIndex === cursor.graphemeIndex) break
      if (!line.text) {
        cursor = next
        continue
      }
      const found = source.indexOf(line.text, consumed)
      const charStart = found >= 0 ? found : consumed
      const end = charStart + line.text.length
      const cutsWord = end < source.length && /\S/.test(line.text.at(-1) || '') && /\S/.test(source[end] || '')
      if (cutsWord && widerExists(slot)) continue
      cursor = next
      lines.push({ text: line.text, x: slot.x, y, width: slot.width, charStart })
      consumed = end
      progressed = true
    }
    if (!progressed) {
      const widest = slots.reduce((best, slot) => (slot.width > best.width ? slot : best), slots[0])
      const range = layoutNextLineRange(prepared, Math.max(1, widest.width), cursor)
      if (!range) return { lines, height: heightOf(lines) }
      const line = materializeLineRange(prepared, range)
      if (line.text && (range.end.segmentIndex !== cursor.segmentIndex || range.end.graphemeIndex !== cursor.graphemeIndex)) {
        const found = source.indexOf(line.text, consumed)
        const charStart = found >= 0 ? found : consumed
        lines.push({ text: line.text, x: widest.x, y, width: widest.width, charStart })
        consumed = charStart + line.text.length
        cursor = range.end
        progressed = true
      }
    }
    y += lineHeight
    if (!progressed) break
  }
  return { lines, height: heightOf(lines) }
}

let measureCanvas

function measureContext() {
  if (measureCanvas) return measureCanvas.getContext('2d')
  measureCanvas = document.createElement('canvas')
  return measureCanvas.getContext('2d')
}

export function charIndexAtX(text, font, x) {
  const value = String(text || '')
  if (!value || !(x > 0)) return 0
  const context = measureContext()
  if (!context) return Math.min(value.length, Math.round(x / 7))
  context.font = font || '12px sans-serif'
  let low = 0
  let high = value.length
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (context.measureText(value.slice(0, mid)).width <= x) low = mid
    else high = mid - 1
  }
  return low
}

function posAtTextOffset(view, paragraph, offset) {
  const start = view.posAtDOM(paragraph, 0)
  let remaining = Math.max(0, offset)
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent.length
    if (remaining <= length) {
      try { return view.posAtDOM(node, remaining) } catch { return start + remaining }
    }
    remaining -= length
    node = walker.nextNode()
  }
  return start + Math.max(0, offset)
}

const wrapState = new WeakMap()

function bindWrapClicks(overlay) {
  overlay.addEventListener('pointerdown', event => {
    const span = event.target?.closest?.('.atlas-text-wrap-line')
    const state = wrapState.get(overlay)
    const editor = state?.editor
    if (!span || !editor || editor.isDestroyed) return
    event.preventDefault()
    event.stopPropagation()
    const block = state.blocks?.get(span.dataset.block)
    if (!block?.isConnected) return
    const localX = (event.clientX - span.getBoundingClientRect().left) / Math.max(0.05, state.zoom || 1)
    const index = charIndexAtX(span.textContent, state.font, localX)
    const pos = posAtTextOffset(editor.view, block, Number(span.dataset.charStart) + index)
    editor.chain().focus().setTextSelection(Math.max(1, pos)).run()
  })
}

function wrapWidget(overlay) {
  return Decoration.widget(0, () => overlay, { side: -1, ignoreSelection: true, key: 'atlas-text-wrap' })
}

/** ProseMirror owns this widget, so the painted lines survive document updates. */
export const cardTextWrapExtension = Extension.create({
  name: 'cardTextWrap',
  addProseMirrorPlugins() {
    const overlay = document.createElement('div')
    overlay.className = 'atlas-text-wrap'
    overlay.setAttribute('aria-hidden', 'true')
    overlay.contentEditable = 'false'
    bindWrapClicks(overlay)
    return [new Plugin({
      key: cardTextWrapKey,
      state: {
        init: (_, state) => DecorationSet.create(state.doc, [wrapWidget(overlay)]),
        apply(tr, set) {
          const specs = tr.getMeta(cardTextWrapKey)
          if (!specs) return set.map(tr.mapping, tr.doc)
          const nodes = []
          for (const block of specs) {
            if (!Number.isInteger(block.from) || !Number.isInteger(block.to) || block.to <= block.from || block.to > tr.doc.content.size) continue
            nodes.push(Decoration.node(block.from, block.to, {
              class: 'atlas-wrap-source',
              style: `min-height: ${Math.ceil(block.height)}px`,
            }))
          }
          return DecorationSet.create(tr.doc, [wrapWidget(overlay), ...nodes])
        },
      },
      props: {
        decorations(state) { return this.getState(state) },
      },
    })]
  },
})

const publishedSpecs = new WeakMap()

function blockDecorationRange(view, block) {
  let inside
  try { inside = view.posAtDOM(block, 0) } catch { return null }
  if (!Number.isInteger(inside)) return null
  const $pos = view.state.doc.resolve(Math.min(view.state.doc.content.size, Math.max(0, inside)))
  if (!$pos.depth) return null
  return { from: $pos.before($pos.depth), to: $pos.after($pos.depth) }
}

function publishWrapDecorations(editor, specs) {
  const signature = JSON.stringify(specs)
  if (publishedSpecs.get(editor) === signature) return
  try {
    editor.view.dispatch(editor.state.tr.setMeta(cardTextWrapKey, specs))
    publishedSpecs.set(editor, signature)
  } catch {
    publishedSpecs.delete(editor)
  }
}

function placeCaret(overlay, editor, font, zoom) {
  let caret = overlay.querySelector(':scope > .atlas-wrap-caret')
  const selection = editor.state.selection
  if (!selection.empty || !selection.$from) {
    caret?.remove()
    return
  }
  const pos = selection.from
  const span = [...overlay.querySelectorAll('.atlas-text-wrap-line')].find(line => {
    const start = Number(line.dataset.pos)
    return pos >= start && pos <= start + line.textContent.length
  })
  if (!span) {
    caret?.remove()
    return
  }
  if (!caret) {
    caret = document.createElement('span')
    caret.className = 'atlas-wrap-caret'
    overlay.appendChild(caret)
  }
  const index = Math.max(0, Math.min(span.textContent.length, pos - Number(span.dataset.pos)))
  const context = measureContext()
  const width = context ? (context.font = font, context.measureText(span.textContent.slice(0, index)).width) : index * 7
  caret.style.left = `${parseFloat(span.style.left) + width}px`
  caret.style.top = span.style.top
  caret.style.height = span.style.height
  void zoom
}

/**
 * Paint the card's paragraphs around its images. Images stay absolutely
 * positioned, including in the center; the words occupy every free slot.
 */
function ensureContour(image, editor, zoom) {
  if (image.atlasContourRows !== undefined) return
  const picture = image.querySelector('img')
  if (!picture?.src) {
    image.atlasContourRows = null
    return
  }
  image.atlasContourRows = null
  const fit = picture.style.objectFit || 'contain'
  buildCardImageContour(picture.src, {
    objectFit: fit,
    aspect: image.offsetHeight / Math.max(1, image.offsetWidth),
  }).then(result => {
    if (!image.isConnected) return
    image.atlasContourRows = result?.rows || null
    applyWrappedCardText(editor, zoom)
  })
}

export function applyWrappedCardText(editor, zoom = 1) {
  const root = editor?.view?.dom
  if (!root) return
  const safeZoom = Math.max(0.05, Number(zoom) || 1)
  const blocks = [...root.querySelectorAll('p,h1,h2,h3,blockquote,li')]
    .filter(block => !block.closest('.card-image-node') && !block.closest('.atlas-text-wrap'))
  const images = [...root.querySelectorAll('.card-image-node')].filter(image => image.offsetWidth > 2 && image.offsetHeight > 2)
  for (const image of images) ensureContour(image, editor, safeZoom)
  const overlay = root.querySelector('.atlas-text-wrap')
  if (!images.length) {
    overlay?.replaceChildren()
    publishWrapDecorations(editor, [])
    return
  }
  if (!overlay) return
  const obstacles = images.map(image => ({
    left: image.offsetLeft,
    right: image.offsetLeft + image.offsetWidth,
    top: image.offsetTop,
    bottom: image.offsetTop + image.offsetHeight,
    rows: image.atlasContourRows || null,
  }))
  const layer = overlay
  const fontSample = blocks[0] ? getComputedStyle(blocks[0]) : null
  const parsedSize = parseFloat(fontSample?.fontSize) || 13
  const font = fontSample
    ? `${fontSample.fontStyle} ${fontSample.fontWeight} ${fontSample.fontSize} ${fontSample.fontFamily}`
    : '13px sans-serif'
  const parsedLine = parseFloat(fontSample?.lineHeight)
  const lineHeight = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : parsedSize * 1.65
  const preparedBlocks = []
  blocks.forEach((block, index) => {
    const text = block.textContent.replace(/\s+/g, ' ').trim()
    if (!text) return
    const blockTop = block.offsetTop
    const blockBottom = blockTop + Math.max(block.offsetHeight, lineHeight)
    const hits = obstacles.some(obstacle => obstacle.bottom > blockTop + 1 && obstacle.top < blockBottom)
    if (!hits) return
    const blockStyle = getComputedStyle(block)
    const padLeft = parseFloat(blockStyle.paddingLeft) || 0
    const padRight = parseFloat(blockStyle.paddingRight) || 0
    const padTop = parseFloat(blockStyle.paddingTop) || 0
    const contentLeft = block.offsetLeft + padLeft
    const local = obstacles.map(obstacle => ({
      left: obstacle.left - contentLeft,
      right: obstacle.right - contentLeft,
      top: obstacle.top - blockTop - padTop,
      bottom: obstacle.bottom - blockTop - padTop,
      rows: obstacle.rows,
    }))
    let layout
    try {
      layout = layoutAroundObstacles({ text, font, columnWidth: Math.max(1, block.clientWidth - padLeft - padRight), lineHeight, obstacles: local })
    } catch {
      return
    }
    if (!layout.lines.length) return
    const range = blockDecorationRange(editor.view, block)
    preparedBlocks.push({ block, index, layout, padLeft, padTop, contentLeft, range })
  })
  publishWrapDecorations(editor, preparedBlocks.map(entry => entry.range ? { from: entry.range.from, to: entry.range.to, height: entry.layout.height } : null).filter(Boolean))
  const observer = editor.view.domObserver
  observer?.stop()
  layer.replaceChildren()
  const placed = []
  for (const entry of preparedBlocks) {
    const blockTop = entry.block.offsetTop
    for (const line of entry.layout.lines) {
      const span = document.createElement('span')
      span.className = 'atlas-text-wrap-line'
      span.textContent = line.text
      span.dataset.block = String(entry.index)
      span.dataset.charStart = String(line.charStart)
      span.dataset.pos = String(posAtTextOffset(editor.view, entry.block, line.charStart))
      span.style.left = `${entry.contentLeft + line.x}px`
      span.style.top = `${blockTop + entry.padTop + line.y}px`
      span.style.width = `${line.width}px`
      span.style.height = `${lineHeight}px`
      span.style.font = font
      span.style.lineHeight = `${lineHeight}px`
      const overlapsImage = obstacles.some(obstacle => {
        const lineLeft = entry.contentLeft + line.x
        const lineRight = lineLeft + line.width
        const lineTop = blockTop + entry.padTop + line.y
        const lineBottom = lineTop + lineHeight
        if (lineRight <= obstacle.left + 1 || lineLeft >= obstacle.right - 1 || lineBottom <= obstacle.top + 1 || lineTop >= obstacle.bottom - 1) return false
        if (!obstacle.rows?.length) return true
        const height = obstacle.bottom - obstacle.top
        const span = height > 0 ? spanForRows(obstacle.rows, (lineTop - obstacle.top) / height, (lineBottom - obstacle.top) / height) : null
        if (!span) return false
        const inkLeft = obstacle.left + span.left * (obstacle.right - obstacle.left)
        const inkRight = obstacle.left + span.right * (obstacle.right - obstacle.left)
        return lineLeft < inkRight - 1 && lineRight > inkLeft + 1
      })
      if (overlapsImage) span.style.pointerEvents = 'none'
      layer.appendChild(span)
      placed.push(span)
    }
  }
  observer?.start()
  wrapState.set(layer, { editor, zoom: safeZoom, font, blocks: new Map(preparedBlocks.map(entry => [String(entry.index), entry.block])) })
  if (!placed.length) layer.replaceChildren()
  placeCaret(layer, editor, font, safeZoom)
}
