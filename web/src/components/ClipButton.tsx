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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fern text-[11px] text-white transition active:scale-90"
      >
        {playing ? '■' : '▶'}
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
