// §8 screen 5: walk recap, and the summary End Walk lands on. Polls while the finish pipeline runs. The walker can
// share it as an Instagram story once it's complete.
import { useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { api } from '../api/client'
import type { Recap, RecapSpecies } from '../api/types'
import { RecapMap } from '../components/RecapMap'
import { ShareStorySheet } from '../components/ShareStorySheet'
import { TierBadge } from '../components/TierBadge'
import { useAuth } from '../lib/auth'
import { formatDate, formatDistance, formatDuration, formatTime } from '../lib/format'

export default function RecapScreen() {
  const { walkId } = useParams()
  const [recap, setRecap] = useState<Recap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const { profile } = useAuth()
  const justFinished = !!(useLocation().state as { justFinished?: boolean } | null)?.justFinished

  useEffect(() => {
    let alive = true
    let timer: number
    const load = async () => {
      try {
        const r = await api.getWalk(walkId!)
        if (!alive) return
        setRecap(r)
        setError(null)
        if (r.status !== 'complete') timer = window.setTimeout(load, 2000)
      } catch (e) {
        if (!alive) return
        setError(String(e))
        timer = window.setTimeout(load, 4000)
      }
    }
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [walkId])

  if (!recap) return <p className="p-6 text-bark/60">{error ?? 'Loading…'}</p>
  const processing = recap.status !== 'complete'
  const mine = !!profile && profile.id === recap.user.id

  return (
    <div className="pb-8">
      <header className="px-5 pb-4 pt-5">
        {justFinished && <p className="mb-1 text-sm font-bold uppercase tracking-wider text-moss">Walk complete</p>}
        <p className="text-sm text-bark/60">
          {recap.user.display_name ?? recap.user.username} · {formatDate(recap.started_at)} · {formatTime(recap.started_at)}
        </p>
        <h1 className="text-2xl font-bold text-forest">{recap.public_area_label ?? 'Walk recap'}</h1>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          <Stat label="Distance" value={formatDistance(recap.distance_m)} />
          <Stat label="Time" value={formatDuration(recap.duration_s)} />
          <Stat label="Species" value={String(recap.species_count)} />
          <Stat label="Points" value={String(recap.points)} highlight />
        </div>
        {mine && !processing && (
          <button
            onClick={() => setSharing(true)}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] py-3.5 font-bold text-white shadow-sm active:brightness-95"
          >
            Share to Instagram
          </button>
        )}
      </header>
      {sharing && <ShareStorySheet recap={recap} onClose={() => setSharing(false)} />}

      {processing && (
        <p className="mx-5 mb-4 animate-pulse rounded-xl bg-fern/20 px-4 py-3 text-sm text-forest">
          Crunching your walk: rarity, points, recap…
        </p>
      )}

      {recap.precise && (
        <RecapMap recap={recap} onPinClick={(code) => document.getElementById(`sp-${code}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
      )}

      {recap.recap_text && <p className="mx-5 mt-5 rounded-2xl bg-white p-4 italic leading-relaxed">{recap.recap_text}</p>}

      <section className="mt-5 px-5">
        <h2 className="mb-2 text-lg font-semibold">Species</h2>
        {!recap.species.length && !processing && <p className="text-bark/60">No birds identified on this walk.</p>}
        <ul className="space-y-2">
          {recap.species.map((s) => (
            <SpeciesRow key={s.species_code} s={s} />
          ))}
        </ul>
      </section>

      {recap.photos.length > 0 && (
        <section className="mt-6 px-5">
          <h2 className="mb-2 text-lg font-semibold">Photos</h2>
          <div className="grid grid-cols-3 gap-2">
            {recap.photos.map((p) =>
              p.url ? <img key={p.photo_id} src={p.url} alt="" className="aspect-square w-full rounded-xl object-cover" /> : null,
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function SpeciesRow({ s }: { s: RecapSpecies }) {
  return (
    <li id={`sp-${s.species_code}`} className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{s.common_name}</span>
            <TierBadge tier={s.rarity_tier} />
          </div>
          <p className="mt-0.5 text-xs text-bark/60">
            {s.heard && `🎧 heard ×${s.detection_count}`}
            {s.heard && s.photographed && ' · '}
            {s.photographed && '📷 photographed'}
            {s.best_confidence != null && ` · ${Math.round(s.best_confidence * 100)}%`}
            {s.first_detected_at && ` · ${formatTime(s.first_detected_at)}`}
            {s.is_anomaly && ' · unusual for here'}
          </p>
        </div>
        <span className={`shrink-0 font-bold ${s.points ? 'text-forest' : 'text-bark/40'}`}>+{s.points}</span>
      </div>
      {s.spectrogram_url && <img src={s.spectrogram_url} alt="" className="mt-3 w-full rounded-lg" />}
      {s.clip_url && <audio src={s.clip_url} controls className="mt-2 w-full" />}
      {s.photo_url && <img src={s.photo_url} alt="" className="mt-3 max-h-48 rounded-lg object-cover" />}
    </li>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl py-2 ${highlight ? 'bg-forest text-paper' : 'bg-white'}`}>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className={`text-[10px] uppercase tracking-wide ${highlight ? 'text-paper/70' : 'text-bark/50'}`}>{label}</div>
    </div>
  )
}
