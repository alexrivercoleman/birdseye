// Recap map (§8 screen 5): route line + species pins colored by tier; ringed pin = photographed.
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useRef } from 'react'
import type { Recap } from '../api/types'
import { TIER_COLORS } from './TierBadge'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

export function RecapMap({ recap, onPinClick }: { recap: Recap; onPinClick: (speciesCode: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const route = recap.route ?? []
  const pins = recap.species.filter((s) => s.location)
  const clickRef = useRef(onPinClick)
  clickRef.current = onPinClick

  useEffect(() => {
    if (!token || !ref.current || (!route.length && !pins.length)) return
    mapboxgl.accessToken = token
    const coords: [number, number][] = [...route, ...pins.map((s) => [s.location!.lng, s.location!.lat] as [number, number])]
    const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]))
    const map = new mapboxgl.Map({
      container: ref.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      bounds,
      fitBoundsOptions: { padding: 40, maxZoom: 16 },
    })
    map.on('load', () => {
      if (route.length >= 2) addRoute()
      addPins()
    })
    const addRoute = () => {
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } },
      })
      map.addLayer({
        id: 'route', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1f3d2b', 'line-width': 4 },
      })
    }
    const addPins = () => {
      map.addSource('pins', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: pins.map((s) => ({
            type: 'Feature',
            properties: { code: s.species_code, tier: s.rarity_tier, photographed: s.photographed },
            geometry: { type: 'Point', coordinates: [s.location!.lng, s.location!.lat] },
          })),
        },
      })
      map.addLayer({
        id: 'pins', type: 'circle', source: 'pins',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'tier'], 'rare', TIER_COLORS.rare, 'uncommon', TIER_COLORS.uncommon, TIER_COLORS.common],
          'circle-stroke-color': ['case', ['get', 'photographed'], '#1f3d2b', '#ffffff'],
          'circle-stroke-width': ['case', ['get', 'photographed'], 3.5, 2],
        },
      })
      map.on('click', 'pins', (e) => {
        const code = e.features?.[0]?.properties?.code
        if (code) clickRef.current(code)
      })
      map.on('mouseenter', 'pins', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'pins', () => (map.getCanvas().style.cursor = ''))
    }
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recap.walk_id, route.length, pins.length])

  if (!token) return <div className="flex h-64 items-center justify-center bg-forest/10 text-sm">Set VITE_MAPBOX_TOKEN</div>
  if (!route.length && !pins.length) return null
  return <div ref={ref} className="h-72 w-full" />
}
