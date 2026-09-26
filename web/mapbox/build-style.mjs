// Builds Birdseye's Mapbox style ("field guide": warm paper land, sage parks, muted teal water, quiet roads so the
// community map's trail colors pop) from Mapbox Outdoors v12, and optionally uploads it to the Mapbox account.
//
//   node mapbox/build-style.mjs                      # writes mapbox/birdseye-style.json
//   node mapbox/build-style.mjs --upload             # updates the style in place (MAPBOX_STYLE_ID='' creates one)
//
// --upload needs MAPBOX_SECRET_TOKEN (in the environment or web/.env.local, which git ignores), a secret token with
// the styles:write scope (Mapbox account → Tokens). Style API verified against
// docs.mapbox.com/api/maps/styles 2026-09-26. The uploaded style can be opened and tweaked in Mapbox Studio;
// re-running --upload overwrites those tweaks, so port them here.
import { readFileSync, writeFileSync } from 'node:fs'

const USERNAME = 'd1birder'
const STYLE_ID = process.env.MAPBOX_STYLE_ID ?? 'cmuikczu500de01s91vchgmsa' // web/src/lib/mapStyle.ts uses it
const OUT = new URL('./birdseye-style.json', import.meta.url)
const envFile = (name) => { try { return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8') } catch { return '' } }
const publicToken = envFile('.env').match(/VITE_MAPBOX_TOKEN=(\S+)/)[1]

// app palette (web/src/index.css) and map-only tones
const C = {
  land: '#f0e9d8', paper: '#f7f3ea', bark: '#3b2f25', forest: '#1f3d2b', moss: '#3f6b4a',
  park: '#c8dab0', wood: '#b4cc98', grass: '#d3e1bb', water: '#94c5cb', waterLine: '#78b0b7',
  building: '#e4dccb', road: '#fffcf5', roadCase: '#ddd3c1', major: '#f7ecd6', majorCase: '#d9c9a8',
  path: '#b9a888', contour: '#8a7a5e', label: '#5a4c3d',
}

const style = await (await fetch(`https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=${publicToken}`)).json()
if (!style.layers) throw new Error(`couldn't fetch outdoors-v12: ${JSON.stringify(style)}`)

// 1. Everything not overridden below: pull colors toward the warm, muted palette (less saturation, a bit lighter)
const mute = (h, s, l, a = 1) => `hsla(${h}, ${Math.round(s * 0.45)}%, ${Math.min(96, Math.round(l * 0.85 + 12))}%, ${a})`
const recolor = (v) =>
  typeof v === 'string'
    ? v.replace(/hsla?\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%(?:,\s*([\d.]+))?\s*\)/g, (_, h, s, l, a) => mute(+h, +s, +l, a ?? 1))
    : Array.isArray(v) ? v.map(recolor) : v
for (const layer of style.layers) {
  for (const [k, v] of Object.entries(layer.paint ?? {})) if (/color/.test(k)) layer.paint[k] = recolor(v)
}

// 2. The layers that set the look
const byId = Object.fromEntries(style.layers.map((l) => [l.id, l]))
const paint = (id, props) => byId[id] && Object.assign((byId[id].paint ??= {}), props)
const hide = (...ids) => ids.forEach((id) => byId[id] && ((byId[id].layout ??= {}).visibility = 'none'))

paint('land', { 'background-color': C.land })
paint('landcover', {
  'fill-color': ['match', ['get', 'class'], 'wood', C.wood, 'scrub', C.grass, 'grass', C.grass, 'crop', C.grass, 'snow', C.paper, C.grass],
  'fill-opacity': 0.8,
})
paint('national-park', { 'fill-color': C.park })
paint('national-park_tint-band', { 'line-color': C.park })
paint('landuse', {
  'fill-color': ['match', ['get', 'class'],
    ['park', 'pitch', 'garden', 'playground', 'cemetery', 'golf_course', 'grass'], C.park,
    ['wood', 'scrub'], C.wood,
    'sand', '#ece0c4',
    C.land],
})
paint('pitch-outline', { 'line-color': '#c3d3ac' })
for (const id of ['water', 'water-shadow']) paint(id, { 'fill-color': C.water })
for (const id of ['waterway', 'waterway-shadow']) paint(id, { 'line-color': C.waterLine })
paint('water-depth', { 'fill-color': C.water })
paint('wetland', { 'fill-color': '#bcd6cf' })
paint('wetland-pattern', { 'fill-color': '#bcd6cf' })
paint('building', { 'fill-color': C.building, 'fill-outline-color': '#d6ccb8' })
paint('contour-line', { 'line-color': C.contour, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.12, 14, 0.26] })

