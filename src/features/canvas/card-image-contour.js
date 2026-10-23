/**
 * Tight text wrap around a card image, the way a PDF wraps to an object's
 * contour. @chenglou/pretext lays lines out one width at a time
 * (`layoutNextLineRange`: narrower beside the image, full width past it).
 * Inside the editor the caret has to stay in ProseMirror, so the same per-line
 * width is expressed as a CSS shape-outside polygon traced from the picture.
 * The browser then breaks each line against that curve.
 */

const clamp01 = value => Math.max(0, Math.min(1, value))

function cornerBackground(pixels, width, height) {
  const count = width * height
  const corners = [0, width - 1, (height - 1) * width, count - 1]
  let red = 0
  let green = 0
  let blue = 0
  let samples = 0
  for (const index of corners) {
    const offset = index * 4
    if (pixels[offset + 3] < 16) continue
    red += pixels[offset]
    green += pixels[offset + 1]
    blue += pixels[offset + 2]
    samples += 1
  }
  if (!samples) return null
  return { r: red / samples, g: green / samples, b: blue / samples }
}

/** Pixels connected to the frame edge that match the corner color are background. */
export function markBackground(pixels, width, height, tolerance = 38) {
  const count = width * height
  const outside = new Uint8Array(count)
  const background = cornerBackground(pixels, width, height)
  const matches = index => {
    const offset = index * 4
    const alpha = pixels[offset + 3]
    if (alpha < 24) return true
    if (!background) return false
    return Math.abs(pixels[offset] - background.r) <= tolerance
      && Math.abs(pixels[offset + 1] - background.g) <= tolerance
      && Math.abs(pixels[offset + 2] - background.b) <= tolerance
  }
  const queue = []
  const push = index => {
    if (index < 0 || index >= count || outside[index] || !matches(index)) return
    outside[index] = 1
    queue.push(index)
  }
  for (let x = 0; x < width; x += 1) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width)
    push(y * width + width - 1)
  }
  while (queue.length) {
    const index = queue.pop()
    const x = index % width
    const y = (index - x) / width
    if (x > 0) push(index - 1)
    if (x + 1 < width) push(index + 1)
    if (y > 0) push(index - width)
    if (y + 1 < height) push(index + width)
  }
  return outside
}

export function rowsFromMask(outside, width, height) {
  const rows = []
  let inside = 0
  for (let y = 0; y < height; y += 1) {
    let left = -1
    let right = -1
    for (let x = 0; x < width; x += 1) {
      if (outside[y * width + x]) continue
      if (left < 0) left = x
      right = x
      inside += 1
    }
    rows.push(left < 0 ? null : { left: left / width, right: (right + 1) / width })
  }
  return { rows, coverage: inside / Math.max(1, width * height) }
}

/** Widest ink on the rows crossed by one text line. Null when that band is transparent. */
export function spanForRows(rows, topRatio, bottomRatio) {
  if (!rows?.length || !(bottomRatio > topRatio)) return null
  const start = Math.max(0, Math.min(rows.length - 1, Math.floor(topRatio * rows.length)))
  const end = Math.max(start, Math.min(rows.length - 1, Math.ceil(bottomRatio * rows.length) - 1))
  let left = 1
  let right = 0
  for (let index = start; index <= end; index += 1) {
    const row = rows[index]
    if (!row) continue
    left = Math.min(left, row.left)
    right = Math.max(right, row.right)
  }
  if (!(right > left)) return null
  return { left, right }
}

