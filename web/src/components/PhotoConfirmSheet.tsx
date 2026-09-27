// Photo identification progress. Polls GET /photos/{id} until identification finishes.
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PhotoDetail } from '../api/types'

export function PhotoConfirmSheet({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const [photo, setPhoto] = useState<PhotoDetail | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setPhoto(null)
    setError(false)
    let alive = true
    let timer: number
    const poll = async (tries: number) => {
      try {
        const p = await api.getPhoto(photoId)
        if (!alive) return
        // Also finish photos classified by older API versions that still ask for confirmation.
        if (p.status === 'needs_confirmation' && p.suggestions.length) {
          await api.confirmPhoto(photoId, p.suggestions[0].species_code)
          if (!alive) return
          p.species_code = p.suggestions[0].species_code
          p.status = 'confirmed'
        }
        setError(false)
        setPhoto(p)
        if (p.status === 'processing' && tries >= 40) setError(true)
        if (p.status === 'processing' && tries < 40) timer = window.setTimeout(() => poll(tries + 1), 1500)
      } catch {
        if (alive) setError(true)
        if (alive && tries < 40) timer = window.setTimeout(() => poll(tries + 1), 3000)
      }
    }
    void poll(0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [photoId])

  useEffect(() => {
    if (photo?.status === 'confirmed') onClose()
  }, [photo, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-bark"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-lg font-semibold">Photo identification</h3>
        {photo?.url && <img src={photo.url} alt="" className="mb-4 max-h-56 w-full rounded-2xl object-cover" />}
        {error && <p role="status" className="mb-3 text-sm text-red-700">Identification or saving is taking longer than expected. You can close this sheet; birds seen will update when available.</p>}
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
          <p className="py-6 text-center text-bark/60">Identification complete.</p>
        )}
      </div>
    </div>
  )
}
