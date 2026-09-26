// A static view of the route that matches RecapMap: the same fitBounds (padding 40, maxZoom 16), so a Mapbox Static
// Images basemap fetched for that exact center/zoom lines up with a route drawn on top. Used by the feed card map and
// the Instagram story card.
import { MAP_STYLE, MAP_STYLE_VERSION } from './mapStyle'

const TILE = 512 // Mapbox GL and the Static Images API both use 512px tiles, so zooms line up
const PADDING = 40
const MAX_ZOOM = 16

// Web Mercator in world units [0, 1]
const mercX = (lng: number) => (lng + 180) / 360
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}
const unmercY = (y: number) => (Math.atan(Math.sinh((1 - 2 * y) * Math.PI)) * 180) / Math.PI

export type MapView = { lng: number; lat: number; zoom: number; project: (c: [number, number]) => [number, number] }

/** Same result as mapboxgl fitBounds({ padding, maxZoom: 16 }) on a width × height map (CSS px). */
export function fitView(coords: [number, number][], width: number, height: number, padding = PADDING): MapView {
  const xs = coords.map(([lng]) => mercX(lng))
  const ys = coords.map(([, lat]) => mercY(lat))
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const fit = Math.min(
    Math.log2((width - 2 * padding) / (TILE * (maxX - minX || 1e-12))),
    Math.log2((height - 2 * padding) / (TILE * (maxY - minY || 1e-12))),
  )
  const zoom = Math.floor(Math.min(fit, MAX_ZOOM) * 100) / 100 // the API rounds zoom to 2 decimals; round down so it still fits
  const scale = TILE * 2 ** zoom
  return {
    lng: cx * 360 - 180,
    lat: unmercY(cy),
    zoom,
    project: ([lng, lat]) => [(mercX(lng) - cx) * scale + width / 2, (mercY(lat) - cy) * scale + height / 2],
  }
}

/** Mapbox Static Images basemap (no overlays) for a view, at 2× resolution; width/height ≤ 1280. */
export function staticMapUrl(view: MapView, width: number, height: number, token: string): string {
  return (
    `https://api.mapbox.com/styles/v1/${MAP_STYLE}/static/${view.lng.toFixed(6)},${view.lat.toFixed(6)},${view.zoom}` +
    `/${width}x${height}@2x?v=${MAP_STYLE_VERSION}&access_token=${token}`
  )
}
