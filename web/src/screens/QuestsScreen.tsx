// §8 screen 8, Pokémon GO field-research style: five monthly nests (one egg per week, laid by the week's first
// claimed quest) above the active quests. Completed quests are covered by a CLAIM REWARD button. Filling every
// nest brings up a big egg the user taps until it cracks open for a bonus.
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import type { NestStatus, UserQuest } from '../api/types'
import nestImg from '../assets/pixel/nest.png'
import eggImg from '../assets/pixel/egg.png'
import { useAuth } from '../lib/auth'

// egg-0 (whole) … egg-4 (badly cracked), egg-5 (breaking open); all the same canvas
const EGG_FRAMES = Object.entries(
  import.meta.glob<string>('../assets/pixel/egg-*.png', { eager: true, import: 'default' }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)
const PIXELATED = '[image-rendering:pixelated]'

const CLAIM_ANIM_MS = 550
const EGG_DROP_MS = 900 // let the last nest's egg land before the big egg appears
const HATCH_TAPS = 10
const CRACK_MS = 350 // how long the breaking-open frame shows before the egg disappears

const isFull = (n: NestStatus | null) => !!n && n.filled >= n.total && !n.hatched

export default function QuestsScreen() {
  const { reloadProfile } = useAuth() // claims and hatches add XP; a reload shows it (and any level-up)
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
      else void reloadProfile()
    } catch (e) {
      setError(`Couldn't claim: ${e}`)
    } finally {
      setClaiming(null)
    }
  }

  return (
    <div className="space-y-6 p-4 pb-8">
      <section className="px-1">
        <h2 className="font-bold text-forest">{month} nests</h2>
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
      </section>

      {hatchOpen && (
        <HatchOverlay
          onHatched={setNests}
          onClose={() => {
            setHatchOpen(false)
            void reloadProfile()
          }}
        />
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

// Nests zig-zag: even ones sit high, odd ones low, with the tracks walking diagonally between them.
const NEST_H_PX = 35 // w-11 nest box at 31:25
const TRACK_ANGLE_DEG = 50 // roughly the diagonal between neighbouring nests at phone widths

function NestRow({ total, filled, dropLast }: { total: number; filled: number; dropLast: boolean }) {
  return (
    <div className="my-3 flex h-20 items-stretch">
      {Array.from({ length: total }, (_, i) => (
        <Fragment key={i}>
          {/* tracks into nest i: faint once it's filled, walking toward it if it's the next one */}
          {i > 0 && <Tracks down={i % 2 === 1} mode={i < filled ? 'done' : i === filled ? 'walking' : 'none'} />}
          <div className={i % 2 ? 'self-end' : 'self-start'}>
            <Nest egg={i < filled} drop={dropLast && i === filled - 1} dim={i > filled} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function Tracks({ mode, down }: { mode: 'done' | 'walking' | 'none'; down: boolean }) {
  return (
    <div className="relative min-w-0 flex-1" aria-hidden>
      {mode !== 'none' &&
        [0.25, 0.5, 0.75].map((t, i) => (
          <Footprint
            key={t}
            className={mode === 'walking' ? 'animate-footstep text-moss' : 'text-bark/25'}
            delay={mode === 'walking' ? i * 0.35 : undefined}
            style={{
              // along the line from one nest's middle to the next one's, alternating feet either side of it
              left: `calc(${t * 100}% - 5px)`,
              top: `calc(${NEST_H_PX / 2}px + ${down ? t : 1 - t} * (100% - ${NEST_H_PX}px) - 4px)`,
              transform: `rotate(${down ? TRACK_ANGLE_DEG : -TRACK_ANGLE_DEG}deg) translateY(${i % 2 ? 2.5 : -2.5}px)`,
            }}
          />
        ))}
    </div>
  )
}

// A three-toed bird track pointing right (the direction of travel).
function Footprint({ className, delay, style }: { className: string; delay?: number; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 12 10"
      className={`absolute h-2 w-2.5 ${className}`}
      style={{ ...style, ...(delay != null ? { animationDelay: `${delay}s` } : {}) }}
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

// Restarted on every tap with the Web Animations API (remounting the egg to restart a CSS animation flickered).
const SHAKE_KEYFRAMES: Keyframe[] = [
  { transform: 'none' },
  { transform: 'translateX(-7px) rotate(-7deg)' },
  { transform: 'translateX(6px) rotate(6deg)' },
  { transform: 'translateX(-4px) rotate(-4deg)' },
  { transform: 'translateX(2px) rotate(2deg)' },
  { transform: 'none' },
]

// Every nest is full: a big egg over a white glow. Each tap shakes it and the cracks spread; the last tap breaks
// it open and pays the bonus.
function HatchOverlay({ onHatched, onClose }: { onHatched: (n: NestStatus) => void; onClose: () => void }) {
  const [taps, setTaps] = useState(0)
  const [shellGone, setShellGone] = useState(false)
  const [points, setPoints] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shakeRef = useRef<HTMLDivElement>(null)
  const cracked = taps >= HATCH_TAPS
  const frame = cracked ? (shellGone ? -1 : 5) : Math.min(4, Math.floor((taps * 5) / HATCH_TAPS))

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
    shakeRef.current?.animate(SHAKE_KEYFRAMES, { duration: 350, easing: 'ease-in-out' })
    setTaps(taps + 1)
    if (taps + 1 < HATCH_TAPS) return
    setTimeout(() => setShellGone(true), CRACK_MS)
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
          <p className="text-2xl font-extrabold">{points != null ? 'It hatched!' : 'Do you hear something...?'}</p>
          {points == null && (
            <p className="mt-1 text-sm font-semibold text-white/85">{cracked ? 'Cracking…' : 'Tap the egg to hatch it'}</p>
          )}
        </div>

        <button
          onClick={onTap}
          disabled={cracked}
          aria-label={cracked ? 'Egg cracked' : 'Tap to crack the egg'}
          className="relative animate-big-egg-in touch-manipulation select-none"
        >
          {/* every frame stays mounted and stacked, so swapping frames never shows an undecoded (blank) image */}
          <div ref={shakeRef} className={`grid origin-bottom ${taps === 0 ? 'animate-egg-wobble' : ''}`}>
            {EGG_FRAMES.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                draggable={false}
                className={`col-start-1 row-start-1 w-[209px] ${PIXELATED} drop-shadow-[0_6px_12px_rgb(0_0_0/0.35)] ${i === frame ? '' : 'invisible'}`}
              />
            ))}
          </div>
          {points != null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center animate-points-rise text-rare [text-shadow:0_0_2px_white,0_0_12px_white,0_3px_0_rgb(0_0_0/0.25)]">
              <div className="text-6xl font-black tabular-nums">{points}</div>
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
          ) : (
            points != null && (
              <button
                onClick={onClose}
                className="rounded-full bg-gradient-to-b from-rare to-[#e39a1c] px-8 py-3 font-extrabold tracking-wide text-white shadow-lg active:brightness-95"
              >
                COLLECT
              </button>
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