// roads: cream with soft casings, majors a touch warmer, no blues/oranges
for (const l of style.layers) {
  const component = l.metadata?.['mapbox:featureComponent']
  if (component !== 'road-network' || l.type !== 'line') continue
  const major = /motorway|trunk|primary|major/.test(l.id)
  if (/case/.test(l.id)) paint(l.id, { 'line-color': major ? C.majorCase : C.roadCase })
  else if (!/rail|oneway/.test(l.id)) paint(l.id, { 'line-color': major ? C.major : C.road })
}
// walking paths: thin dashed bark lines (our trail overlay draws the named ones on top)
for (const l of style.layers) {
  if (l.metadata?.['mapbox:featureComponent'] !== 'walking-cycling' || l.type !== 'line') continue
  if (/-bg$|case/.test(l.id)) paint(l.id, { 'line-color': C.land, 'line-opacity': 0.6 })
  else if (/path|steps|pedestrian/.test(l.id)) paint(l.id, { 'line-color': C.path })
}

// labels in app colors on a paper halo
for (const l of style.layers) {
  if (l.type !== 'symbol' || !l.paint?.['text-color']) continue
  const component = l.metadata?.['mapbox:featureComponent']
  const color = component === 'natural-features' ? (/water/.test(l.id) ? '#4f8a90' : C.moss) : /settlement|state|country/.test(l.id) ? C.bark : C.label
  paint(l.id, { 'text-color': color, 'text-halo-color': C.paper, 'text-halo-width': 1.2 })
}
const layout = (id, props) => byId[id] && Object.assign((byId[id].layout ??= {}), props)

// points of interest: only parks, gardens and landmarks. Parks are the map's main labels: shown from further out
// (any filterrank ≤ 5, where Outdoors only lets the biggest through below z16), larger, forest green.
if (byId['poi-label']) {
  const park = ['==', ['get', 'class'], 'park_like']
  byId['poi-label'].filter = ['case', park, ['<=', ['get', 'filterrank'], 5],
    ['match', ['get', 'class'], ['landmark', 'historic'], byId['poi-label'].filter, false]]
  layout('poi-label', {
    'text-font': ['case', park, ['literal', ['DIN Pro Bold', 'Arial Unicode MS Bold']], ['literal', ['DIN Pro Medium', 'Arial Unicode MS Regular']]],
    // zoom has to be the top-level input; other POIs keep roughly Outdoors' sizes
    'text-size': ['interpolate', ['linear'], ['zoom'],
      11, ['case', park, 12, ['step', ['get', 'sizerank'], 18, 5, 12]],
      17, ['case', park, 16, ['step', ['get', 'sizerank'], 18, 13, 12]]],
  })
  paint('poi-label', {
    'text-color': ['case', park, C.forest, C.moss], 'icon-color': C.moss,
    'text-halo-color': C.paper, 'text-halo-width': 1.6, 'text-halo-blur': 0.5,
  })
}
// neighborhoods: bold spaced capitals, bigger and darker, more of them, until z16
if (byId['settlement-subdivision-label']) {
  const l = byId['settlement-subdivision-label']
  l.maxzoom = 16
  l.filter = l.filter.map((f) => (Array.isArray(f) && f[0] === '<=' ? ['<=', ['get', 'filterrank'], 5] : f))
  layout(l.id, {
    'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 11, 12, 15, 17],
    'text-letter-spacing': 0.18,
  })
  paint(l.id, { 'text-color': '#6b5842', 'text-halo-color': C.paper, 'text-halo-width': 2, 'text-halo-blur': 0.5 })
}
// no street names or highway shields: the map is about parks and trails, not driving (footpath names stay)
hide('road-label', 'road-number-shield', 'road-exit-shield')
hide('transit-label', 'airport-label', 'road-intersection', 'building-number-label', 'block-number-label', 'building-entrance',
  'ferry-aerialway-label', 'level-crossing', 'crosswalks', 'golf-hole-label', 'golf-hole-line')
for (const id of ['admin-0-boundary', 'admin-1-boundary', 'admin-0-boundary-disputed']) paint(id, { 'line-color': '#b3a58c' })
for (const id of ['admin-0-boundary-bg', 'admin-1-boundary-bg']) paint(id, { 'line-color': C.land })

style.name = 'Birdseye'
for (const k of ['owner', 'id', 'created', 'modified', 'protected', 'visibility', 'draft']) delete style[k]
writeFileSync(OUT, JSON.stringify(style))
console.log(`wrote ${OUT.pathname} (${Math.round(JSON.stringify(style).length / 1024)} KB, ${style.layers.length} layers)`)

if (process.argv.includes('--upload')) {
  const secret = process.env.MAPBOX_SECRET_TOKEN ?? envFile('.env.local').match(/MAPBOX_SECRET_TOKEN=\s*["']?([^\s"']+)/)?.[1]
  if (!secret) throw new Error('set MAPBOX_SECRET_TOKEN (a token with styles:write)')
  const url = `https://api.mapbox.com/styles/v1/${USERNAME}${STYLE_ID ? `/${STYLE_ID}` : ''}?access_token=${secret}`
  const res = await fetch(url, { method: STYLE_ID ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(style) })
  const body = await res.json()
  if (!res.ok) throw new Error(`upload failed ${res.status}: ${JSON.stringify(body).slice(0, 500)}`)
  console.log(`${STYLE_ID ? 'updated' : 'created'} style ${USERNAME}/${body.id}`)
}
