// Celebrates a level-up when the signed-in user's XP crosses a level boundary (after a quest claim, a hatch, or a
// finished walk once the profile reloads). Never fires on the first load.
import { useEffect, useRef, useState } from 'react'
import { levelInfo, type LevelInfo } from '../lib/levels'

const SHOW_MS = 4000

export function LevelUpToast({ xp }: { xp: number | undefined }) {
  const prev = useRef<LevelInfo | null>(null)
  const [shown, setShown] = useState<{ lvl: LevelInfo; newTitle: boolean } | null>(null)

  useEffect(() => {
    if (xp == null) return
    const lvl = levelInfo(xp)
    if (prev.current && lvl.level > prev.current.level) setShown({ lvl, newTitle: lvl.title !== prev.current.title })
    prev.current = lvl
  }, [xp])

  useEffect(() => {
    if (!shown) return
    const timer = window.setTimeout(() => setShown(null), SHOW_MS)
    return () => clearTimeout(timer)
  }, [shown])

  if (!shown) return null
  return (
    <button
      type="button"
      onClick={() => setShown(null)}
      className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[60] animate-big-egg-in rounded-3xl bg-forest px-5 py-4 text-center text-paper shadow-2xl"
    >
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-rare">Level up!</p>
      <p className="text-3xl font-extrabold">Level {shown.lvl.level}</p>
      <p className="mt-0.5 text-sm">
        {shown.newTitle ? (
          <>
            New title: <span className="font-bold text-rare">{shown.lvl.title}</span>
          </>
        ) : (
          shown.lvl.title
        )}
      </p>
    </button>
  )
}
