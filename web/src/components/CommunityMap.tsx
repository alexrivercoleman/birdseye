// §7.13 community map: everyone's detections by trail. Trails are colored and thickened by how many species were
// heard within 75 m of them; tapping one opens its top species. Also bounty circles, fuzzed anomaly circles, and a
// heatmap toggle. Data reloads for the visible area after every pan/zoom. Trails nobody has heard a bird on yet are
// thin and grey. Outside mock mode the sample trails (api/sampleMap) are drawn on top until real walks fill the map.
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import mapboxgl, { type ExpressionSpecification, type GeoJSONSource } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useRef, useState } from 'react'
import { api, USE_MOCKS } from '../api/client'
import { MAP_STYLE_URL } from '../lib/mapStyle'
import { withSamples } from '../api/sampleMap'
import type { CommunityMap as MapData, LatLng, TrailSpecies } from '../api/types'
import { TierBadge } from './TierBadge'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const START: [number, number] = [-84.3722, 33.7866] // Piedmont Park, for anyone who hasn't shared location
const MIN_ZOOM = 11 // further out, the bbox is too big to ask for
const RELOAD_MS = 350
const SHOW_SAMPLES = !USE_MOCKS && import.meta.env.VITE_MAP_SAMPLES !== 'false'

// trail color/width by species_total; 0 = nobody has heard anything there yet
const NONE = { color: '#8f9794', width: 2 }
const SCALE: [number, string, number][] = [
  [1, '#f2b632', 3],
  [8, '#e0662f', 4.5],
  [20, '#a4133c', 6.5],
]
const BOUNTY = '#e3a008'
const ANOMALY = '#7c3aed'

type Bounty = MapData['bounties'][number]
type Anomaly = MapData['anomalies'][number]
type Selection =
  | { kind: 'trail'; id: string; name: string | null; total: number }
  | { kind: 'bounty'; bounty: Bounty }
  | { kind: 'anomaly'; anomaly: Anomaly }

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

