// Follows, chirps, comments and comment likes go straight to Supabase (§3; RLS: insert/delete own rows only), with realtime
// so every viewer's feed updates live. Replies are one level deep: parent_id is always a top-level comment.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { USE_MOCKS } from '../api/client'
import { mockComments, mockFollowList } from '../api/mocks'
import type { UserRef, UserSearchResult } from '../api/types'
import { supabase } from './supabase'

export type Comment = {
  id: string
  walk_id: string
  parent_id: string | null
  body: string
  created_at: string
  user: UserRef
  likers: string[] // user ids
}

// comment_likes makes profiles↔comments many-to-many too, so the author embed needs the FK hint.
const COMMENT_SELECT =
  'id, walk_id, parent_id, body, created_at, user:profiles!comments_user_id_fkey(id, username, display_name, avatar_url, xp), comment_likes(user_id)'

type CommentRow = Omit<Comment, 'likers'> & { comment_likes: { user_id: string }[] }
const toComment = ({ comment_likes, ...c }: CommentRow): Comment => ({ ...c, likers: comment_likes.map((l) => l.user_id) })

// Topics must be unique: supabase.channel() hands back an existing channel with the same name.
const topic = (name: string) => `${name}-${Math.random().toString(36).slice(2)}`

const ignoreDuplicate = (error: { code?: string } | null) => {
  if (error && error.code !== '23505') throw error
}

export async function setFollow(followerId: string, followeeId: string, on: boolean) {
  if (USE_MOCKS) return
  const row = { follower_id: followerId, followee_id: followeeId }
  const { error } = on ? await supabase.from('follows').insert(row) : await supabase.from('follows').delete().match(row)
  ignoreDuplicate(error)
}

export type FollowListKind = 'followers' | 'following'

const FOLLOW_EMBED: Record<FollowListKind, [string, string]> = {
  followers: ['followee_id', 'user:profiles!follows_follower_id_fkey(id, username, display_name, avatar_url, xp)'],
  following: ['follower_id', 'user:profiles!follows_followee_id_fkey(id, username, display_name, avatar_url, xp)'],
}

/** Who follows @username, or whom they follow, newest first, each marked with whether the viewer follows them.
 *  null if there's no such user. */
export async function fetchFollowList(
  username: string,
  kind: FollowListKind,
  viewerId: string,
): Promise<{ user: UserRef; list: UserSearchResult[] } | null> {
  if (USE_MOCKS) return mockFollowList(username, kind)
  const { data: user, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, xp')
    .eq('username', username.toLowerCase())
    .maybeSingle()
  if (error) throw error
  if (!user) return null
  const [column, embed] = FOLLOW_EMBED[kind]
  const [rows, mine] = await Promise.all([
    supabase.from('follows').select(embed).eq(column, user.id).order('created_at', { ascending: false }).limit(1000),
    supabase.from('follows').select('followee_id').eq('follower_id', viewerId).limit(5000),
  ])
  if (rows.error) throw rows.error
  if (mine.error) throw mine.error
  const followed = new Set(mine.data.map((r) => r.followee_id as string))
  const list = (rows.data as unknown as { user: UserRef }[]).map(({ user: u }) => ({ ...u, is_following: followed.has(u.id) }))
  return { user: user as UserRef, list }
}

export async function setChirp(walkId: string, userId: string, on: boolean) {
  if (USE_MOCKS) return
  const row = { walk_id: walkId, user_id: userId }
  const { error } = on ? await supabase.from('chirps').insert(row) : await supabase.from('chirps').delete().match(row)
  ignoreDuplicate(error)
}

export async function setCommentLike(commentId: string, userId: string, on: boolean) {
  if (USE_MOCKS) return
  const row = { comment_id: commentId, user_id: userId }
  const { error } = on
    ? await supabase.from('comment_likes').insert(row)
    : await supabase.from('comment_likes').delete().match(row)
  ignoreDuplicate(error)
}

export async function fetchComments(walkId: string): Promise<Comment[]> {
  if (USE_MOCKS) return mockComments(walkId)
  const { data, error } = await supabase.from('comments').select(COMMENT_SELECT).eq('walk_id', walkId).limit(1000)
  if (error) throw error
  return (data as unknown as CommentRow[]).map(toComment)
}

export async function postComment(walkId: string, user: UserRef, body: string, parentId: string | null): Promise<Comment> {
  if (USE_MOCKS) {
    const id = Math.random().toString(36).slice(2)
    return { id, walk_id: walkId, parent_id: parentId, body, created_at: new Date().toISOString(), user, likers: [] }
  }
  const { data, error } = await supabase
    .from('comments')
    .insert({ walk_id: walkId, user_id: user.id, parent_id: parentId, body })
    .select(COMMENT_SELECT)
    .single()
  if (error) throw error
  return toComment(data as unknown as CommentRow)
}

const profiles = new Map<string, Promise<UserRef | null>>()
function getProfile(id: string): Promise<UserRef | null> {
  if (!profiles.has(id)) {
    profiles.set(
      id,
      Promise.resolve(
        supabase.from('profiles').select('id, username, display_name, avatar_url, xp').eq('id', id).maybeSingle(),
      ).then(({ data }) => data as UserRef | null),
    )
  }
  return profiles.get(id)!
}

/** Every chirp and new comment, for feed counts. Returns an unsubscribe function. */
export function subscribeFeedSocial(handlers: {
  chirp: (walkId: string, userId: string, on: boolean) => void
  comment: (walkId: string, commentId: string) => void
}): () => void {
  if (USE_MOCKS) return () => {}
  const channel: RealtimeChannel = supabase
    .channel(topic('feed-social'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chirps' }, ({ new: r }) =>
      handlers.chirp(r.walk_id, r.user_id, true),
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chirps' }, ({ old: r }) => {
      if (r.walk_id && r.user_id) handlers.chirp(r.walk_id, r.user_id, false)
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, ({ new: r }) =>
      handlers.comment(r.walk_id, r.id),
    )
    .subscribe()
  return () => void supabase.removeChannel(channel)
}

/** New comments on one walk (with author profile) and likes on any comment. Returns an unsubscribe function. */
export function subscribeComments(
  walkId: string,
  handlers: { comment: (c: Comment) => void; like: (commentId: string, userId: string, on: boolean) => void },
): () => void {
  if (USE_MOCKS) return () => {}
  const channel: RealtimeChannel = supabase
    .channel(topic(`comments-${walkId}`))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'comments', filter: `walk_id=eq.${walkId}` },
      async ({ new: r }) => {
        const user = await getProfile(r.user_id)
        if (user) handlers.comment({ id: r.id, walk_id: r.walk_id, parent_id: r.parent_id, body: r.body, created_at: r.created_at, user, likers: [] })
      },
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comment_likes' }, ({ new: r }) =>
      handlers.like(r.comment_id, r.user_id, true),
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comment_likes' }, ({ old: r }) => {
      if (r.comment_id && r.user_id) handlers.like(r.comment_id, r.user_id, false)
    })
    .subscribe()
  return () => void supabase.removeChannel(channel)
}
