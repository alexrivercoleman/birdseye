// Share a walk to an Instagram story, two ways:
// - Story card: a full 1080×1920 image through the OS share sheet (pick Instagram → Story). Where files can't be
//   shared (desktop), it saves the image instead.
// - Sticker: a Strava-style transparent PNG copied to the clipboard, to paste onto a story photo as a movable sticker.
// Both images are drawn as soon as the sheet opens, because Safari only allows sharing/copying straight from a tap.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Recap } from '../api/types'
import { renderSticker, renderStoryCard } from '../lib/storyCard'

type Mode = 'card' | 'sticker'
type Image = { file: File; url: string }

export function ShareStorySheet({ recap, onClose }: { recap: Recap; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('card')
  const [card, setCard] = useState<Image | null>(null)
  const [sticker, setSticker] = useState<Image | null>(null)
  const [stickerBlob] = useState(() => renderSticker(recap)) // started now; the copy tap hands this promise over
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const urls: string[] = []
    let alive = true
    const fail = (e: unknown) => alive && setError(`Couldn't make the image: ${e instanceof Error ? e.message : e}`)
    const keep = (file: File, set: (i: Image) => void) => {
      const url = URL.createObjectURL(file)
      urls.push(url)
      if (alive) set({ file, url })
    }
    renderStoryCard(recap).then((f) => keep(f, setCard), fail)
    stickerBlob.then((b) => keep(new File([b], `birdseye-sticker-${recap.started_at.slice(0, 10)}.png`, { type: 'image/png' }), setSticker), fail)
    return () => {
      alive = false
      urls.forEach(URL.revokeObjectURL)
    }
  }, [recap, stickerBlob])

  const shown = mode === 'card' ? card : sticker
  const canShareCard = !!card && !!navigator.canShare?.({ files: [card.file] })
  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write

  async function shareOrSave(img: Image) {
    if (!navigator.canShare?.({ files: [img.file] })) {
      const a = document.createElement('a')
      a.href = img.url
      a.download = img.file.name
      a.click()
      return
    }
    try {
      // files only: with a title or text, some iOS targets share the text instead of the image
      await navigator.share({ files: [img.file] })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(`Couldn't share: ${e}`)
    }
  }

  async function copySticker() {
    setError(null)
    try {
      // the ClipboardItem must be created in the tap itself; Safari accepts a promise for the image
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': stickerBlob })])
      setCopied(true)
    } catch (e) {
      if (sticker) await shareOrSave(sticker) // no image clipboard here: share or save the PNG instead
      else setError(`Couldn't copy: ${e}`)
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
        <div className="grid w-full grid-cols-2 rounded-full bg-white/10 p-1 text-sm font-semibold">
          {(['card', 'sticker'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setCopied(false)
              }}
              className={`rounded-full py-2 ${mode === m ? 'bg-paper text-forest' : 'text-paper/70'}`}
            >
              {m === 'card' ? 'Story card' : 'Sticker'}
            </button>
          ))}
        </div>

        <div
          className={`aspect-[9/16] h-[min(58vh,540px)] overflow-hidden rounded-2xl shadow-2xl ${
            // the sticker is transparent white-on-nothing: preview it over a photo-like backdrop
            mode === 'sticker' ? 'bg-gradient-to-b from-[#6f8fa8] via-[#8aa27c] to-[#4f6b3f]' : 'bg-paper/10'
          }`}
        >
          {shown ? (
            <img
              src={shown.url}
              alt={mode === 'card' ? 'Your walk as an Instagram story' : 'Your walk as a transparent sticker'}
              className={`size-full ${mode === 'card' ? 'object-contain' : 'object-contain p-5'}`}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-paper/70">{error ? '' : 'Drawing…'}</div>
          )}
        </div>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

        {mode === 'card' ? (
          <>
            <button
              onClick={() => card && void shareOrSave(card)}
              disabled={!card}
              className="w-full rounded-2xl bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] py-4 text-lg font-bold text-white shadow-lg active:brightness-95 disabled:opacity-60"
            >
              {canShareCard || !card ? 'Share to Instagram' : 'Save image'}
            </button>
            <p className="text-center text-xs text-paper/70">
              {canShareCard || !card ? 'Pick Instagram, then Story.' : 'Then post it from Instagram on your phone.'}
            </p>
          </>
        ) : (
          <>
            <button
              onClick={() => void (canCopy ? copySticker() : sticker && shareOrSave(sticker))}
              className="w-full rounded-2xl bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] py-4 text-lg font-bold text-white shadow-lg active:brightness-95"
            >
              {copied ? 'Copied!' : canCopy ? 'Copy sticker' : 'Save sticker'}
            </button>
            <p className="text-center text-xs text-paper/70">
              {copied
                ? 'Open Instagram, add a photo to your story, then tap Aa and paste.'
                : 'Paste it onto your own story photo.'}
            </p>
          </>
        )}
        <button onClick={onClose} className="text-sm font-semibold text-paper/80">
          Close
        </button>
      </div>
    </div>,
    document.body,
  )
}