export default function CommunityMap() {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const data = useRef<MapData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'zoom' | 'error'>('loading')
  const [heatOn, setHeatOn] = useState(false)
  const [selected, setSelected] = useState<Selection | null>(null)

  useEffect(() => {
    if (!token || !container.current) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({ container: container.current, style: MAP_STYLE_URL, center: START, zoom: 13.5 })
    mapRef.current = map
    const geolocate = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      fitBoundsOptions: { maxZoom: 14.5 },
      showUserLocation: true,
    })
    map.addControl(geolocate, 'top-right')

    let seq = 0
    let timer: number
    const reload = () => {
      clearTimeout(timer)
      timer = window.setTimeout(async () => {
        if (map.getZoom() < MIN_ZOOM) return setStatus('zoom')
        const b = map.getBounds()!
        const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => +v.toFixed(4)) as [number, number, number, number]
        const mine = ++seq
        setStatus('loading')
        let d: MapData = { trails: [], bounties: [], anomalies: [], heat: [] }
        let failed = false
        try {
          d = await api.communityMap(bbox)
        } catch {
          failed = true
        }
        if (mine !== seq) return // a newer pan already asked
        if (SHOW_SAMPLES) d = withSamples(d) // even if the API failed, so the demo map is never empty
        else if (failed) return setStatus('error')
        data.current = d
        draw(map, d)
        setStatus(failed ? 'error' : 'ok')
      }, RELOAD_MS)
    }

    map.on('load', () => {
      addLayers(map)
      reload()
      // center on the user without a permission prompt if they've already allowed location
      navigator.permissions
        ?.query({ name: 'geolocation' })
        .then((p) => p.state === 'granted' && geolocate.trigger())
        .catch(() => {})
    })
    map.on('moveend', reload)
    map.on('click', (e) => {
      const d = data.current
      const hit = map.queryRenderedFeatures(e.point, { layers: ['anomaly-fill', 'bounty-fill', 'trail-hit'] })[0]
      if (!d || !hit) return setSelected(null)
      const i = hit.properties!.i as number
      if (hit.layer!.id === 'anomaly-fill') setSelected({ kind: 'anomaly', anomaly: d.anomalies[i] })
      else if (hit.layer!.id === 'bounty-fill') setSelected({ kind: 'bounty', bounty: d.bounties[i] })
      else setSelected({ kind: 'trail', id: d.trails[i].trail_id, name: d.trails[i].name, total: d.trails[i].species_total })
    })
    for (const layer of ['anomaly-fill', 'bounty-fill', 'trail-hit']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }
    return () => {
      clearTimeout(timer)
      map.remove()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer('heat')) map.setLayoutProperty('heat', 'visibility', heatOn ? 'visible' : 'none')
  }, [heatOn, status])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer('trail-selected'))
      map.setFilter('trail-selected', ['==', ['get', 'trail_id'], selected?.kind === 'trail' ? selected.id : ''])
  }, [selected, status])

  if (!token) return <div className="flex h-full items-center justify-center bg-forest/10 text-sm">Set VITE_MAPBOX_TOKEN</div>

  return (
    <div className="relative h-full w-full">
      {/* not absolute: mapbox-gl.css sets .mapboxgl-map { position: relative }, which would collapse it */}
      <div ref={container} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
        {status !== 'ok' && (
          <span className="rounded-full bg-paper/95 px-3 py-1 text-xs font-medium text-bark shadow">
            {status === 'loading' ? 'Loading trails…' : status === 'zoom' ? 'Zoom in to see trails' : SHOW_SAMPLES ? "Couldn't load live trails" : "Couldn't load the map"}
          </span>
        )}
      </div>

      <div className="absolute left-3 top-3 rounded-xl bg-paper px-3 py-2 text-[11px] text-bark shadow">
        <div className="font-semibold">Species heard</div>
        <div
          className="mt-1 h-1.5 w-24 rounded-full"
          style={{ background: `linear-gradient(to right, ${SCALE.map(([, c]) => c).join(', ')})` }}
        />
        <div className="mt-0.5 flex justify-between text-bark/60">
          <span>1</span>
          <span>20+</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-bark/60">
          <span className="h-0.5 w-4 rounded-full" style={{ background: NONE.color }} />
          none yet
        </div>
        <button
          onClick={() => setHeatOn((h) => !h)}
          className={`mt-2 w-full rounded-full px-2 py-1 font-semibold ${heatOn ? 'bg-forest text-paper' : 'bg-forest/10 text-forest'}`}
        >
          Heatmap {heatOn ? 'on' : 'off'}
        </button>
      </div>

      {selected && <Sheet selection={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function addLayers(map: mapboxgl.Map) {
  for (const id of ['heat', 'trails', 'bounties', 'anomalies']) map.addSource(id, { type: 'geojson', data: EMPTY })
  const total: ExpressionSpecification = ['get', 'species_total']
  map.addLayer({
    id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 1, 0.35, 6, 1],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 45],
      'heatmap-opacity': 0.75,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0,0,0,0)', 0.2, '#7fa37a', 0.45, '#f2b632', 0.7, '#e0662f', 1, '#a4133c',
      ],
    },
  })
  const none: ExpressionSpecification = ['==', total, 0]
  const width = [
    'case', none, NONE.width, ['interpolate', ['linear'], total, ...SCALE.flatMap(([n, , w]) => [n, w])],
  ] as ExpressionSpecification
  const sortByTotal = { 'line-sort-key': total, 'line-cap': 'round', 'line-join': 'round' } as const // birdiest on top
  map.addLayer({
    id: 'trail-casing', type: 'line', source: 'trails', layout: sortByTotal,
    paint: { 'line-color': '#ffffff', 'line-opacity': ['case', none, 0.6, 0.85], 'line-width': ['+', width, 3] },
  })
  map.addLayer({
    id: 'trail-selected', type: 'line', source: 'trails', filter: ['==', ['get', 'trail_id'], ''],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1f3d2b', 'line-width': ['+', width, 7] },
  })
  map.addLayer({
    id: 'trails', type: 'line', source: 'trails', layout: sortByTotal,
    paint: {
      'line-color': [
        'case', none, NONE.color, ['interpolate', ['linear'], total, ...SCALE.flatMap(([n, c]) => [n, c])],
      ] as ExpressionSpecification,
      'line-width': width,
    },
  })
  // wide invisible line so thin trails are easy to tap
  map.addLayer({ id: 'trail-hit', type: 'line', source: 'trails', paint: { 'line-width': 22, 'line-opacity': 0 } })
  for (const [id, color] of [['bounty', BOUNTY], ['anomaly', ANOMALY]] as const) {
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: `${id === 'bounty' ? 'bounties' : 'anomalies'}`, paint: { 'fill-color': color, 'fill-opacity': 0.18 } })
    map.addLayer({
      id: `${id}-line`, type: 'line', source: `${id === 'bounty' ? 'bounties' : 'anomalies'}`,
      paint: { 'line-color': color, 'line-width': 2, 'line-dasharray': [2, 1.5] },
    })
  }
}

