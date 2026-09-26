// Instagram-style comments under a feed card: newest top-level comments first, "View more comments" pages in older
// ones, and each thread's replies collapse behind "View N replies". Replying to a reply stays in the same thread.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { formatAgo } from '../lib/format'
import { fetchComments, postComment, setCommentLike, subscribeComments, type Comment } from '../lib/social'
import { Avatar } from './Avatar'

const FIRST_PAGE = 3
const MORE_PAGE = 5
const newestFirst = (a: Comment, b: Comment) => Date.parse(b.created_at) - Date.parse(a.created_at)

function withLike(c: Comment, userId: string, on: boolean): Comment {
  if (on === c.likers.includes(userId)) return c
  return { ...c, likers: on ? [...c.likers, userId] : c.likers.filter((id) => id !== userId) }
}

export function CommentSection({
  walkId,
  autoFocus,
  onPosted,
}: {
  walkId: string
  autoFocus?: boolean
  onPosted: (commentId: string) => void
}) {
  const { profile } = useAuth()
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(FIRST_PAGE)
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set())
  const [replyTo, setReplyTo] = useState<{ parentId: string; username: string } | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const add = (c: Comment) => setComments((cur) => (cur?.some((x) => x.id === c.id) ? cur : [...(cur ?? []), c]))
  const applyLike = (commentId: string, userId: string, on: boolean) =>
    setComments((cur) => cur && cur.map((c) => (c.id === commentId ? withLike(c, userId, on) : c)))

  useEffect(() => {
    let alive = true
    const unsubscribe = subscribeComments(walkId, { comment: add, like: applyLike })
    fetchComments(walkId).then(
      (list) => alive && setComments((cur) => [...list, ...(cur ?? []).filter((c) => !list.some((l) => l.id === c.id))]),
      (e) => alive && setError(String(e)),
    )
    return () => {
      alive = false
      unsubscribe()
    }
  }, [walkId])

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  const top = useMemo(() => (comments ?? []).filter((c) => !c.parent_id).sort(newestFirst), [comments])
  const replies = useMemo(() => {
    const byParent = new Map<string, Comment[]>()
    for (const c of comments ?? []) if (c.parent_id) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c])
    for (const list of byParent.values()) list.sort((a, b) => -newestFirst(a, b))
    return byParent
  }, [comments])

  const openThread = (id: string) => setOpenThreads((s) => new Set(s).add(id))
  function toggleThread(id: string) {
    setOpenThreads((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  function toggleLike(c: Comment) {
    if (!profile) return
    const on = !c.likers.includes(profile.id)
    applyLike(c.id, profile.id, on)
    setCommentLike(c.id, profile.id, on).catch((e) => {
      applyLike(c.id, profile.id, !on)
      setError(String(e))
    })
  }

  function startReply(c: Comment) {
    const parentId = c.parent_id ?? c.id
    setReplyTo({ parentId, username: c.user.username })
    setBody(`@${c.user.username} `)
    openThread(parentId)
    input.current?.focus()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text || !profile || sending) return
    setSending(true)
    setError(null)
    try {
      const c = await postComment(walkId, profile, text, replyTo?.parentId ?? null)
      add(c)
      onPosted(c.id)
      if (c.parent_id) openThread(c.parent_id)
      setBody('')
      setReplyTo(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t border-bark/10 px-4 pb-3 pt-3">
      {!comments && !error && <p className="text-sm text-bark/50">Loading comments…</p>}
      {comments && !top.length && <p className="text-sm text-bark/50">No comments yet. Start the conversation.</p>}

      <ul className="space-y-3">
        {top.slice(0, shown).map((c) => {
          const thread = replies.get(c.id) ?? []
          const open = openThreads.has(c.id)
          return (
            <li key={c.id}>
              <CommentRow c={c} me={profile?.id} onLike={toggleLike} onReply={startReply} />
              {thread.length > 0 && (
                <div className="ml-11 mt-2">
                  <button
                    type="button"
                    onClick={() => toggleThread(c.id)}
                    className="flex items-center gap-2 text-xs font-semibold text-bark/50"
                  >
                    <span className="h-px w-6 bg-bark/30" />
                    {open ? 'Hide replies' : `View ${thread.length} ${thread.length === 1 ? 'reply' : 'replies'}`}
                  </button>
                  {open && (
                    <ul className="mt-3 space-y-3">
                      {thread.map((r) => (
                        <li key={r.id}>
                          <CommentRow c={r} me={profile?.id} onLike={toggleLike} onReply={startReply} small />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {top.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + MORE_PAGE)} className="mt-3 text-sm font-medium text-bark/50">
          View more comments ({top.length - shown})
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      <form onSubmit={submit} className="mt-3">
        {replyTo && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-fern/15 px-3 py-1.5 text-xs text-bark/70">
            <span>Replying to @{replyTo.username}</span>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => {
                setReplyTo(null)
                setBody('')
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-center gap-3">
          {profile && (
            <span className="shrink-0">
              <Avatar user={profile} size={28} />
            </span>
          )}
          {/* text-base: iOS zooms the page when focusing inputs under 16px */}
          <input
            ref={input}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            enterKeyHint="send"
            placeholder={replyTo ? `Reply to @${replyTo.username}…` : 'Add a comment…'}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none placeholder:text-bark/40"
          />
          <button type="submit" disabled={!body.trim() || sending} className="text-sm font-semibold text-uncommon disabled:opacity-40">
            Post
          </button>
        </div>
      </form>
    </div>
  )
}

function CommentRow({
  c,
  me,
  onLike,
  onReply,
  small,
}: {
  c: Comment
  me: string | undefined
  onLike: (c: Comment) => void
  onReply: (c: Comment) => void
  small?: boolean
}) {
  const liked = me != null && c.likers.includes(me)
  return (
    <div className="flex gap-3">
      <span className="shrink-0">
        <Avatar user={c.user} size={small ? 24 : 32} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm leading-snug">
          <span className="mr-1.5 font-semibold">{c.user.username}</span>
          {c.body.split(/(@[a-z0-9_]{3,20})/).map((part, i) =>
            i % 2 ? (
              <span key={i} className="text-uncommon">
                {part}
              </span>
            ) : (
              part
            ),
          )}
        </p>
        <div className="mt-1 flex gap-3 text-xs text-bark/50">
          <span>{formatAgo(c.created_at)}</span>
          {c.likers.length > 0 && (
            <span className="font-semibold">
              {c.likers.length} like{c.likers.length === 1 ? '' : 's'}
            </span>
          )}
          <button type="button" className="font-semibold" onClick={() => onReply(c)}>
            Reply
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onLike(c)}
        aria-label={liked ? 'Unlike comment' : 'Like comment'}
        aria-pressed={liked}
        className={`shrink-0 self-start px-1 text-base leading-none transition active:scale-125 ${liked ? 'text-red-500' : 'text-bark/40'}`}
      >
        {liked ? '♥' : '♡'}
      </button>
    </div>
  )
}
