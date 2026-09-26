// §8 screen 8, Pokémon GO field-research style: five monthly nests (one egg per week, laid by the week's first
// claimed quest) above the active quests. Completed quests are covered by a CLAIM REWARD button.
import { Fragment, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { NestStatus, UserQuest } from '../api/types'

const CLAIM_ANIM_MS = 550

export default function QuestsScreen() {
  const [quests, setQuests] = useState<UserQuest[] | null>(null)
  const [nests, setNests] = useState<NestStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [dropEgg, setDropEgg] = useState(false)
  const month = new Date().toLocaleDateString([], { month: 'long' })

  useEffect(() => {
    Promise.all([api.myQuests(), api.myNests()])
      .then(([q, n]) => {
        setQuests(q)
        setNests(n)
      })
      .catch((e) => setError(String(e)))
  }, [])

  async function onClaim(q: UserQuest) {
    if (claiming) return
    setClaiming(q.id)
    setError(null)
    try {
      const [res] = await Promise.all([api.claimQuest(q.id), new Promise((r) => setTimeout(r, CLAIM_ANIM_MS))])
      setQuests((qs) => qs?.filter((x) => x.id !== q.id) ?? null)
      setNests(res.nests)
      setDropEgg(res.egg_laid)
    } catch (e) {
      setError(`Couldn't claim: ${e}`)
    } finally {
      setClaiming(null)
    }
  }

  return (
    <div className="space-y-6 p-4 pb-8">
      <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-forest/10">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-forest">{month} nests</h2>
          {nests && (
            <span className="text-sm font-semibold tabular-nums text-bark/60">
              {nests.filled} / {nests.total}
            </span>
          )}
        </div>
        <NestRow total={nests?.total ?? 5} filled={nests?.filled ?? 0} dropLast={dropEgg} />
        {nests && (
          <p className="text-center text-xs text-bark/60">
            {nests.filled >= nests.total
              ? 'Every nest is full this month!'
              : nests.laid_this_week
                ? "This week's egg is laid. The next nest opens Monday."
                : 'Complete a quest this week to lay an egg.'}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 px-1 font-bold text-forest">Field research</h2>
        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!quests ? (
          !error && <p className="p-6 text-center text-sm text-bark/60">Loading…</p>
        ) : quests.length === 0 ? (
          <p className="rounded-2xl bg-white/60 p-6 text-center text-sm text-bark/60">
            All caught up. New quests arrive Monday.
          </p>
        ) : (
          <ul className="space-y-3">
            {quests.map((q) => (
              <QuestCard key={q.id} quest={q} claiming={claiming === q.id} onClaim={() => void onClaim(q)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const METERS_PER_MILE = 1609.344

function progressLabel(q: UserQuest): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  if (q.template === 'trail_distance')
    return `${fmt(Math.floor((q.progress / METERS_PER_MILE) * 10) / 10)} / ${fmt(Number(q.params.miles ?? q.target / METERS_PER_MILE))} mi`
  return `${q.progress} / ${q.target}`
}

function QuestCard({ quest: q, claiming, onClaim }: { quest: UserQuest; claiming: boolean; onClaim: () => void }) {
  return (
    <li
      className={`relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-forest/10 ${claiming ? 'animate-claim-out' : ''}`}
    >
      <div className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-forest">{q.title}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-forest/10">
            <div className="h-full rounded-full bg-moss" style={{ width: `${Math.min(1, q.progress / q.target) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs tabular-nums text-bark/60">{progressLabel(q)}</p>
        </div>
        <div className="shrink-0 rounded-xl bg-paper px-3 py-1.5 text-center">
          <div className="text-lg font-bold leading-tight tabular-nums text-forest">{q.reward_points}</div>
          <div className="text-[10px] font-semibold tracking-wider text-bark/50">XP</div>
        </div>
      </div>
      {q.completed_at && (
        <button
          onClick={onClaim}
          className="absolute inset-0 bg-gradient-to-b from-rare to-[#e39a1c] text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.25)] active:brightness-95"
        >
          <span className="pointer-events-none absolute inset-1.5 rounded-xl border-2 border-white/85" />
          <span className="text-xl font-extrabold tracking-wider">{claiming ? 'CLAIMED!' : 'CLAIM REWARD'}</span>
          <span className="absolute right-5 top-1/2 -translate-y-1/2 text-base font-extrabold tabular-nums">
            {claiming && '+'}
            {q.reward_points} XP
          </span>
        </button>
      )}
    </li>
  )
}

function NestRow({ total, filled, dropLast }: { total: number; filled: number; dropLast: boolean }) {
  return (
    <div className="my-4 flex items-center">
      {Array.from({ length: total }, (_, i) => (
        <Fragment key={i}>
          {/* tracks into nest i: faint once it's filled, walking toward it if it's the next one */}
          {i > 0 && <Tracks mode={i < filled ? 'done' : i === filled ? 'walking' : 'none'} />}
          <Nest egg={i < filled} drop={dropLast && i === filled - 1} dim={i > filled} />
        </Fragment>
      ))}
    </div>
  )
}

function Tracks({ mode }: { mode: 'done' | 'walking' | 'none' }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-evenly overflow-hidden" aria-hidden>
      {mode !== 'none' &&
        [0, 1, 2].map((i) => (
          <Footprint
            key={i}
            className={`${i % 2 ? 'translate-y-[3px]' : '-translate-y-[3px]'} ${
              mode === 'walking' ? 'animate-footstep text-moss' : 'text-bark/25'
            }`}
            delay={mode === 'walking' ? i * 0.35 : undefined}
          />
        ))}
    </div>
  )
}

// A three-toed bird track pointing right (the direction of travel).
function Footprint({ className, delay }: { className: string; delay?: number }) {
  return (
    <svg
      viewBox="0 0 12 10"
      className={`h-2 w-2.5 shrink-0 ${className}`}
      style={delay != null ? { animationDelay: `${delay}s` } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      <path d="M1 5h5M6 5h5M6 5l3-3.5M6 5l3 3.5" />
    </svg>
  )
}

function Nest({ egg, drop, dim }: { egg: boolean; drop: boolean; dim: boolean }) {
  return (
    <svg viewBox="0 0 56 40" className={`w-11 shrink-0 ${dim ? 'opacity-45' : ''}`} aria-label={egg ? 'Nest with egg' : 'Empty nest'}>
      <ellipse cx="28" cy="18" rx="24" ry="8" fill="#6b4f35" />
      <ellipse cx="28" cy="18.5" rx="19" ry="5.5" fill="#3b2a1d" />
      {egg && (
        <g className={drop ? 'animate-egg-drop' : ''} style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}>
          <path d="M28 4C33 4 36 11.5 36 17.5C36 23 32.5 27 28 27C23.5 27 20 23 20 17.5C20 11.5 23 4 28 4Z" fill="#a9d9d0" />
          <ellipse cx="25" cy="11" rx="2" ry="3.2" fill="#fff" opacity="0.55" transform="rotate(-18 25 11)" />
        </g>
      )}
      <path d="M4 18Q6 36 28 37Q50 36 52 18Q40 26 28 26Q16 26 4 18Z" fill="#8a6644" />
      <g fill="none" strokeLinecap="round" strokeWidth="1.4">
        <path d="M7 22Q20 30 36 28" stroke="#5a4330" />
        <path d="M14 30Q30 34 48 23" stroke="#5a4330" />
        <path d="M9 26Q24 29 45 27" stroke="#b08a5f" />
        <path d="M18 34Q32 31 42 33" stroke="#b08a5f" />
      </g>
    </svg>
  )
}
