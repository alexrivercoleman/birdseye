// Preview of the walk's Instagram story card, then the OS share sheet (pick Instagram → Story). The card is drawn
// before the Share tap because Safari only allows navigator.share() straight from a tap. Where files can't be shared
// (desktop), it saves the image instead.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Recap } from '../api/types'
import { renderStoryCard } from '../lib/storyCard'

export function ShareStorySheet({ recap, onClose }: { recap: Recap; onClose: () => void }) {
  const [card, setCard] = useState<{ file: File; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let url = ''
    let alive = true
    renderStoryCard(recap)
      .then((file) => {
        url = URL.createObjectURL(file)
        if (alive) setCard({ file, url })
      })
      .catch((e) => alive && setError(`Couldn't make the story image: ${e instanceof Error ? e.message : e}`))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [recap])

  const canShare = !!card && !!navigator.canShare?.({ files: [card.file] })

  async function share() {
    if (!card) return
    if (!canShare) {
      const a = document.createElement('a')
      a.href = card.url
      a.download = card.file.name
      a.click()
      return
    }
    try {
      // files only: with a title or text, some iOS targets share the text instead of the image
      await navigator.share({ files: [card.file] })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(`Couldn't share: ${e}`)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label="Share to Instagram"
      className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-4 bg-black/90 px-6 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
      onClick={onClose}
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="aspect-[9/16] h-[min(62vh,560px)] overflow-hidden rounded-2xl bg-paper/10 shadow-2xl">
          {card ? (
            <img src={card.url} alt="Your walk as an Instagram story" className="size-full object-contain" />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-paper/70">
              {error ? '' : 'Making your story…'}
            </div>
          )}
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}
        <button
          onClick={() => void share()}
          disabled={!card}
          className="w-full rounded-2xl bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] py-4 text-lg font-bold text-white shadow-lg active:brightness-95 disabled:opacity-60"
        >
          {canShare || !card ? 'Share to Instagram' : 'Save image'}
        </button>
        <p className="text-center text-xs text-paper/70">
          {canShare || !card ? 'Pick Instagram, then Story.' : 'Then post it from Instagram on your phone.'}
        </p>
        <button onClick={onClose} className="text-sm font-semibold text-paper/80">
          Close
        </button>
      </div>
    </div>,
    document.body,
  )
}
