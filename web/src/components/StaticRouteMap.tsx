// Feed card map: looks exactly like RecapMap but isn't interactive (a list of live Mapbox GL maps would be far too
// heavy). We fit the view the way RecapMap's fitBounds does, fetch a bare Mapbox Static Images basemap for that
// exact center/zoom, and draw the route and pins on top in SVG with RecapMap's styling. Stands in for the
// server-generated static map (§7 step 10). Falls back to the plain SVG sketch with no token or if the image fails.
import { useLayoutEffect, useRef, useState } from 'react'
import type { LatLng, Tier } from '../api/types'
import { MAP_STYLE } from '../lib/mapStyle'
import { RouteSketch } from './RouteSketch'
import { TIER_COLORS } from './TierBadge'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const HEIGHT = 288 // h-72; this and the rest match RecapMap
const PADDING = 40
const MAX_ZOOM = 16
const TILE = 512 // Mapbox GL and the Static Images API both use 512px tiles, so zooms line up

type Pin = { location: LatLng; tier: Tier; photographed?: boolean }

export function StaticRouteMap({ route, pins }: { route: [number, number][]; pins: Pin[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [failed, setFailed] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(1280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!token || failed) return <RouteSketch route={route} pins={pins} />
  const view = width ? fitView([...route, ...pins.map((p): [number, number] => [p.location.lng, p.location.lat])], width) : null

  return (
    <div ref={ref} className="relative h-72 w-full overflow-hidden bg-fern/15">
      {view && (
        <>
          <img
            src={`https://api.mapbox.com/styles/v1/${MAP_STYLE}/static/${view.lng.toFixed(6)},${view.lat.toFixed(6)},${view.zoom}/${width}x${HEIGHT}@2x?access_token=${token}`}
            alt="Walk route"
            loading="lazy"
            onError={() => setFailed(true)}
            className="absolute inset-0 size-full"
          />
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
            {route.length >= 2 && (
              <polyline
                points={route.map((c) => view.project(c).join(',')).join(' ')}
                fill="none"
                stroke="#1f3d2b"
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {pins.map((p, i) => {
              const [x, y] = view.project([p.location.lng, p.location.lat])
              // GL draws circle-stroke outside circle-radius; SVG centers the stroke on r
              const stroke = p.photographed ? 3.5 : 2
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={8 + stroke / 2}
                  fill={TIER_COLORS[p.tier]}
                  stroke={p.photographed ? '#1f3d2b' : '#ffffff'}
                  strokeWidth={stroke}
                />
              )
            })}
          </svg>
        </>
      )}
    </div>
  )
}

// Web Mercator in world units [0, 1]
const mercX = (lng: number) => (lng + 180) / 360
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}
const unmercY = (y: number) => (Math.atan(Math.sinh((1 - 2 * y) * Math.PI)) * 180) / Math.PI

// Same result as mapboxgl fitBounds({ padding: PADDING, maxZoom: MAX_ZOOM }) on a width × HEIGHT map.
function fitView(coords: [number, number][], width: number) {
  const xs = coords.map(([lng]) => mercX(lng))
  const ys = coords.map(([, lat]) => mercY(lat))
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const fit = Math.min(
    Math.log2((width - 2 * PADDING) / (TILE * (maxX - minX || 1e-12))),
    Math.log2((HEIGHT - 2 * PADDING) / (TILE * (maxY - minY || 1e-12))),
  )
  const zoom = Math.floor(Math.min(fit, MAX_ZOOM) * 100) / 100 // the API rounds zoom to 2 decimals; round down so it still fits
  const scale = TILE * 2 ** zoom
  return {
    lng: cx * 360 - 180,
    lat: unmercY(cy),
    zoom,
    project: ([lng, lat]: [number, number]) => [(mercX(lng) - cx) * scale + width / 2, (mercY(lat) - cy) * scale + HEIGHT / 2],
  }
}
