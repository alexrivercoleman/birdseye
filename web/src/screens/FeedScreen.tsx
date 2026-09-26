// §8 screen 6: feed of every user's walks, newest first (see docs/CONTRACT_CHANGES.md). After End Walk the
// walk screen lands here with { justFinished: walkId }; that card is highlighted and, like any of the viewer's
// walks still processing, re-fetched until the finish pipeline completes. Chirp and comment counts update live.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { api } from '../api/client'
import type { RecapSummary } from '../api/types'
import { WalkCard } from '../components/WalkCard'
import { useAuth } from '../lib/auth'
import { setChirp, subscribeFeedSocial } from '../lib/social'

const POLL_MS = 2500

export default function FeedScreen() {
  const justFinished = (useLocation().state as { justFinished?: string } | null)?.justFinished
  const me = useAuth().profile?.id
  const [items, setItems] = useState<RecapSummary[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const countedComments = useRef(new Set<string>())

  // Idempotent, so the realtime echo of the viewer's own optimistic chirp doesn't count twice.
  const applyChirp = useCallback(
    (walkId: string, userId: string, on: boolean) =>
      setItems((cur) =>
        cur &&
        cur.map((w) => {
          if (w.walk_id !== walkId || (userId === me && w.viewer_chirped === on)) return w
          const chirp_count = Math.max(0, w.chirp_count + (on ? 1 : -1))
          return userId === me ? { ...w, chirp_count, viewer_chirped: on } : { ...w, chirp_count }
        }),
      ),
    [me],
  )

  // Called from realtime and from the viewer's own post; each comment id counts once.
  const countComment = useCallback((walkId: string, commentId: string) => {
    if (countedComments.current.has(commentId)) return
    countedComments.current.add(commentId)
    setItems((cur) => cur && cur.map((w) => (w.walk_id === walkId ? { ...w, comment_count: w.comment_count + 1 } : w)))
  }, [])

  useEffect(() => subscribeFeedSocial({ chirp: applyChirp, comment: countComment }), [applyChirp, countComment])

  function toggleChirp(w: RecapSummary) {
    if (!me) return
    const on = !w.viewer_chirped
    applyChirp(w.walk_id, me, on)
    setChirp(w.walk_id, me, on).catch((e) => {
      applyChirp(w.walk_id, me, !on)
      setError(String(e))
    })
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const page = await api.feed()
        let list = page.items
        if (justFinished && !list.some((w) => w.walk_id === justFinished)) {
          const mine = await api.getWalk(justFinished).catch(() => null)
          if (mine) list = [mine, ...list]
        }
        if (!alive) return
        setItems(list)
        setCursor(page.next_cursor)
        setError(null)
      } catch (e) {
        if (alive) setError(String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [justFinished, reload])

  useEffect(() => {
    const pending = items?.filter((w) => w.status !== 'complete').map((w) => w.walk_id) ?? []
    if (!pending.length) return
    const timer = window.setTimeout(async () => {
      const fresh = await Promise.all(pending.map((id) => api.getWalk(id).catch(() => null)))
      setItems((cur) => cur && cur.map((w) => fresh.find((f) => f?.walk_id === w.walk_id) ?? w))
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [items])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await api.feed(cursor)
      setItems((cur) => [...(cur ?? []), ...page.items.filter((w) => !cur?.some((c) => c.walk_id === w.walk_id))])
      setCursor(page.next_cursor)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  if (!items) {
    return (
      <div className="p-6 text-bark/60">
        {error ? (
          <>
            <p className="text-sm text-red-700">{error}</p>
            <button className="mt-3 rounded-xl border border-bark/30 px-4 py-2 text-sm" onClick={() => setReload((n) => n + 1)}>
              Retry
            </button>
          </>
        ) : (
          'Loading…'
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-5">
      <h1 className="px-1 text-2xl font-bold text-forest">Feed</h1>
      {!items.length && (
        <p className="px-1 text-bark/60">
          No walks yet.{' '}
          <Link to="/walk" className="font-semibold text-forest underline">
            Start one
          </Link>
          .
        </p>
      )}
      {items.map((w) => (
        <WalkCard
          key={w.walk_id}
          walk={w}
          highlight={w.walk_id === justFinished}
          onChirp={() => toggleChirp(w)}
          onCommentPosted={(id) => countComment(w.walk_id, id)}
        />
      ))}
      {error && <p className="px-1 text-sm text-red-700">{error}</p>}
      {cursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full rounded-2xl border border-forest/20 py-3 text-sm font-semibold text-forest disabled:opacity-60"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
