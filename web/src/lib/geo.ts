// GPS track (§7.1): watchPosition with high accuracy, drop fixes worse than 50 m, buffer for 15 s batch posts.
import type { TrackPoint } from '../api/types'

const MAX_ACCURACY_M = 50
const MIN_STEP_M = 5 // ignore GPS jitter when summing the live distance

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type GeoStatus = 'waiting' | 'ok' | 'denied' | 'error'

export class GeoTracker {
  last: TrackPoint | null = null // last fix within MAX_ACCURACY_M
  lastAny: TrackPoint | null = null // last fix at any accuracy (photo pins indoors)
  distanceM = 0
  private buffer: TrackPoint[] = []
  private watchId: number | null = null
  private anchor: TrackPoint | null = null

  constructor(private onUpdate: (g: GeoTracker, status: GeoStatus) => void) {}

  start() {
    if (!('geolocation' in navigator)) return this.onUpdate(this, 'error')
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p: TrackPoint = {
          t: new Date(pos.timestamp).toISOString(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        }
        this.lastAny = p
        if (pos.coords.accuracy > MAX_ACCURACY_M) return this.onUpdate(this, this.last ? 'ok' : 'waiting')
        if (!this.anchor) this.anchor = p
        const step = haversineM(this.anchor, p)
        if (step >= MIN_STEP_M) {
          this.distanceM += step
          this.anchor = p
        }
        this.last = p
        this.buffer.push(p)
        this.onUpdate(this, 'ok')
      },
      (err) => this.onUpdate(this, err.code === err.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
  }

  flush(): TrackPoint[] {
    // Indoors (e.g. the live demo) every fix can be worse than 50 m. Until a good fix arrives, send the latest
    // coarse one so detections and the recap still get a location.
    if (!this.buffer.length && !this.last && this.lastAny) return [this.lastAny]
    const points = this.buffer
    this.buffer = []
    return points
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId)
    this.watchId = null
  }
}
