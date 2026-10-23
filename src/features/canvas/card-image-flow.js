/**
 * Position a dragged card image back inside ProseMirror's real document flow.
 * This adapts the proven Atlas 1.1 mechanism: locate the text block at the
 * drop height, move the image node immediately before that block, and store a
 * float side + horizontal offset + vertical offset. The browser then wraps
 * actual text around the image instead of placing it on top of text.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function findCardImagePosition(editor, imageId, fallbackPosition = null) {
  if (!editor?.state?.doc) return null
  if (imageId) {
    let found = null
    editor.state.doc.descendants((candidate, position) => {
      if (candidate.type.name === 'image' && candidate.attrs.imageId === imageId) {
        found = position
        return false
      }
      return true
    })
    if (found !== null) return found
  }
  if (Number.isInteger(fallbackPosition) && editor.state.doc.nodeAt(fallbackPosition)?.type?.name === 'image') return fallbackPosition
  return null
}

/**
 * @param {object} editor Tiptap editor holding the card body.
 * @param {string|null} imageId Stable image identity.
 * @param {number} desiredTopScreen Desired image top in viewport coordinates.
 * @param {number} desiredLeftCss Desired left edge in unscaled editor CSS pixels.
 * @param {number} imageWidthCss Current visible image width in editor CSS pixels.
 * @param {number} zoom React Flow canvas zoom, used to convert viewport gaps to CSS pixels.
 * @param {number|null} fallbackPosition Last known ProseMirror position for legacy images without IDs.
 */
export function placeCardImageInTextFlow(editor, imageId, desiredTopScreen, desiredLeftCss, imageWidthCss, zoom = 1, fallbackPosition = null) {
  if (!editor?.view || editor.isDestroyed) return false
  const position = findCardImagePosition(editor, imageId, fallbackPosition)
  if (position === null) return false

  const sourceNode = editor.state.doc.nodeAt(position)
  if (!sourceNode || sourceNode.type.name !== 'image') return false

  const root = editor.view.dom
  // If the old image was free-positioned, clear the temporary text-margin
  // reservations before measuring the target block. Otherwise those margins
  // would bias the anchor selection and could leave text shifted after drop.
  root.style.minHeight = '0px'
  for (const block of root.querySelectorAll('[data-atlas-base-margin-left], [data-atlas-base-margin-right]')) {
    block.style.marginLeft = block.getAttribute('data-atlas-base-margin-left') || ''
    block.style.marginRight = block.getAttribute('data-atlas-base-margin-right') || ''
  }
  const editorWidth = Math.max(1, root.clientWidth)
  const boundedLeft = clamp(Number(desiredLeftCss) || 0, 0, Math.max(0, editorWidth - (Number(imageWidthCss) || 0)))
  const widthPct = clamp(((Number(imageWidthCss) || 0) / editorWidth) * 100, 8, 96)
  const xPercent = Math.round(clamp((boundedLeft / editorWidth) * 100, 0, Math.max(0, 100 - widthPct)) * 10) / 10
  const align = boundedLeft + (Number(imageWidthCss) || 0) / 2 < editorWidth / 2 ? 'left' : 'right'

  const blocks = []
  editor.state.doc.forEach((child, pos) => {
    if (!child.isBlock || child.type.name === 'image') return
    const dom = editor.view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return
    const rect = dom.getBoundingClientRect()
    if (rect.height < 1) return
    blocks.push({ pos, nodeSize: child.nodeSize, top: rect.top, bottom: rect.bottom })
  })

  let anchor
  if (blocks.length) {
    anchor = blocks.filter(block => block.top <= desiredTopScreen).sort((a, b) => b.top - a.top)[0]
    if (!anchor) anchor = blocks.sort((a, b) => a.top - b.top)[0]
  } else {
    // Empty card fallback: keep the image in normal flow at the nearest edge.
    anchor = { pos: 0, nodeSize: 0, top: root.getBoundingClientRect().top }
  }

  const safeZoom = Math.max(0.05, Number(zoom) || 1)
  const offsetY = Math.round(clamp((Number(desiredTopScreen) - anchor.top) / safeZoom, 0, 1600))
  const cropFactorX = Math.max(0.1, (100 - (Number(sourceNode.attrs.cropLeft) || 0) - (Number(sourceNode.attrs.cropRight) || 0)) / 100)
  const rawWidthPct = clamp(widthPct / cropFactorX, 8, 96)
  const attrs = {
    ...sourceNode.attrs,
    widthPct: Math.round(rawWidthPct * 100) / 100,
    align,
    layoutPreset: align,
    positionMode: 'flow',
    positionX: null,
    positionY: null,
    xPercent,
    offsetY,
  }

  let insertPosition = anchor.pos
  if (insertPosition > position) insertPosition -= sourceNode.nodeSize
  const shouldMove = insertPosition !== position
  const attrsChanged = Object.keys(attrs).some(key => sourceNode.attrs[key] !== attrs[key])
  if (!shouldMove && !attrsChanged) return true

  try {
    let transaction = editor.state.tr
    if (shouldMove) {
      transaction = transaction.delete(position, position + sourceNode.nodeSize)
      insertPosition = clamp(insertPosition, 0, transaction.doc.content.size)
      transaction = transaction.insert(insertPosition, sourceNode.type.create(attrs, sourceNode.content, sourceNode.marks))
    } else {
      transaction = transaction.setNodeMarkup(position, undefined, attrs)
    }
    if (transaction.docChanged) editor.view.dispatch(transaction.scrollIntoView())
    return true
  } catch (error) {
    console.warn('Atlas: não foi possível posicionar a imagem no fluxo do texto', error)
    return false
  }
}


