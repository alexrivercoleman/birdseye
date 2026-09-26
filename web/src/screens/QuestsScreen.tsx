// §8 screen 8, Pokémon GO field-research style: five monthly nests (one egg per week, laid by the week's first
// claimed quest) above the active quests. Completed quests are covered by a CLAIM REWARD button. Filling every
// nest brings up a big egg the user taps until it cracks open for a bonus.
import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import type { NestStatus, UserQuest } from '../api/types'
import nestImg from '../assets/pixel/nest.png'
import eggImg from '../assets/pixel/egg.png'

// egg-0 (whole) … egg-4 (badly cracked), egg-5 (top flying off), egg-6 (empty bottom shell); all the same canvas
const EGG_FRAMES = Object.entries(
  import.meta.glob<string>('../assets/pixel/egg-*.png', { eager: true, import: 'default' }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)
const PIXELATED = '[image-rendering:pixelated]'

const CLAIM_ANIM_MS = 550
const EGG_DROP_MS = 900 // let the last nest's egg land before the big egg appears
const HATCH_TAPS = 10
const CRACK_MS = 350 // top of the shell flies off, then the empty bottom shell

const isFull = (n: NestStatus | null) => !!n && n.filled >= n.total && !n.hatched

export default function QuestsScreen() {
  const [quests, setQuests] = useState<UserQuest[] | null>(null)
  const [nests, setNests] = useState<NestStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [dropEgg, setDropEgg] = useState(false)
  const [hatchOpen, setHatchOpen] = useState(false)
  const month = new Date().toLocaleDateString([], { month: 'long' })

  useEffect(() => {
    Promise.all([api.myQuests(), api.myNests()])
      .then(([q, n]) => {
        setQuests(q)
        setNests(n)
        setHatchOpen(isFull(n))
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
      if (res.egg_laid && isFull(res.nests)) setTimeout(() => setHatchOpen(true), EGG_DROP_MS)
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
            {nests.hatched
              ? "Every nest is full, and you hatched this month's big egg!"
              : nests.filled >= nests.total
                ? 'Every nest is full this month!'
                : nests.laid_this_week
                  ? "This week's egg is laid. The next nest opens Monday."
                  : 'Complete a quest this week to lay an egg.'}
          </p>
        )}
        {isFull(nests) && !hatchOpen && (
          <button
            onClick={() => setHatchOpen(true)}
            className="mx-auto mt-3 block rounded-full bg-gradient-to-b from-rare to-[#e39a1c] px-5 py-2 text-sm font-extrabold tracking-wide text-white shadow-sm active:brightness-95"
          >
            HATCH THE BIG EGG
          </button>
        )}
      </section>

      {hatchOpen && (
        <HatchOverlay onHatched={setNests} onClose={() => setHatchOpen(false)} />
      )}

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

// Pixel-art nest (31×13 px) with the egg (17×20 px) sunk into it: the whole nest, then the egg, then the nest's
// front rim (rows 5+) drawn again over the egg's base. Box is 31×25 px, nest along the bottom.
function Nest({ egg, drop, dim }: { egg: boolean; drop: boolean; dim: boolean }) {
  const nest = `absolute inset-x-0 bottom-0 h-[52%] w-full ${PIXELATED}`
  return (
    <div
      role="img"
      aria-label={egg ? 'Nest with egg' : 'Empty nest'}
      className={`relative aspect-[31/25] w-11 shrink-0 ${dim ? 'opacity-45' : ''}`}
    >
      <img src={nestImg} alt="" className={nest} />
      {egg && (
        <img
          src={eggImg}
          alt=""
          className={`absolute left-[22.58%] top-0 h-[80%] w-[54.84%] origin-bottom ${PIXELATED} ${drop ? 'animate-egg-drop' : ''}`}
        />
      )}
      <img src={nestImg} alt="" className={`${nest} [clip-path:inset(38.46%_0_0_0)]`} />
    </div>
  )
}

// Every nest is full: a big egg over a white glow. Each tap shakes it and the cracks spread; the last tap breaks
// it open and pays the bonus.
function HatchOverlay({ onHatched, onClose }: { onHatched: (n: NestStatus) => void; onClose: () => void }) {
  const [taps, setTaps] = useState(0)
  const [opened, setOpened] = useState(false)
  const [points, setPoints] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cracked = taps >= HATCH_TAPS
  const frame = cracked ? (opened ? 6 : 5) : Math.min(4, Math.floor((taps * 5) / HATCH_TAPS))

  async function hatch() {
    setError(null)
    try {
      const [res] = await Promise.all([api.hatchNest(), new Promise((r) => setTimeout(r, CRACK_MS * 2))])
      setPoints(res.points_awarded)
      onHatched(res.nests)
    } catch (e) {
      setError(`Couldn't hatch: ${e}`)
    }
  }

  function onTap() {
    if (cracked) return
    setTaps(taps + 1)
    if (taps + 1 < HATCH_TAPS) return
    setTimeout(() => setOpened(true), CRACK_MS)
    void hatch()
  }

  return createPortal(
    <div role="dialog" aria-modal aria-label="Big egg" className="fixed inset-0 z-50 animate-fade-in overflow-hidden bg-black/75">
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
        <div className="size-[150vmax] animate-rays-spin opacity-35 [background:repeating-conic-gradient(white_0deg_7deg,transparent_7deg_22.5deg)] [mask-image:radial-gradient(circle,black_8%,transparent_40%)]" />
      </div>
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
        <div className="size-96 animate-glow-pulse rounded-full [background:radial-gradient(circle,white_0%,rgb(255_255_255/0.75)_30%,rgb(255_255_255/0.2)_55%,transparent_70%)]" />
      </div>
      {cracked && <div className="pointer-events-none absolute inset-0 animate-flash bg-white" aria-hidden />}

      <div className="relative flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="text-white [text-shadow:0_2px_6px_rgb(0_0_0/0.6)]">
          <p className="text-2xl font-extrabold">{points != null ? 'It hatched!' : 'Every nest is full!'}</p>
          <p className="mt-1 text-sm font-semibold text-white/85">
            {points != null ? 'Bonus points for filling every nest' : cracked ? 'Cracking…' : 'Tap the egg to hatch it'}
          </p>
        </div>

        <button
          onClick={onTap}
          disabled={cracked}
          aria-label={cracked ? 'Egg cracked' : 'Tap to crack the egg'}
          className="relative animate-big-egg-in touch-manipulation select-none"
        >
          <div key={taps} className={`origin-bottom ${taps === 0 ? 'animate-egg-wobble' : cracked ? '' : 'animate-egg-shake'}`}>
            <img
              src={EGG_FRAMES[frame]}
              alt=""
              draggable={false}
              className={`w-[209px] ${PIXELATED} drop-shadow-[0_6px_12px_rgb(0_0_0/0.35)]`}
            />
          </div>
          {points != null && (
            <div className="absolute inset-x-0 top-[12%] animate-points-rise text-rare [text-shadow:0_0_2px_white,0_0_12px_white,0_3px_0_rgb(0_0_0/0.25)]">
              <div className="text-6xl font-black tabular-nums">+{points}</div>
              <div className="text-lg font-extrabold tracking-widest">XP</div>
            </div>
          )}
        </button>

        <div className="min-h-12">
          {error ? (
            <div className="space-y-2">
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              <div className="flex justify-center gap-6 text-sm font-bold text-white">
                <button onClick={() => void hatch()} className="underline">
                  Try again
                </button>
                <button onClick={onClose} className="text-white/70">
                  Close
                </button>
              </div>
            </div>
          ) : points != null ? (
            <button
              onClick={onClose}
              className="rounded-full bg-gradient-to-b from-rare to-[#e39a1c] px-8 py-3 font-extrabold tracking-wide text-white shadow-lg active:brightness-95"
            >
              COLLECT
            </button>
          ) : (
            !cracked && (
              <button onClick={onClose} className="text-sm font-semibold text-white/70">
                Later
              </button>
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