/** Closed polygon, in percentages of the image frame, around the subject. */
export function polygonFromRows(rows, bands = 18) {
  const content = []
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]) content.push({ y: index, ...rows[index] })
  }
  if (content.length < 2) return null
  const first = content[0].y
  const last = content[content.length - 1].y
  const span = Math.max(1, last - first)
  const samples = []
  for (let band = 0; band <= bands; band += 1) {
    const start = first + (span * band) / bands
    const end = band === bands ? last : first + (span * (band + 1)) / bands
    let left = 1
    let right = 0
    for (const row of content) {
      if (row.y < start || row.y > end) continue
      left = Math.min(left, row.left)
      right = Math.max(right, row.right)
    }
    if (right <= left) continue
    const y = (band === bands ? last + 1 : start) / rows.length
    samples.push({ left, right, y })
  }
  if (samples.length < 2) return null
  const pad = 0.012
  const percent = value => `${Math.round(clamp01(value) * 1000) / 10}%`
  const leftEdge = samples.map(sample => `${percent(sample.left - pad)} ${percent(sample.y)}`)
  const rightEdge = samples.map(sample => `${percent(sample.right + pad)} ${percent(sample.y)}`)
  return `polygon(${[...leftEdge, ...rightEdge.reverse()].join(', ')})`
}

export function contourFromPixels(pixels, width, height) {
  if (!width || !height || !pixels) return null
  const outside = markBackground(pixels, width, height)
  const { rows, coverage } = rowsFromMask(outside, width, height)
  if (coverage < 0.04 || coverage > 0.92) return null
  const polygon = polygonFromRows(rows)
  if (!polygon) return null
  return { polygon, outside, coverage, rows }
}

const contourCache = new Map()

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('imagem ilegível'))
    image.src = src
  })
}

function drawFitted(context, image, width, height, fit, crop) {
  const naturalWidth = image.naturalWidth || image.width || 1
  const naturalHeight = image.naturalHeight || image.height || 1
  const cropLeft = Math.max(0, Number(crop.left) || 0) / 100
  const cropRight = Math.max(0, Number(crop.right) || 0) / 100
  const cropTop = Math.max(0, Number(crop.top) || 0) / 100
  const cropBottom = Math.max(0, Number(crop.bottom) || 0) / 100
  const sourceX = naturalWidth * cropLeft
  const sourceY = naturalHeight * cropTop
  const sourceWidth = Math.max(1, naturalWidth * (1 - cropLeft - cropRight))
  const sourceHeight = Math.max(1, naturalHeight * (1 - cropTop - cropBottom))
  context.clearRect(0, 0, width, height)
  if (fit === 'fill') {
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
    return
  }
  const scale = fit === 'cover'
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight)
  const drawnWidth = sourceWidth * scale
  const drawnHeight = sourceHeight * scale
  context.drawImage(
    image, sourceX, sourceY, sourceWidth, sourceHeight,
    (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight,
  )
}

/**
 * @returns {Promise<{ polygon: string, maskUrl: string, rows: Array<{ left: number, right: number } | null> } | null>}
 */
export function buildCardImageContour(src, { cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0, objectFit = 'contain', aspect = 0.75 } = {}) {
  const key = [src, cropLeft, cropRight, cropTop, cropBottom, objectFit, Math.round(Number(aspect) * 100) || 0].join('|')
  const cached = contourCache.get(key)
  if (cached) return cached
  const job = loadImage(src).then(image => {
    const sampleWidth = 96
    const ratio = Number(aspect) > 0.15 ? Number(aspect) : (image.naturalHeight || 1) / (image.naturalWidth || 1)
    const sampleHeight = Math.max(12, Math.min(180, Math.round(sampleWidth * ratio)))
    const canvas = document.createElement('canvas')
    canvas.width = sampleWidth
    canvas.height = sampleHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    drawFitted(context, image, sampleWidth, sampleHeight, objectFit, {
      left: cropLeft, right: cropRight, top: cropTop, bottom: cropBottom,
    })
    const imageData = context.getImageData(0, 0, sampleWidth, sampleHeight)
    const contour = contourFromPixels(imageData.data, sampleWidth, sampleHeight)
    if (!contour) return null
    const pixels = imageData.data
    for (let index = 0; index < contour.outside.length; index += 1) {
      if (contour.outside[index]) pixels[index * 4 + 3] = 0
    }
    context.putImageData(imageData, 0, 0)
    return { polygon: contour.polygon, maskUrl: canvas.toDataURL('image/png'), rows: contour.rows }
  }).catch(() => null)
  contourCache.set(key, job)
  job.then(result => { if (!result) contourCache.delete(key) })
  return job
}
