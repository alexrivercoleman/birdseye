// Instagram story card for a walk: a 1080×1920 PNG drawn on a canvas. Instagram's own UI covers roughly the top 230 px
// (profile bar) and bottom 200 px (reply bar), so everything sits between. The map matches RecapMap (lib/mapView),
// drawn at 2×. Shared through the OS share sheet (Web Share API), since Instagram's Stories API is native-only.
import type { Recap, RecapSpecies, Tier } from '../api/types'
import bird from '../assets/logo/bird.png'
import wordmark from '../assets/logo/wordmark.png'
import { TIER_COLORS } from '../components/TierBadge'
import { formatDate, formatDistance, formatDuration, formatTime } from './format'
import { fitView, staticMapUrl } from './mapView'

const W = 1080
const H = 1920
const X = 72 // side margin
const INNER = W - 2 * X
const MAP = { y: 500, w: INNER, h: 760 } // 468×380 CSS px at 2×
const C = { paper: '#f7f3ea', forest: '#1f3d2b', bark: '#3b2f25', muted: '#8a7f72', fern: '#e3ead9', white: '#ffffff' }
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const TIER_RANK: Record<Tier, number> = { rare: 0, uncommon: 1, common: 2 }
const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

export async function renderStoryCard(recap: Recap): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  await document.fonts?.ready

  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, W, H)

  // header: wordmark, date; place name
  const logo = await loadImage(wordmark)
  ctx.drawImage(logo, X - 6, 244, (logo.width * 120) / logo.height, 120)
  text(ctx, `${formatDate(recap.started_at)} · ${formatTime(recap.started_at)}`, W - X, 330, 34, C.muted, { align: 'right' })
  text(ctx, recap.public_area_label ?? 'Bird walk', X, 452, 64, C.forest, { weight: 800, maxWidth: INNER })

  await drawMap(ctx, recap)

  // stats
  const stats: [string, string][] = [
    ['Distance', formatDistance(recap.distance_m)],
    ['Time', formatDuration(recap.duration_s)],
    ['Species', String(recap.species_count)],
    ['Points', String(recap.points)],
  ]
  const gap = 20
  const bw = (INNER - gap * 3) / 4
  stats.forEach(([label, value], i) => {
    const x = X + i * (bw + gap)
    const last = i === stats.length - 1
    roundRect(ctx, x, 1296, bw, 150, 28, last ? C.forest : C.white)
    text(ctx, value, x + bw / 2, 1378, value.length > 6 ? 44 : 54, last ? C.paper : C.bark, { weight: 800, align: 'center', maxWidth: bw - 20 })
    text(ctx, label.toUpperCase(), x + bw / 2, 1420, 22, last ? '#c9d3c4' : C.muted, { weight: 600, align: 'center', spacing: 3 })
  })

  // top birds: rarest first, then most points
  const top = [...recap.species].sort((a, b) => TIER_RANK[a.rarity_tier] - TIER_RANK[b.rarity_tier] || b.points - a.points).slice(0, 3)
  text(ctx, 'TOP BIRDS', X, 1510, 24, C.muted, { weight: 700, spacing: 4 })
  if (recap.species.length > top.length)
    text(ctx, `of ${recap.species.length} species`, W - X, 1510, 26, C.muted, { align: 'right' })
  if (!top.length) text(ctx, 'A quiet walk: no birds identified.', X, 1580, 38, C.bark)
  top.forEach((s, i) => speciesRow(ctx, s, 1578 + i * 64))

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the story card'))), 'image/png'),
  )
  return new File([blob], `birdseye-walk-${recap.started_at.slice(0, 10)}.png`, { type: 'image/png' })
}

async function drawMap(ctx: CanvasRenderingContext2D, recap: Recap) {
  const { y, w, h } = MAP
  const route = recap.route ?? []
  const pins = recap.species.filter((s) => s.location)
  const coords: [number, number][] = [...route, ...pins.map((s): [number, number] => [s.location!.lng, s.location!.lat])]

  ctx.save()
  roundRectPath(ctx, X, y, w, h, 44, 12) // small bottom corners so Mapbox's attribution (bottom right) isn't clipped
  ctx.clip()
  ctx.fillStyle = C.fern
  ctx.fillRect(X, y, w, h)
  if (!coords.length) {
    const b = await loadImage(bird)
    const bh = 220
    ctx.drawImage(b, X + w / 2 - (b.width * bh) / b.height / 2, y + h / 2 - bh / 2, (b.width * bh) / b.height, bh)
    ctx.restore()
    return
  }
  const view = fitView(coords, w / 2, h / 2) // CSS px, like RecapMap; everything below is drawn at 2×
  if (token) {
    const basemap = await loadImage(staticMapUrl(view, w / 2, h / 2, token)).catch(() => null)
    if (basemap) ctx.drawImage(basemap, X, y, w, h)
  }
  const at = (c: [number, number]): [number, number] => {
    const [px, py] = view.project(c)
    return [X + px * 2, y + py * 2]
  }
  if (route.length >= 2) {
    ctx.beginPath()
    route.forEach((c, i) => (i ? ctx.lineTo(...at(c)) : ctx.moveTo(...at(c))))
    ctx.strokeStyle = C.forest
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  for (const s of pins) {
    // RecapMap: radius 8, stroke 2 white (3.5 forest when photographed) outside the circle
    const [px, py] = at([s.location!.lng, s.location!.lat])
    const stroke = s.photographed ? 3.5 : 2
    ctx.beginPath()
    ctx.arc(px, py, (8 + stroke) * 2, 0, Math.PI * 2)
    ctx.fillStyle = s.photographed ? C.forest : C.white
    ctx.fill()
    ctx.beginPath()
    ctx.arc(px, py, 16, 0, Math.PI * 2)
    ctx.fillStyle = TIER_COLORS[s.rarity_tier]
    ctx.fill()
  }
  ctx.restore()
}

function speciesRow(ctx: CanvasRenderingContext2D, s: RecapSpecies, y: number) {
  const chip = s.rarity_tier.toUpperCase()
  ctx.font = `700 22px ${FONT}`
  const chipW = ctx.measureText(chip).width + 36
  const name = text(ctx, s.common_name, X, y, 42, C.bark, { weight: 600, maxWidth: INNER - chipW - 24 })
  const cx = X + name + 20
  const [bg, fg] =
    s.rarity_tier === 'rare' ? [TIER_COLORS.rare, C.bark] : [`${TIER_COLORS[s.rarity_tier]}26`, TIER_COLORS[s.rarity_tier]]
  roundRect(ctx, cx, y - 34, chipW, 42, 21, bg)
  text(ctx, chip, cx + chipW / 2, y - 5, 22, fg, { weight: 700, align: 'center', spacing: 2 })
}

type TextOpts = { weight?: number; align?: CanvasTextAlign; maxWidth?: number; spacing?: number }
/** Draws one line (ellipsized to maxWidth); returns its width. */
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, o: TextOpts = {}) {
  ctx.font = `${o.weight ?? 400} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing ?? 0}px`
  let line = s
  if (o.maxWidth && ctx.measureText(line).width > o.maxWidth) {
    while (line.length > 1 && ctx.measureText(`${line}…`).width > o.maxWidth) line = line.slice(0, -1)
    line = `${line.trimEnd()}…`
  }
  ctx.fillText(line, x, y)
  const width = ctx.measureText(line).width
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  return width
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, rBottom = r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, rBottom)
  ctx.arcTo(x, y + h, x, y, rBottom)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // Mapbox allows it; without it the canvas can't be exported
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Couldn't load ${src.split('?')[0]}`))
    img.src = src
  })
}
