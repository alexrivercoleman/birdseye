// Followers / following of a birder: /u/:username/followers and /u/:username/following, with follow buttons.
// Reads straight from Supabase (follows and profiles are readable by any signed-in user, §5 RLS).
import { useEffect, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'
import type { UserRef, UserSearchResult } from '../api/types'
import { UserRow } from '../components/UserRow'
import { useAuth } from '../lib/auth'
import { fetchFollowList, setFollow, type FollowListKind } from '../lib/social'

export default function FollowListScreen({ kind }: { kind: FollowListKind }) {
  const username = useParams().username!.toLowerCase()
  const meId = useAuth().profile?.id
  const [user, setUser] = useState<UserRef | null>(null)
  const [list, setList] = useState<UserSearchResult[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!meId) return
    let alive = true
    setList(null)
    setError(null)
    fetchFollowList(username, kind, meId).then(
      (res) => {
        if (!alive) return
        if (!res) return setNotFound(true)
        setUser(res.user)
        setList(res.list)
      },
      (e) => alive && setError((e as { message?: string })?.message ?? String(e)),
    )
    return () => {
      alive = false
    }
  }, [username, kind, meId])

  function setFollowing(id: string, on: boolean) {
    setList((cur) => cur && cur.map((u) => (u.id === id ? { ...u, is_following: on } : u)))
  }

  function toggle(u: UserSearchResult) {
    if (!meId) return
    const on = !u.is_following
    setFollowing(u.id, on)
    setFollow(meId, u.id, on).catch((e) => {
      setFollowing(u.id, !on)
      setError((e as { message?: string })?.message ?? String(e))
    })
  }

  if (notFound) return <p className="p-6 text-bark/60">No birder named @{username}.</p>
  const name = user ? (user.display_name ?? user.username) : `@${username}`
  const tab = (to: FollowListKind, label: string) => (
    <NavLink
      to={`/u/${username}/${to}`}
      replace
      className={({ isActive }) =>
        `flex-1 rounded-xl py-2 text-center text-sm font-semibold ${isActive ? 'bg-white text-forest shadow-sm' : 'text-bark/60'}`
      }
    >
      {label}
    </NavLink>
  )

  return (
    <div className="space-y-4 px-4 pb-8 pt-5">
      <div className="px-1">
        <Link to={`/u/${username}`} className="text-sm font-semibold text-bark/60">
          ← {name}
        </Link>
      </div>
      <div className="flex gap-1 rounded-2xl bg-forest/5 p-1">
        {tab('followers', 'Followers')}
        {tab('following', 'Following')}
      </div>
      {error && <p className="px-1 text-sm text-red-700">{error}</p>}
      {!list ? (
        !error && <p className="p-6 text-center text-sm text-bark/60">Loading…</p>
      ) : !list.length ? (
        <p className="rounded-2xl bg-white/60 p-6 text-center text-sm text-bark/60">
          {kind === 'followers' ? `No one follows ${name} yet.` : `${name} isn’t following anyone yet.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((u) => (
            <UserRow key={u.id} user={u} isMe={u.id === meId} onToggleFollow={() => toggle(u)} />
          ))}
        </ul>
      )}
    </div>
  )
}
