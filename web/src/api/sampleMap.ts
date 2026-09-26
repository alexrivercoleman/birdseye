// Sample community-map usage: ~6 months of simulated Atlanta birding on real OSM trails (scripts/seed/sample_map.py
// writes public/sample-map.json). Mock mode serves it as the whole map; otherwise it's drawn over the API's trails so
// demos look lived-in (VITE_MAP_SAMPLES=false turns that off). trail_ids are "sample-<group id>", and their species
// sheets are answered here. Times are stored as days ago and dated at load, so the sample never goes stale.
import type { CommunityMap, LatLng, TrailSpecies } from './types'

type Trail = CommunityMap['trails'][number]
type SampleFile = {
  trails: (Trail & {
    top_species: (Omit<TrailSpecies['top_species'][number], 'last_heard_at'> & { last_heard_days_ago: number })[]
  })[]
  heat: CommunityMap['heat']
  anomalies: (Omit<CommunityMap['anomalies'][number], 'detected_at'> & { days_ago: number })[]
  bounties: (Omit<CommunityMap['bounties'][number], 'expires_at'> & { expires_in_days: number })[]
}
type Samples = { map: CommunityMap; boxes: Map<string, BBox>; species: Map<string, TrailSpecies> }
type BBox = [number, number, number, number] // minLng, minLat, maxLng, maxLat

const PREFIX = 'sample-'
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

let loading: Promise<Samples> | null = null
export function loadSamples(): Promise<Samples> {
  loading ??= fetch('/sample-map.json')
    .then((r) => {
      if (!r.ok) throw new Error(`sample-map.json → ${r.status}`)
      return r.json() as Promise<SampleFile>
    })
    .then((f) => ({
      map: {
        trails: f.trails.map(({ top_species: _, ...t }) => t),
        heat: f.heat,
        anomalies: f.anomalies.map(({ days_ago, ...a }) => ({ ...a, detected_at: daysAgo(days_ago + 0.3) })),
        bounties: f.bounties.map(({ expires_in_days, ...b }) => ({ ...b, expires_at: daysAgo(-expires_in_days) })),
      },
      boxes: new Map(f.trails.map((t) => [t.trail_id, bounds(t)])),
      species: new Map(
        f.trails.map((t) => [
          t.trail_id,
          {
            name: t.name,
            top_species: t.top_species.map(({ last_heard_days_ago, ...s }) => ({
              ...s,
              last_heard_at: daysAgo(last_heard_days_ago + 0.25),
            })),
          },
        ]),
      ),
    }))
  loading.catch(() => (loading = null)) // let the next pan retry
  return loading
}

export const isSampleTrail = (trailId: string) => trailId.startsWith(PREFIX)

export async function sampleTrailSpecies(trailId: string): Promise<TrailSpecies> {
  return (await loadSamples()).species.get(trailId) ?? { name: null, top_species: [] }
}

/** The part of the sample inside bbox, like GET /map/community would return it. */
export function samplesIn(s: Samples, bbox: BBox): CommunityMap {
  const [w, so, e, n] = bbox
  const inside = ({ lat, lng }: LatLng) => lng >= w && lng <= e && lat >= so && lat <= n
  const overlaps = ([a, b, c, d]: BBox) => a <= e && c >= w && b <= n && d >= so
  return {
    trails: s.map.trails.filter((t) => overlaps(s.boxes.get(t.trail_id)!)),
    heat: s.map.heat.filter(inside),
    anomalies: s.map.anomalies.filter((a) => inside(a.center)),
    bounties: s.map.bounties.filter((b) => inside(b.center)),
  }
}

/** API data plus the sample, where a sample trail replaces the API's copy of the same OSM trail group. */
export function withSamples(d: CommunityMap, sample: CommunityMap): CommunityMap {
  const sampled = new Set(sample.trails.map((t) => t.trail_id.slice(PREFIX.length)))
  return {
    trails: [...d.trails.filter((t) => !sampled.has(t.trail_id)), ...sample.trails],
    heat: [...d.heat, ...sample.heat],
    anomalies: [...d.anomalies, ...sample.anomalies],
    bounties: [...d.bounties, ...sample.bounties],
  }
}

function bounds(t: Trail): BBox {
  const pts = t.geometry.type === 'MultiLineString' ? t.geometry.coordinates.flat() : t.geometry.coordinates
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
