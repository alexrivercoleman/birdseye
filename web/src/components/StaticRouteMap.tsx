// Feed card map: looks exactly like RecapMap but isn't interactive (a list of live Mapbox GL maps would be far too
// heavy). We fit the view the way RecapMap's fitBounds does, fetch a bare Mapbox Static Images basemap for that
// exact center/zoom (lib/mapView), and draw the route and pins on top in SVG with RecapMap's styling. Stands in for the
// server-generated static map (§7 step 10). Falls back to the plain SVG sketch with no token or if the image fails.
import { useLayoutEffect, useRef, useState } from 'react'
import type { LatLng, Tier } from '../api/types'
import { fitView, staticMapUrl } from '../lib/mapView'
import { RouteSketch } from './RouteSketch'
import { TIER_COLORS } from './TierBadge'

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const HEIGHT = 288 // h-72, like RecapMap

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
  const view = width ? fitView([...route, ...pins.map((p): [number, number] => [p.location.lng, p.location.lat])], width, HEIGHT) : null

  return (
    <div ref={ref} className="relative h-72 w-full overflow-hidden bg-fern/15">
      {view && (
        <>
          <img
            src={staticMapUrl(view, width, HEIGHT, token)}
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
