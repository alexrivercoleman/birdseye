// Instagram story images for a walk, drawn on a canvas:
// - renderStoryCard: a full 1080×1920 card. Instagram's own UI covers roughly the top 230 px (profile bar) and bottom
//   200 px (reply bar), so everything sits between. The map matches RecapMap (lib/mapView), drawn at 2×. Shared
//   through the OS share sheet (Web Share API), since Instagram's Stories API is native-only.
// - renderSticker: Strava-style transparent PNG (title, route + bird pins with no map, distance/time/species, 3 rarest
//   birds) in Barlow Semi Condensed, to copy and paste onto a story photo as a movable sticker.
import type { Recap, RecapSpecies, Tier } from '../api/types'
import bird from '../assets/logo/bird.png'
import barlow500 from '../assets/fonts/BarlowSemiCondensed-500.woff2'
import barlow600 from '../assets/fonts/BarlowSemiCondensed-600.woff2'
import barlow700 from '../assets/fonts/BarlowSemiCondensed-700.woff2'
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

  const top = rarest(recap)
  text(ctx, 'TOP BIRDS', X, 1510, 24, C.muted, { weight: 700, spacing: 4 })
  if (recap.species.length > top.length)
    text(ctx, `of ${recap.species.length} species`, W - X, 1510, 26, C.muted, { align: 'right' })
  if (!top.length) text(ctx, 'A quiet walk: no birds identified.', X, 1580, 38, C.bark)
  top.forEach((s, i) => speciesRow(ctx, s, 1578 + i * 64))

  return new File([await toPng(canvas)], `birdseye-walk-${recap.started_at.slice(0, 10)}.png`, { type: 'image/png' })
}

const SW = 900 // sticker width
const STICKER_CHIP: Record<Tier, [string, string]> = {
  rare: [TIER_COLORS.rare, C.bark],
  uncommon: [TIER_COLORS.uncommon, C.white],
  common: ['#6f756f', C.white],
}
// Barlow Semi Condensed: a free, sporty condensed grotesk close to Strava's type (SIL Open Font License, bundled)
const DISPLAY = `"Barlow Semi Condensed", ${FONT}`
let barlow: Promise<unknown> | null = null
const loadBarlow = () =>
  (barlow ??= Promise.all(
    ([[barlow500, '500'], [barlow600, '600'], [barlow700, '700']] as const).map(([url, weight]) =>
      new FontFace('Barlow Semi Condensed', `url(${url})`, { weight }).load().then((f) => document.fonts.add(f)),
    ),
  ).catch(() => null)) // falls back to the system font

