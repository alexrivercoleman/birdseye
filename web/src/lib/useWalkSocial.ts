// Chirps and comment counts for a list of walk cards (feed, profile): optimistic chirp toggles, live updates from
// every viewer via realtime.
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { RecapSummary } from '../api/types'
import { useAuth } from './auth'
import { setChirp, subscribeFeedSocial } from './social'

export function useWalkSocial(
  setItems: Dispatch<SetStateAction<RecapSummary[] | null>>,
  onError: (message: string) => void,
) {
  const me = useAuth().profile?.id
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
    [me, setItems],
  )

  // Called from realtime and from the viewer's own post; each comment id counts once.
  const countComment = useCallback(
    (walkId: string, commentId: string) => {
      if (countedComments.current.has(commentId)) return
      countedComments.current.add(commentId)
      setItems((cur) => cur && cur.map((w) => (w.walk_id === walkId ? { ...w, comment_count: w.comment_count + 1 } : w)))
    },
    [setItems],
  )

  useEffect(() => subscribeFeedSocial({ chirp: applyChirp, comment: countComment }), [applyChirp, countComment])

  function toggleChirp(w: RecapSummary) {
    if (!me) return
    const on = !w.viewer_chirped
    applyChirp(w.walk_id, me, on)
    setChirp(w.walk_id, me, on).catch((e) => {
      applyChirp(w.walk_id, me, !on)
      onError(String(e))
    })
  }

  return { toggleChirp, countComment }
}
