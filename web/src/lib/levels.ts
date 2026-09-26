// XP → level + title. XP is profiles.xp: the lifetime sum of the user's points_ledger (see docs/CONTRACT_CHANGES.md).
// Reaching level L takes 50·L·(L−1) XP in total, so level L → L+1 costs 100·L: 100 XP for level 2, 4,500 for
// level 10, 19,000 for level 20, 122,500 for level 50 (the cap).

export const MAX_LEVEL = 50

export const xpForLevel = (level: number) => 50 * level * (level - 1)

// A new title every 5 levels. `tone` is the badge's Tailwind classes (full strings so Tailwind picks them up).
const TITLES: { from: number; title: string; tone: string }[] = [
  { from: 1, title: 'Hatchling', tone: 'bg-common/15 text-bark/70' },
  { from: 5, title: 'Nestling', tone: 'bg-common/15 text-bark/70' },
  { from: 10, title: 'Fledgling', tone: 'bg-fern/25 text-forest' },
  { from: 15, title: 'Songbird', tone: 'bg-fern/25 text-forest' },
  { from: 20, title: 'Field Birder', tone: 'bg-fern/25 text-forest' },
  { from: 25, title: 'Keen Ear', tone: 'bg-uncommon/15 text-uncommon' },
  { from: 30, title: 'Hawkeye', tone: 'bg-uncommon/15 text-uncommon' },
  { from: 35, title: 'Ornithologist', tone: 'bg-uncommon/15 text-uncommon' },
  { from: 40, title: 'Sky Sentinel', tone: 'bg-forest text-paper' },
  { from: 45, title: 'Raptor', tone: 'bg-forest text-paper' },
  { from: 50, title: 'Birdseye Legend', tone: 'bg-rare text-bark' },
]

export type LevelInfo = {
  level: number
  title: string
  tone: string
  xp: number
  xpIntoLevel: number // XP earned since reaching this level
  xpLevelSpan: number | null // XP from this level to the next; null at the cap
  progress: number // 0–1 toward the next level (1 at the cap)
}

export function levelInfo(xp: number): LevelInfo {
  xp = Number.isFinite(xp) ? Math.max(0, xp) : 0 // an older API build sends no xp
  let level = 1
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= xp) level++
  const { title, tone } = TITLES.filter((t) => t.from <= level).at(-1)!
  const xpIntoLevel = xp - xpForLevel(level)
  const xpLevelSpan = level < MAX_LEVEL ? xpForLevel(level + 1) - xpForLevel(level) : null
  return { level, title, tone, xp, xpIntoLevel, xpLevelSpan, progress: xpLevelSpan ? xpIntoLevel / xpLevelSpan : 1 }
}

/** The next title up from `level`, or null past the last one. */
export function nextTitle(level: number): { title: string; level: number } | null {
  const t = TITLES.find((t) => t.from > level)
  return t ? { title: t.title, level: t.from } : null
}
