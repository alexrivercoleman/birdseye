// §8 screens 2–3: idle "Start Walk" and the active walk. §7.1 recording rules live in lib/recorder, lib/geo,
// lib/wakeLock and lib/uploadQueue. The active walk is persisted in localStorage so a reload can resume it.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, USE_MOCKS } from '../api/client'
import { PhotoConfirmSheet } from '../components/PhotoConfirmSheet'
import { downscaleImage, formatDistance, formatDuration } from '../lib/format'
import { GeoTracker, type GeoStatus } from '../lib/geo'
import { CHUNK_MS, ChunkRecorder, type MicStatus } from '../lib/recorder'
import { supabase } from '../lib/supabase'
import { drain, enqueue, onCounts, onPhotoUploaded } from '../lib/uploadQueue'
import { useWakeLock } from '../lib/wakeLock'

type ActiveWalk = { walkId: string; startedAt: string; nextChunk: number }
const KEY = 'birdseye.activeWalk'
const TRACK_FLUSH_MS = CHUNK_MS // so each chunk's detections have track points to interpolate between

const loadWalk = (): ActiveWalk | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}
const saveWalk = (w: ActiveWalk | null) => (w ? localStorage.setItem(KEY, JSON.stringify(w)) : localStorage.removeItem(KEY))

export default function WalkScreen() {
  const [walk, setWalk] = useState<ActiveWalk | null>(loadWalk)
  if (!walk) return <IdleWalk onStart={setWalk} />
  return <ActiveWalkView walk={walk} onDone={() => setWalk(null)} />
}

function IdleWalk({ onStart }: { onStart: (w: ActiveWalk) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const { walk_id } = await api.createWalk()
      const w = { walkId: walk_id, startedAt: new Date().toISOString(), nextChunk: 0 }
      saveWalk(w)
      onStart(w)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <button
        onClick={start}
        disabled={busy}
        className="flex h-52 w-52 items-center justify-center rounded-full bg-forest text-2xl font-bold text-paper shadow-xl active:scale-95 disabled:opacity-60"
      >
        {busy ? 'Starting…' : 'Start Walk'}
      </button>
      <p className="max-w-xs text-sm text-bark/70">
        Keep Birdseye open while you walk. iPhones pause the microphone when the screen locks or you switch apps.
      </p>
      {error && <p className="max-w-xs text-sm text-red-700">{error}</p>}
    </div>
  )
}

type LiveSpecies = { code: string; name: string; count: number; best: number; anomaly: boolean; lastAt: number }

