// §8 screen 6 feed card: the walk recap in summary form (tapping it opens the full recap), then chirp + comments.
import { useState } from 'react'
import { Link } from 'react-router'
import type { RecapSummary, UserRef } from '../api/types'
import { formatDate, formatDistance, formatDuration, formatTime } from '../lib/format'
import { CommentSection } from './CommentSection'
import { LevelTag } from './LevelTag'
import { StaticRouteMap } from './StaticRouteMap'
import { TierBadge } from './TierBadge'

const MAX_SPECIES = 5

export function WalkCard({
  walk,
  highlight,
  onChirp,
  onCommentPosted,
}: {
  walk: RecapSummary
  highlight?: boolean
  onChirp: () => void
  onCommentPosted: (commentId: string) => void
}) {
  const [comments, setComments] = useState<'closed' | 'open' | 'typing'>('closed')
  const processing = walk.status !== 'complete'
  const pins = walk.species.flatMap((s) => (s.location ? [{ location: s.location, tier: s.rarity_tier, photographed: s.photographed }] : []))
  const photos = walk.photos.filter((p) => p.url).slice(0, 3)
  const hiddenSpecies = walk.species.length - MAX_SPECIES

  return (
    <article className={`overflow-hidden rounded-3xl bg-white shadow-sm ${highlight ? 'ring-2 ring-fern' : ''}`}>
      <Link to={`/u/${walk.user.username}`} className="flex items-center gap-3 px-4 pt-4 active:opacity-90">
        <Avatar user={walk.user} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{walk.user.display_name ?? walk.user.username}</span>
            <LevelTag xp={walk.user.xp} />
          </p>
          <p className="truncate text-xs text-bark/60">
            {formatDate(walk.started_at)} · {formatTime(walk.started_at)}
          </p>
        </div>
      </Link>
      <Link to={`/walks/${walk.walk_id}`} className="block pb-3 active:opacity-90">

        <h2 className="px-4 pt-3 text-lg font-bold text-forest">{walk.public_area_label ?? 'Walk'}</h2>

        <div className="grid grid-cols-4 gap-2 px-4 pt-2">
          <Stat label="Distance" value={formatDistance(walk.distance_m)} />
          <Stat label="Time" value={formatDuration(walk.duration_s)} />
          <Stat label="Species" value={String(walk.species_count)} />
          <Stat label="Points" value={String(walk.points)} accent />
        </div>

        {processing && (
          <p className="mx-4 mt-3 animate-pulse rounded-xl bg-fern/20 px-3 py-2 text-sm text-forest">
            Crunching this walk: rarity, points, recap…
          </p>
        )}

        <div className="mt-3">
          {walk.static_map_url ? (
            <img src={walk.static_map_url} alt="Walk route" className="block w-full" />
          ) : walk.precise && walk.route && walk.route.length > 1 ? (
            <StaticRouteMap route={walk.route} pins={pins} />
          ) : !walk.precise ? (
            <p className="px-4 text-xs text-bark/50">Exact route is visible to friends only.</p>
          ) : null}
        </div>

        {walk.species.length > 0 && (
          <ul className="space-y-1.5 px-4 pt-3">
            {walk.species.slice(0, MAX_SPECIES).map((s) => (
              <li key={s.species_code} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{s.common_name}</span>
                  <TierBadge tier={s.rarity_tier} />
                  {s.photographed && <span aria-label="photographed">📷</span>}
                </span>
                <span className={`shrink-0 font-semibold ${s.points ? 'text-forest' : 'text-bark/40'}`}>+{s.points}</span>
              </li>
            ))}
            {hiddenSpecies > 0 && (
              <li className="text-xs text-bark/50">
                +{hiddenSpecies} more species
              </li>
            )}
          </ul>
        )}
        {!walk.species.length && !processing && <p className="px-4 pt-3 text-sm text-bark/60">No birds identified.</p>}

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5 px-4 pt-3">
            {photos.map((p) => (
              <img key={p.photo_id} src={p.url!} alt="" className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        )}

        {walk.recap_text && <p className="line-clamp-3 px-4 pt-3 text-sm italic leading-relaxed text-bark/80">{walk.recap_text}</p>}
      </Link>

      <footer className="flex items-center gap-5 border-t border-bark/10 px-4 py-2.5 text-sm">
        <button
          type="button"
          onClick={onChirp}
          aria-pressed={walk.viewer_chirped}
          className={`flex items-center gap-1.5 font-semibold transition active:scale-110 ${walk.viewer_chirped ? 'text-forest' : 'text-bark/60'}`}
        >
          <span className={walk.viewer_chirped ? '' : 'opacity-50 grayscale'}>🐦</span>
          {walk.chirp_count} chirp{walk.chirp_count === 1 ? '' : 's'}
        </button>
        <button
          type="button"
          onClick={() => setComments(comments === 'closed' ? 'typing' : 'closed')}
          className="flex items-center gap-1.5 font-semibold text-bark/60"
        >
          💬 {walk.comment_count} comment{walk.comment_count === 1 ? '' : 's'}
        </button>
      </footer>

      {comments === 'closed' ? (
        <button
          type="button"
          onClick={() => setComments(walk.comment_count ? 'open' : 'typing')}
          className="block px-4 pb-3 text-left text-sm text-bark/50"
        >
          {walk.comment_count
            ? `View ${walk.comment_count === 1 ? 'comment' : `all ${walk.comment_count} comments`}`
            : 'Add a comment…'}
        </button>
      ) : (
        <CommentSection walkId={walk.walk_id} autoFocus={comments === 'typing'} onPosted={onCommentPosted} />
      )}
    </article>
  )
}

function Avatar({ user }: { user: UserRef }) {
  if (user.avatar_url) return <img src={user.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-moss font-bold text-paper">
      {(user.display_name ?? user.username).charAt(0).toUpperCase()}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-bark/50">{label}</div>
      <div className={`font-bold tabular-nums ${accent ? 'text-forest' : ''}`}>{value}</div>
    </div>
  )
}
