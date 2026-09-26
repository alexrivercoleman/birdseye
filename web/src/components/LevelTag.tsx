// Level + title pill shown next to a user's name (feed cards, comments, recap, profile, search).
import { levelInfo } from '../lib/levels'

export function LevelTag({ xp, className = '' }: { xp: number; className?: string }) {
  const { level, title, tone } = levelInfo(xp)
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide ${tone} ${className}`}
    >
      <span className="tabular-nums">Lv {level}</span>
      <span aria-hidden className="opacity-50">·</span>
      {title}
    </span>
  )
}