function ActiveWalkView({ walk, onDone }: { walk: ActiveWalk; onDone: () => void }) {
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now())
  const [mic, setMic] = useState<MicStatus>('starting')
  const [gps, setGps] = useState<GeoStatus>('waiting')
  const [distance, setDistance] = useState(0)
  const [species, setSpecies] = useState<LiveSpecies[]>([])
  const [pending, setPending] = useState({ chunks: 0, photos: 0, total: 0 })
  const [ending, setEnding] = useState<string | null>(null)
  const [confirmPhotoId, setConfirmPhotoId] = useState<string | null>(null)
  const recorder = useRef<ChunkRecorder | null>(null)
  const tracker = useRef<GeoTracker | null>(null)
  const walkRef = useRef(walk)
  const localPhotos = useRef(new Set<string>())
  const wake = useWakeLock(!ending)

  // recording + GPS
  useEffect(() => {
    const t = new GeoTracker((g, status) => {
      setGps(status)
      setDistance(g.distanceM)
    })
    t.start()
    tracker.current = t
    const flushTrack = () => {
      const points = t.flush()
      if (points.length) void enqueue({ kind: 'track', walkId: walk.walkId, points })
    }
    const trackTimer = window.setInterval(flushTrack, TRACK_FLUSH_MS)

    const r = new ChunkRecorder(async (c) => {
      const w = walkRef.current
      const chunkIndex = w.nextChunk
      walkRef.current = { ...w, nextChunk: chunkIndex + 1 }
      saveWalk(walkRef.current)
      await enqueue({
        kind: 'chunk', walkId: w.walkId, data: await c.blob.arrayBuffer(), chunkIndex,
        startedAt: c.startedAt, durationS: c.durationS, mimeType: c.mimeType,
      })
    }, setMic)
    void r.start()
    recorder.current = r

    const onVisible = () => {
      if (document.visibilityState === 'visible') void r.resume()
      else flushTrack()
    }
    document.addEventListener('visibilitychange', onVisible)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(trackTimer)
      clearInterval(tick)
      t.stop()
      void r.stop()
    }
  }, [walk.walkId])

  // upload queue status + photo uploads → confirm sheet
  useEffect(() => onCounts((c) => setPending(c[walk.walkId] ?? { chunks: 0, photos: 0, total: 0 })), [walk.walkId])
  useEffect(
    () =>
      onPhotoUploaded((localId, photoId) => {
        if (localPhotos.current.delete(localId)) setConfirmPhotoId(photoId)
      }),
    [],
  )

  // live detections: realtime inserts, plus a slow poll in case the socket drops
  useEffect(() => {
    if (USE_MOCKS) return
    type Row = { species_code: string; common_name: string; confidence: number; is_anomaly: boolean; detected_at: string }
    const rows = new Map<string, Row>()
    const rebuild = (fresh: Set<string>) => {
      const by = new Map<string, LiveSpecies>()
      for (const r of rows.values()) {
        const s = by.get(r.species_code) ?? { code: r.species_code, name: r.common_name, count: 0, best: 0, anomaly: false, lastAt: 0 }
        s.count++
        s.best = Math.max(s.best, r.confidence)
        s.anomaly ||= r.is_anomaly
        s.lastAt = Math.max(s.lastAt, fresh.has(r.species_code) ? Date.now() : Date.parse(r.detected_at))
        by.set(r.species_code, s)
      }
      setSpecies([...by.values()].sort((a, b) => b.lastAt - a.lastAt))
    }
    let loaded = false
    const load = async () => {
      const { data } = await supabase
        .from('detections')
        .select('id, species_code, common_name, confidence, is_anomaly, detected_at')
        .eq('walk_id', walk.walkId)
      const fresh = new Set<string>() // pulse only birds that arrived since the last load, not on first load
      for (const d of data ?? []) {
        if (loaded && !rows.has(d.id)) fresh.add(d.species_code)
        rows.set(d.id, d)
      }
      loaded = true
      rebuild(fresh)
    }
    void load()
    const channel = supabase
      .channel(`walk-${walk.walkId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'detections', filter: `walk_id=eq.${walk.walkId}` },
        (payload) => {
          const d = payload.new as Row & { id: string }
          rows.set(d.id, d)
          rebuild(new Set([d.species_code]))
        },
      )
      .subscribe()
    const poll = window.setInterval(load, 20_000)
    return () => {
      clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [walk.walkId])

  async function takePhoto(file: File | undefined) {
    if (!file) return
    const fix = tracker.current?.last ?? tracker.current?.lastAny // indoors, any fix beats none
    if (!fix) return alert('Still waiting for a location fix. Try the photo again in a moment.')
    const localId = crypto.randomUUID()
    localPhotos.current.add(localId)
    const blob = await downscaleImage(file)
    await enqueue({
      kind: 'photo', walkId: walk.walkId, data: await blob.arrayBuffer(), mimeType: 'image/jpeg',
      capturedAt: new Date().toISOString(), lat: fix.lat, lng: fix.lng, localId,
    })
  }

  async function endWalk() {
    setEnding('Saving the last clip…')
    await recorder.current?.stop()
    const t = tracker.current
    if (t) {
      const points = t.flush()
      if (points.length) await enqueue({ kind: 'track', walkId: walk.walkId, points })
      t.stop()
    }
    await drain(walk.walkId, (n) => setEnding(n ? `Uploading ${n} item${n === 1 ? '' : 's'}…` : 'Finishing…'))
    try {
      await api.finishWalk(walk.walkId)
    } catch (e) {
      setEnding(`Couldn't finish: ${e}. Tap End Walk to retry.`)
      return
    }
    saveWalk(null)
    onDone()
    navigate('/feed', { state: { justFinished: walk.walkId } })
  }

  const elapsed = (now - Date.parse(walk.startedAt)) / 1000
  const micLabel: Record<MicStatus, string> = {
    starting: 'Mic starting…', recording: 'Listening', interrupted: 'Mic paused, tap to resume',
    denied: 'Mic blocked: allow it in Settings', error: 'Mic error, tap to retry', stopped: 'Mic off',
  }

  return (
    <div className="min-h-full bg-[#0f1f16] px-5 pb-8 pt-4 text-paper">
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          onClick={() => void recorder.current?.resume()}
          className={`rounded-full px-3 py-1 ${mic === 'recording' ? 'bg-fern/25 text-fern' : 'bg-red-500/25 text-red-200'}`}
        >
          {mic === 'recording' && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-fern" />}
          {micLabel[mic]}
        </button>
        <span className={`rounded-full px-3 py-1 ${gps === 'ok' ? 'bg-fern/25 text-fern' : 'bg-rare/25 text-rare'}`}>
          {gps === 'ok' ? 'GPS' : gps === 'waiting' ? 'Finding GPS…' : gps === 'denied' ? 'Location blocked' : 'GPS error'}
        </span>
        <span className={`rounded-full px-3 py-1 ${wake === 'on' ? 'bg-fern/25 text-fern' : 'bg-rare/25 text-rare'}`}>
          {wake === 'on' ? 'Screen stays on' : 'Screen may sleep: keep it awake'}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-3 text-center">
        <Stat label="Time" value={formatDuration(elapsed)} />
        <Stat label="Distance" value={formatDistance(distance)} />
        <Stat label="Species" value={String(species.length)} />
      </div>

      {pending.total > 3 && (
        <p className="mt-4 rounded-xl bg-rare/20 px-3 py-2 text-sm text-rare">
          Uploads backing up ({pending.chunks} clips, {pending.photos} photos). They'll send when signal returns.
        </p>
      )}

      <ul className="mt-6 space-y-2">
        {species.length === 0 && <li className="py-8 text-center text-paper/50">Listening for birds…</li>}
        {species.map((s) => (
          <li
            key={s.code}
            className={`flex items-center justify-between rounded-2xl px-4 py-3 ${
              now - s.lastAt < 4000 ? 'animate-pulse bg-fern/30' : 'bg-white/5'
            }`}
          >
            <span className="font-medium">
              {s.name}
              {s.anomaly && <span className="ml-2 rounded-full bg-rare px-2 py-0.5 text-[11px] font-semibold text-bark">RARE?</span>}
            </span>
            <span className="text-sm text-paper/60">
              ×{s.count} · {Math.round(s.best * 100)}%
            </span>
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] flex gap-3 px-5 pb-3">
        <label className="flex flex-1 cursor-pointer items-center justify-center rounded-2xl bg-white/10 py-4 font-semibold">
          📷 Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void takePhoto(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <button
          onClick={endWalk}
          disabled={!!ending && !ending.startsWith("Couldn't")}
          className="flex-[2] rounded-2xl bg-red-600 py-4 font-semibold disabled:opacity-70"
        >
          {ending ?? 'End Walk'}
        </button>
      </div>

      {confirmPhotoId && <PhotoConfirmSheet photoId={confirmPhotoId} onClose={() => setConfirmPhotoId(null)} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-paper/50">{label}</div>
    </div>
  )
}