/**
 * Finalize a dragged image at the text position nearest the drop coordinates.
 * Unlike the live-drag helper (which uses float offsets for smooth previews),
 * this commits the image between text runs/paragraphs so the browser can wrap
 * the same text beside and below the image. This avoids a large top margin
 * that visually makes text appear to start halfway down the image.
 */
export function settleCardImageInTextFlow(editor, imageId, desiredTopScreen, desiredLeftCss, imageWidthCss, zoom = 1, fallbackPosition = null) {
  if (!editor?.view || editor.isDestroyed) return false
  const sourcePosition = findCardImagePosition(editor, imageId, fallbackPosition)
  if (sourcePosition === null) return false
  const sourceNode = editor.state.doc.nodeAt(sourcePosition)
  if (!sourceNode || sourceNode.type.name !== 'image') return false

  const root = editor.view.dom
  const rootRect = root.getBoundingClientRect()
  const safeZoom = Math.max(0.05, Number(zoom) || 1)
  const editorWidth = Math.max(1, root.clientWidth || rootRect.width / safeZoom)
  const visibleWidth = Math.max(1, Number(imageWidthCss) || 1)
  const widthPctVisible = clamp((visibleWidth / editorWidth) * 100, 8, 96)
  const center = (Number(desiredLeftCss) || 0) + visibleWidth / 2
  const align = center < editorWidth / 2 ? 'left' : 'right'
  const probeCssX = align === 'left'
    ? (Number(desiredLeftCss) || 0) + visibleWidth + 6
    : (Number(desiredLeftCss) || 0) - 6
  const clampCssX = value => clamp(value, 2, Math.max(2, editorWidth - 2))
  const xCandidates = [...new Set([
    clampCssX(probeCssX),
    clampCssX((Number(desiredLeftCss) || 0) + visibleWidth / 2),
    editorWidth * 0.25,
    editorWidth * 0.5,
    editorWidth * 0.75,
  ])]
  const yCandidates = [...new Set([
    Number(desiredTopScreen) || rootRect.top,
    (Number(desiredTopScreen) || rootRect.top) + 3 * safeZoom,
    (Number(desiredTopScreen) || rootRect.top) - 3 * safeZoom,
  ])]

  const textblockAt = pos => {
    if (!Number.isInteger(pos) || pos < 0 || pos > editor.state.doc.content.size) return false
    try {
      const $pos = editor.state.doc.resolve(pos)
      for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).isTextblock) return true
      return false
    } catch { return false }
  }

  let targetPosition = null
  outer: for (const y of yCandidates) {
    for (const x of xCandidates) {
      const hit = editor.view.posAtCoords({ left: rootRect.left + x * safeZoom, top: y })
      if (hit && textblockAt(hit.pos)) { targetPosition = hit.pos; break outer }
    }
  }

  // If the drop is over blank space or an image, pick the nearest actual
  // textblock by vertical distance, then use a coordinate-derived text offset.
  if (targetPosition === null) {
    const blocks = []
    editor.state.doc.descendants((candidate, pos) => {
      if (!candidate.isTextblock) return true
      const dom = editor.view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) return true
      const rect = dom.getBoundingClientRect()
      const y = Number(desiredTopScreen) || rootRect.top
      const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      blocks.push({ pos, candidate, rect, distance })
      return true
    })
    blocks.sort((a, b) => a.distance - b.distance)
    const nearest = blocks[0]
    if (nearest) {
      const rel = clamp(((Number(desiredTopScreen) || nearest.rect.top) - nearest.rect.top) / Math.max(1, nearest.rect.height), 0, 1)
      const contentOffset = Math.max(0, Math.min(nearest.candidate.content.size, Math.round(nearest.candidate.content.size * rel)))
      targetPosition = nearest.pos + 1 + contentOffset
    }
  }

  let transaction = editor.state.tr.delete(sourcePosition, sourcePosition + sourceNode.nodeSize)
  const cropX = Math.max(0.1, (100 - (Number(sourceNode.attrs.cropLeft) || 0) - (Number(sourceNode.attrs.cropRight) || 0)) / 100)
  const rawWidthPct = clamp(widthPctVisible / cropX, 8, 96)
  const xPercent = Math.round(clamp(((Number(desiredLeftCss) || 0) / editorWidth) * 100, 0, Math.max(0, 100 - widthPctVisible)) * 10) / 10
  const attrs = {
    ...sourceNode.attrs,
    widthPct: Math.round(rawWidthPct * 100) / 100,
    align,
    layoutPreset: align,
    positionMode: 'flow',
    positionX: null,
    positionY: null,
    xPercent,
    offsetY: 0,
  }

  let insertPosition = transaction.doc.content.size
  if (targetPosition !== null) {
    const mapped = clamp(transaction.mapping.map(targetPosition, -1), 0, transaction.doc.content.size)
    const $target = transaction.doc.resolve(mapped)
    let textDepth = 0
    for (let depth = $target.depth; depth > 0; depth--) {
      if ($target.node(depth).isTextblock) { textDepth = depth; break }
    }
    if (textDepth > 0) {
      const block = $target.node(textDepth)
      const start = $target.start(textDepth)
      const end = $target.end(textDepth)
      if (mapped > start && mapped < end && block.content.size > 0) {
        try {
          transaction = transaction.split(mapped)
          // ProseMirror adds a closing and opening token at the split point;
          // the block-level insertion point is between those two new blocks.
          insertPosition = mapped + 1
        } catch {
          insertPosition = $target.parentOffset <= 0 ? $target.before(textDepth) : $target.after(textDepth)
        }
      } else {
        insertPosition = $target.parentOffset <= 0 ? $target.before(textDepth) : $target.after(textDepth)
      }
    } else {
      insertPosition = mapped
    }
  }

  try {
    const image = sourceNode.type.create(attrs, sourceNode.content, sourceNode.marks)
    transaction = transaction.insert(clamp(insertPosition, 0, transaction.doc.content.size), image)
    if (transaction.docChanged) editor.view.dispatch(transaction)
    return true
  } catch (error) {
    console.warn('Atlas: não foi possível fixar a imagem no fluxo do texto', error)
    return false
  }
}