function draw(map: mapboxgl.Map, d: MapData) {
  const set = (id: string, features: Feature[]) =>
    (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  set('trails', d.trails.map((t, i) => ({ type: 'Feature', properties: { i, trail_id: t.trail_id, species_total: t.species_total }, geometry: t.geometry })))
  set('heat', d.heat.map((h) => ({ type: 'Feature', properties: { weight: h.weight }, geometry: { type: 'Point', coordinates: [h.lng, h.lat] } })))
  set('bounties', d.bounties.map((b, i) => ({ type: 'Feature', properties: { i }, geometry: circle(b.center, b.radius_m) })))
  set('anomalies', d.anomalies.map((a, i) => ({ type: 'Feature', properties: { i }, geometry: circle(a.center, a.radius_m) })))
}

function circle({ lat, lng }: LatLng, radiusM: number, steps = 48): Polygon {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  const ring = Array.from({ length: steps + 1 }, (_, k) => {
    const a = (2 * Math.PI * k) / steps
    return [lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)]
  })
  return { type: 'Polygon', coordinates: [ring] }
}

function ago(iso: string): string {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000
  if (h < 1) return 'just now'
  if (h < 24) return `${Math.floor(h)}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function Sheet({ selection: sel, onClose }: { selection: Selection; onClose: () => void }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-3xl bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-bark shadow-[0_-8px_24px_rgb(0_0_0/0.15)]">
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-3 p-1 text-2xl leading-none text-bark/40">
        ×
      </button>
      {sel.kind === 'trail' ? (
        <TrailSheet id={sel.id} name={sel.name} total={sel.total} />
      ) : sel.kind === 'bounty' ? (
        <>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: BOUNTY }}>
            Bounty
          </p>
          <h3 className="mt-1 text-lg font-bold text-forest">{sel.bounty.common_name}</h3>
          <p className="mt-2 text-sm text-bark/80">
            {sel.bounty.claimed_by_me
              ? 'You already claimed this one.'
              : `Someone heard a ${sel.bounty.common_name} around here. Hear one on a walk inside the circle to claim the bounty.`}
          </p>
          <p className="mt-2 text-xs text-bark/50">
            Expires {new Date(sel.bounty.expires_at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: ANOMALY }}>
            Unusual sighting
          </p>
          <h3 className="mt-1 text-lg font-bold text-forest">{sel.anomaly.common_name}</h3>
          <p className="mt-2 text-sm text-bark/80">
            Heard {ago(sel.anomaly.detected_at)}
            {sel.anomaly.reason && `, ${sel.anomaly.reason}`}.{' '}
            {sel.anomaly.photo_confirmed ? '📷 Confirmed with a photo.' : 'Not confirmed with a photo yet.'}
          </p>
          <p className="mt-2 text-xs text-bark/50">Shown within about 300 m to protect the bird.</p>
        </>
      )}
    </div>
  )
}

function TrailSheet({ id, name, total }: { id: string; name: string | null; total: number }) {
  const [res, setRes] = useState<{ id: string; data: TrailSpecies | null; error?: boolean } | null>(null)

  useEffect(() => {
    if (!total) return // nothing to list
    let alive = true
    api
      .trailSpecies(id)
      .then((data) => alive && setRes({ id, data }))
      .catch(() => alive && setRes({ id, data: null, error: true }))
    return () => {
      alive = false
    }
  }, [id, total])

  const species = res?.id === id ? res.data?.top_species : undefined
  return (
    <>
      <h3 className="pr-8 text-lg font-bold text-forest">{name ?? 'Unnamed trail'}</h3>
      {!total ? (
        <p className="py-4 text-sm text-bark/70">Nobody has heard a bird here in the last 90 days. Walk it and be the first!</p>
      ) : (
        <p className="text-xs text-bark/60">{total} species heard in the last 90 days</p>
      )}
      {!total ? null : res?.id === id && res.error ? (
        <p className="py-6 text-center text-sm text-red-700">Couldn't load this trail's birds.</p>
      ) : !species ? (
        <p className="py-6 text-center text-sm text-bark/60">Loading…</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {species.map((s) => (
            <li key={s.species_code} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.common_name}</span>
                  <TierBadge tier={s.rarity_tier} />
                </div>
                {s.last_heard_at && <div className="text-xs text-bark/50">last heard {ago(s.last_heard_at)}</div>}
              </div>
              <div className="shrink-0 text-right text-xs tabular-nums text-bark/60">
                {s.walks} walk{s.walks === 1 ? '' : 's'}
                <br />
                {s.users} birder{s.users === 1 ? '' : 's'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
