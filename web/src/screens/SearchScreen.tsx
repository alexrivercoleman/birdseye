// §8 screen 10: find birders by username prefix (or the start of a word in their name) and follow them from the list.
// Scan QR opens the in-app scanner for a friend's profile code.
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import type { UserSearchResult } from '../api/types'
import { QrIcon } from '../components/QrIcon'
import { UserRow } from '../components/UserRow'
import { useAuth } from '../lib/auth'
import { setFollow } from '../lib/social'

const DEBOUNCE_MS = 250

export default function SearchScreen() {
  const me = useAuth().profile
  const [q, setQ] = useState('')
  const [results, setResults] = useState<UserSearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const term = q.trim()
    if (!term) return setResults(null)
    let alive = true
    const timer = window.setTimeout(() => {
      api.searchUsers(term).then(
        (r) => {
          if (!alive) return
          setResults(r)
          setError(null)
        },
        (e) => alive && setError(String(e)),
      )
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q])

  function setFollowing(id: string, on: boolean) {
    setResults((cur) => cur && cur.map((u) => (u.id === id ? { ...u, is_following: on } : u)))
  }

  function toggle(u: UserSearchResult) {
    if (!me) return
    const on = !u.is_following
    setFollowing(u.id, on)
    setFollow(me.id, u.id, on).catch((e) => {
      setFollowing(u.id, !on)
      setError((e as { message?: string })?.message ?? String(e))
    })
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-2xl font-bold text-forest">Find birders</h1>
        <Link
          to="/qr?scan"
          className="flex items-center gap-1.5 rounded-xl border border-forest/25 px-3 py-1.5 text-sm font-semibold text-forest active:scale-95"
        >
          <QrIcon /> Scan QR
        </Link>
      </div>
      <input
        type="search"
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        enterKeyHint="search"
        placeholder="Search by username or name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-2xl border border-bark/20 bg-white px-4 py-3 text-base outline-none focus:border-forest"
      />
      {error && <p className="px-1 text-sm text-red-700">{error}</p>}
      {results && !results.length && <p className="px-1 text-sm text-bark/60">No birders match “{q.trim()}”.</p>}
      <ul className="space-y-2">
        {results?.map((u) => <UserRow key={u.id} user={u} onToggleFollow={() => toggle(u)} />)}
      </ul>
    </div>
  )
}