export async function renderSticker(recap: Recap): Promise<Blob> {
  await loadBarlow()
  const route = recap.route ?? []
  const pins = recap.species.filter((s) => s.location)
  const coords: [number, number][] = [...route, ...pins.map((s): [number, number] => [s.location!.lng, s.location!.lat])]
  const top = rarest(recap)
  const ROUTE = { w: 820, h: 540 }
  const height = 140 + (coords.length ? ROUTE.h + 44 : 0) + 150 + (top.length ? 56 + top.length * 70 : 0) + 140
  const canvas = document.createElement('canvas')
  canvas.width = SW
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  // one soft shadow under everything, so white reads on any photo
  const shadow = () => {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetY = 3
  }
  shadow()

  const title = { weight: 700, align: 'center' as const, maxWidth: SW - 80, font: DISPLAY }
  text(ctx, recap.public_area_label ?? 'Bird walk', SW / 2, 104, 74, C.white, title)
  let y = 140

  if (coords.length) {
    const x0 = (SW - ROUTE.w) / 2
    const view = fitView(coords, ROUTE.w / 2, ROUTE.h / 2, 24)
    const at = (c: [number, number]): [number, number] => {
      const [px, py] = view.project(c)
      return [x0 + px * 2, y + py * 2]
    }
    if (route.length >= 2) {
      ctx.beginPath()
      route.forEach((c, i) => (i ? ctx.lineTo(...at(c)) : ctx.moveTo(...at(c))))
      ctx.strokeStyle = C.white
      ctx.lineWidth = 10
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
    for (const s of pins) {
      const [px, py] = at([s.location!.lng, s.location!.lat])
      ctx.beginPath()
      ctx.arc(px, py, s.photographed ? 25 : 23, 0, Math.PI * 2)
      ctx.fillStyle = s.photographed ? C.forest : C.white
      ctx.fill()
      ctx.beginPath()
      ctx.arc(px, py, 17, 0, Math.PI * 2)
      ctx.fillStyle = TIER_COLORS[s.rarity_tier]
      ctx.fill()
    }
    y += ROUTE.h + 44
  }

  // distance | time | species, Strava-style: small label over a big bold number
  const stats: [string, string][] = [
    ['Distance', formatDistance(recap.distance_m)],
    ['Time', formatDuration(recap.duration_s)],
    ['Species', String(recap.species_count)],
  ]
  const colW = 290
  stats.forEach(([label, value], i) => {
    const cx = SW / 2 + (i - 1) * colW
    let size = 76
    ctx.font = `700 ${size}px ${DISPLAY}`
    while (size > 50 && ctx.measureText(value).width > colW - 70) ctx.font = `700 ${(size -= 2)}px ${DISPLAY}`
    text(ctx, label, cx, y + 34, 30, 'rgba(255, 255, 255, 0.92)', { weight: 500, align: 'center', font: DISPLAY })
    text(ctx, value, cx, y + 114, size, C.white, { weight: 700, align: 'center', font: DISPLAY })
  })
  y += 150

  if (top.length) {
    // a short rule, then the rarest birds
    ctx.fillStyle = C.white
    ctx.fillRect(SW / 2 - 40, y + 22, 80, 4)
    y += 56
    for (const s of top) {
      const chip = s.rarity_tier.toUpperCase()
      ctx.font = `700 22px ${DISPLAY}`
      if ('letterSpacing' in ctx) ctx.letterSpacing = '2px'
      const chipW = ctx.measureText(chip).width + 36
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
      ctx.font = `600 48px ${DISPLAY}`
      const nameW = Math.min(ctx.measureText(s.common_name).width, SW - 80 - chipW - 20)
      const x = (SW - nameW - 20 - chipW) / 2
      text(ctx, s.common_name, x, y + 47, 48, C.white, { weight: 600, maxWidth: nameW + 1, font: DISPLAY })
      const [bg, fg] = STICKER_CHIP[s.rarity_tier]
      roundRect(ctx, x + nameW + 20, y + 10, chipW, 42, 21, bg)
      ctx.shadowColor = 'transparent'
      text(ctx, chip, x + nameW + 20 + chipW / 2, y + 39, 22, fg, { weight: 700, align: 'center', spacing: 2, font: DISPLAY })
      shadow()
      y += 70
    }
  }

  // wordmark on a small paper pill: its greens vanish on leafy photos otherwise
  const logo = await loadImage(wordmark)
  const lh = 64
  const lw = (logo.width * lh) / logo.height
  roundRect(ctx, SW / 2 - lw / 2 - 26, y + 28, lw + 52, lh + 24, (lh + 24) / 2, 'rgba(247, 243, 234, 0.94)')
  ctx.shadowColor = 'transparent'
  ctx.drawImage(logo, SW / 2 - lw / 2, y + 40, lw, lh)
  return toPng(canvas)
}

/** Up to 3 birds, rarest first, then most points. */
function rarest(recap: Recap): RecapSpecies[] {
  return [...recap.species].sort((a, b) => TIER_RANK[a.rarity_tier] - TIER_RANK[b.rarity_tier] || b.points - a.points).slice(0, 3)
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image'))), 'image/png'),
  )
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

type TextOpts = { weight?: number; align?: CanvasTextAlign; maxWidth?: number; spacing?: number; font?: string }
/** Draws one line (ellipsized to maxWidth); returns its width. */
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, o: TextOpts = {}) {
  ctx.font = `${o.weight ?? 400} ${size}px ${o.font ?? FONT}`
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
