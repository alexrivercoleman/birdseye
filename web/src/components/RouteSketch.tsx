// Route drawn as plain SVG for feed cards: a list of Mapbox maps would be far too heavy. Pins colored by tier.
import type { LatLng, Tier } from '../api/types'
import { TIER_COLORS } from './TierBadge'

const W = 320
const H = 150
const PAD = 14

export function RouteSketch({ route, pins }: { route: [number, number][]; pins: { location: LatLng; tier: Tier }[] }) {
  const all: [number, number][] = [...route, ...pins.map((p): [number, number] => [p.location.lng, p.location.lat])]
  const lats = all.map((p) => p[1])
  const kx = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180) // keep east-west distances true
  const xs = all.map((p) => p[0] * kx)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...lats), Math.max(...lats)]
  const scale = Math.min((W - 2 * PAD) / (maxX - minX || 1e-9), (H - 2 * PAD) / (maxY - minY || 1e-9))
  const ox = (W - (maxX - minX) * scale) / 2
  const oy = (H - (maxY - minY) * scale) / 2
  const project = ([lng, lat]: [number, number]) => [ox + (lng * kx - minX) * scale, oy + (maxY - lat) * scale]

  const line = route.map((p) => project(p).join(',')).join(' ')
  const start = route.length ? project(route[0]) : null
  const end = route.length > 1 ? project(route[route.length - 1]) : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full bg-fern/15" role="img" aria-label="Walk route">
      <polyline points={line} fill="none" stroke="#1f3d2b" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {start && <circle cx={start[0]} cy={start[1]} r={4.5} fill="#3f6b4a" stroke="white" strokeWidth={2} />}
      {end && <circle cx={end[0]} cy={end[1]} r={4.5} fill="#3b2f25" stroke="white" strokeWidth={2} />}
      {pins.map((p, i) => {
        const [x, y] = project([p.location.lng, p.location.lat])
        return <circle key={i} cx={x} cy={y} r={5} fill={TIER_COLORS[p.tier]} stroke="white" strokeWidth={1.5} />
      })}
    </svg>
  )
}
