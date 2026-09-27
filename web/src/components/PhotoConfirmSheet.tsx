// §8 screen 4: photo + suggestion chips. Polls GET /photos/{id} until identification finishes.
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PhotoDetail } from '../api/types'

export function PhotoConfirmSheet({ photoId, onClose, onConfirmed }: {
  photoId: string
  onClose: () => void
  onConfirmed?: (photo: PhotoDetail) => void
}) {
  const [photo, setPhoto] = useState<PhotoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: number
    const poll = async (tries: number) => {
      try {
        const p = await api.getPhoto(photoId)
        if (!alive) return
        setPhoto(p)
        if (p.status === 'processing' && tries < 40) timer = window.setTimeout(() => poll(tries + 1), 1500)
      } catch {
        if (alive && tries < 40) timer = window.setTimeout(() => poll(tries + 1), 3000)
      }
    }
    void poll(0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [photoId])

  async function choose(code: string | null) {
    setBusy(true)
    setError(null)
    try {
      await api.confirmPhoto(photoId, code)
      if (photo) onConfirmed?.({ ...photo, species_code: code, status: code ? 'confirmed' : 'unidentified' })
      onClose()
    } catch {
      setError("Couldn’t save this sighting. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-bark"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-lg font-semibold">Photo identification</h3>
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        {photo?.url && <img src={photo.url} alt="" className="mb-4 max-h-56 w-full rounded-2xl object-cover" />}
        {!photo || photo.status === 'processing' ? (
          <p className="py-6 text-center text-bark/60">Identifying the bird in your photo…</p>
        ) : photo.suggestions.length === 0 ? (
          <div className="space-y-3">
            <p className="text-bark/70">We couldn’t identify a bird from this photo. You can close this and try another photo.</p>
            <button onClick={onClose} className="rounded-full border border-bark/30 px-4 py-3 text-base font-medium">
              Close
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <p className="w-full text-sm text-bark/60">Suggested matches for your photo</p>
            {photo.suggestions.map((s) => (
              <button
                key={s.species_code}
                disabled={busy}
                onClick={() => choose(s.species_code)}
                className="rounded-full bg-forest px-4 py-3 text-base font-medium text-paper"
              >
                {s.common_name}
                {s.confidence != null && <span className="ml-1 opacity-60">{Math.round(s.confidence * 100)}%</span>}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => choose(null)}
              className="rounded-full border border-bark/30 px-4 py-3 text-base font-medium"
            >
              Not sure
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
