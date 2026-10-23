const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/** Reads the current schema and the legacy `data-free-position` HTML format. */
export function normalizeCardImageMode(attrs = {}) {
  if (attrs.positionMode === 'free' || attrs.positionMode === 'flow') return attrs.positionMode
  return attrs.freePosition === true || attrs['data-free-position'] === 'true' ? 'free' : 'flow'
}

/** Resize around the edge opposite the active grip, within the editor bounds. */
export function resizeCardImageFrame({ edge, startX, startY, startWidth, startHeight, deltaXPercent, deltaY, minWidth = 8, maxWidth = 96, minHeight = 36, maxHeight = 1400 }) {
  let x = startX, y = startY, width = startWidth, height = startHeight
  if (edge.includes('w')) {
    const fixedRight = startX + startWidth
    width = clamp(startWidth - deltaXPercent, minWidth, Math.min(maxWidth, fixedRight))
    x = fixedRight - width
  } else if (edge.includes('e')) {
    width = clamp(startWidth + deltaXPercent, minWidth, Math.min(maxWidth, 100 - startX))
  }
  if (edge.includes('n')) {
    const fixedBottom = startY + startHeight
    height = clamp(startHeight - deltaY, minHeight, Math.min(maxHeight, fixedBottom))
    y = fixedBottom - height
  } else if (edge.includes('s')) {
    height = clamp(startHeight + deltaY, minHeight, maxHeight)
  }
  return { x: Math.max(0, x), y: Math.max(0, y), width, height }
}
