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
