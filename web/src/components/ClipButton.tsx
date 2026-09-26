// Tap-to-play bird call clip. Only one clip plays at a time across the page.
import { useRef, useState, type MouseEvent } from 'react'

let nowPlaying: HTMLAudioElement | null = null

export function ClipButton({ url, label }: { url: string; label: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  // Cards are links to the full recap; playing a clip shouldn't navigate.
  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const a = audio.current
    if (!a) return
    if (!a.paused) {
      a.pause()
      return
    }
    if (nowPlaying && nowPlaying !== a) nowPlaying.pause()
    nowPlaying = a
    a.currentTime = 0
    void a.play()
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? 'Stop' : 'Play'} ${label} call`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest text-white transition active:scale-90"
      >
        {/* SVG, not ▶/■: iOS draws those characters as blue emoji */}
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          {playing ? <rect x="2" y="2" width="8" height="8" rx="1" /> : <path d="M3 1.5v9l7.5-4.5z" />}
        </svg>
      </button>
      <audio
        ref={audio}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  )
}
