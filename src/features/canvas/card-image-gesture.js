/**
 * Keep a card image horizontally inside its card's editable content area.
 * Y deliberately has no upper cap: moving an image down grows the editor/card
 * to include it, instead of making the image escape or become inaccessible.
 */
export function constrainCardImagePosition(x, y, visibleWidthPercent) {
  const width = Number.isFinite(Number(visibleWidthPercent))
    ? Math.max(0, Math.min(100, Number(visibleWidthPercent)))
    : 0
  const maxX = Math.max(0, 100 - width)
  const xValue = Number.isFinite(Number(x)) ? Number(x) : 0
  const yValue = Number.isFinite(Number(y)) ? Number(y) : 0
  return {
    x: Math.max(0, Math.min(maxX, xValue)),
    y: Math.max(0, yValue),
  }
}

/**
 * Side indent for a free image. An image in the middle must not push the
 * paragraph into an empty margin: that gap is not clickable, so the text in
 * the center of the card cannot be edited. Only an image sitting against one
 * side reserves space, and only when a real text column remains.
 */
export function textReserveForFreeImage(localLeft, localRight, editorWidth) {
  const width = Number(editorWidth)
  if (!(width > 0)) return null
  const left = Math.max(0, Number(localLeft) || 0)
  const right = Math.min(width, Number(localRight) || 0)
  if (!(right > left)) return null
  const gap = 12
  const minText = Math.max(72, width * 0.38)
  const againstLeft = left <= gap
  const againstRight = width - right <= gap
  if (againstLeft && !againstRight) {
    const reserve = right + gap
    if (width - reserve >= minText) return { side: 'left', reserve }
  }
  if (againstRight && !againstLeft) {
    const reserve = width - left + gap
    if (width - reserve >= minText) return { side: 'right', reserve }
  }
  return null
}

/**
 * Float placement that keeps the picture in the text flow. The empty inset is
 * only the side the image moved away from; the paragraph wraps the other side
 * instead of running underneath the picture.
 */
export function flowWrapForImage(xPercent, yPx, widthPercent, alignHint = 'left') {
  const width = Math.max(0, Math.min(100, Number(widthPercent) || 0))
  const y = Math.max(0, Math.round(Number(yPx) || 0))
  const hasX = xPercent !== null && xPercent !== undefined && Number.isFinite(Number(xPercent))
  const rawX = hasX ? Number(xPercent) : (alignHint === 'right' ? 100 - width : 0)
  const x = Math.max(0, Math.min(Math.max(0, 100 - width), rawX))
  const align = hasX ? (x + width / 2 < 50 ? 'left' : 'right') : (alignHint === 'right' ? 'right' : 'left')
  const leftInset = Math.round(x * 100) / 100
  const rightInset = Math.round(Math.max(0, 100 - x - width) * 100) / 100
  const gap = 8
  const margin = align === 'right'
    ? `${y + 1}px ${rightInset}% 4px ${gap}px`
    : `${y + 1}px ${gap}px 4px ${leftInset}%`
  return { align, x: leftInset, y, margin, top: `${y + 1}px` }
}
