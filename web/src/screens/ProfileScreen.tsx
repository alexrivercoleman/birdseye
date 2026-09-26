// §8 screen 9: a birder's profile. /profile is your own, /u/:username anyone's (also works from a shared link).
// Avatar, name, level + title with XP progress, bio, stats, follow button, and recent walks (masked per viewer,
// §7.9: exact routes only for mutual follows). Follower/following counts open the lists. Your own profile adds your
// QR code (top right), Edit profile, Find birders, and Sign out.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError, USE_MOCKS } from '../api/client'
import type { RecapSummary, UserProfile } from '../api/types'
import { Avatar } from '../components/Avatar'
import { FollowButton } from '../components/FollowButton'
import { LevelTag } from '../components/LevelTag'
import { QrIcon } from '../components/QrIcon'
import { WalkCard } from '../components/WalkCard'
import { useAuth } from '../lib/auth'
import { levelInfo, nextTitle } from '../lib/levels'
import { updateProfile, uploadAvatar } from '../lib/profile'
import { setFollow } from '../lib/social'
import { useWalkSocial } from '../lib/useWalkSocial'

const BIO_MAX = 160

// Supabase errors are plain objects with a message, not Errors.
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : ((e as { message?: string })?.message ?? String(e))

export default function ProfileScreen() {
  const { profile: me, signOut } = useAuth()
  const username = (useParams().username ?? me!.username).toLowerCase()
  const isMe = username === me?.username
  const [data, setData] = useState<UserProfile | null>(null)
  const [walks, setWalks] = useState<RecapSummary[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const { toggleChirp, countComment } = useWalkSocial(setWalks, setError)

  useEffect(() => {
    let alive = true
    setData(null)
    setWalks(null)
    setNotFound(false)
    setError(null)
    setEditing(false)
    api.getUser(username).then(
      (p) => {
        if (!alive) return
        setData(p)
        setWalks(p.recent_walks)
      },
      (e) => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 404) setNotFound(true)
        else setError(String(e))
      },
    )
    return () => {
      alive = false
    }
  }, [username])

  async function toggleFollow() {
    if (!data || !me || followBusy) return
    const on = !data.is_following
    const before = data
    setFollowBusy(true)
    setData({ ...data, is_following: on, is_friend: on && data.is_friend, follower_count: data.follower_count + (on ? 1 : -1) })
    try {
      await setFollow(me.id, data.user.id, on)
      if (!USE_MOCKS) {
        // Following back can make you friends, which unmasks their routes; refetch to pick that up.
        const fresh = await api.getUser(username)
        setData(fresh)
        setWalks(fresh.recent_walks)
      }
    } catch (e) {
      setData(before)
      setError(errorMessage(e))
    } finally {
      setFollowBusy(false)
    }
  }

  if (notFound) return <p className="p-6 text-bark/60">No birder named @{username}.</p>
  if (!data) return <p className="p-6 text-bark/60">{error ?? 'Loading…'}</p>
  const name = data.user.display_name ?? data.user.username

  return (
    <div className="space-y-4 px-4 pb-8 pt-5">
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        {editing ? (
          <EditProfile
            profile={data}
            onCancel={() => setEditing(false)}
            onSaved={(fields) => {
              setData({ ...data, bio: fields.bio, user: { ...data.user, ...fields } })
              setEditing(false)
            }}
          />
        ) : (
          <>
            <div className="relative flex items-center gap-4">
              {isMe && (
                <Link
                  to="/qr"
                  aria-label="My QR code"
                  className="absolute -right-1 -top-1 rounded-xl p-2 text-forest active:scale-95 active:bg-forest/5"
                >
                  <QrIcon className="h-6 w-6" />
                </Link>
              )}
              <Avatar user={data.user} size={80} />
              <div className={`min-w-0 ${isMe ? 'pr-10' : ''}`}>
                <h1 className="truncate text-2xl font-bold text-forest">{name}</h1>
                <p className="truncate text-sm text-bark/60">@{data.user.username}</p>
                <LevelTag xp={data.user.xp} className="mt-1.5" />
              </div>
            </div>
            {data.bio && <p className="mt-4 whitespace-pre-line break-words text-sm leading-relaxed">{data.bio}</p>}

            <XpBar xp={data.user.xp} />

            <div className="mt-5 grid grid-cols-4 gap-2 text-center">
              <Stat label="Walks" value={data.walk_count} />
              <Stat label="Species" value={data.life_list_count} />
              <Stat label="Followers" value={data.follower_count} to={`/u/${data.user.username}/followers`} />
              <Stat label="Following" value={data.following_count} to={`/u/${data.user.username}/following`} />
            </div>

            {isMe ? (
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-xl border border-forest/25 py-2 text-sm font-semibold text-forest active:scale-95"
                >
                  Edit profile
                </button>
                <Link
                  to="/search"
                  className="rounded-xl bg-forest py-2 text-center text-sm font-semibold text-paper active:scale-95"
                >
                  Find birders
                </Link>
              </div>
            ) : (
              <div className="mt-5">
                <FollowButton
                  following={data.is_following}
                  friends={data.is_friend}
                  onClick={() => void toggleFollow()}
                  disabled={followBusy}
                  className="w-full"
                />
                <p className="mt-2 text-center text-xs text-bark/50">
                  {data.is_friend
                    ? 'You follow each other, so you see each other’s exact routes.'
                    : data.is_following
                      ? 'You’ll see their exact routes once they follow you back.'
                      : 'Friends (mutual follows) see each other’s exact routes.'}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {error && <p className="px-1 text-sm text-red-700">{error}</p>}

      <h2 className="px-1 pt-2 font-bold text-forest">Recent walks</h2>
      {walks?.length ? (
        walks.map((w) => (
          <WalkCard
            key={w.walk_id}
            walk={w}
            onChirp={() => toggleChirp(w)}
            onCommentPosted={(id) => countComment(w.walk_id, id)}
          />
        ))
      ) : (
        <p className="rounded-2xl bg-white/60 p-6 text-center text-sm text-bark/60">
          {isMe ? (
            <>
              No walks yet.{' '}
              <Link to="/walk" className="font-semibold text-forest underline">
                Start one
              </Link>
              .
            </>
          ) : (
            `${name} hasn’t finished a walk yet.`
          )}
        </p>
      )}

      {isMe && (
        <button
          type="button"
          className="mx-auto block pt-4 text-sm text-bark/50 underline"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      )}
    </div>
  )
}

function XpBar({ xp }: { xp: number }) {
  const lvl = levelInfo(xp)
  const next = nextTitle(lvl.level)
  return (
    <div className="mt-4">
      <div className="flex justify-between text-xs font-semibold text-bark/60">
        <span className="tabular-nums">{xp.toLocaleString()} XP</span>
        <span className="tabular-nums">
          {lvl.xpLevelSpan ? `${(lvl.xpLevelSpan - lvl.xpIntoLevel).toLocaleString()} XP to Lv ${lvl.level + 1}` : 'Max level'}
        </span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-forest/10">
        <div className="h-full rounded-full bg-fern transition-[width] duration-700" style={{ width: `${lvl.progress * 100}%` }} />
      </div>
      {next && (
        <p className="mt-1 text-[11px] text-bark/50">
          Next title: <span className="font-semibold">{next.title}</span> at Lv {next.level}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <>
      <div className="text-lg font-bold tabular-nums text-forest">{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-wide text-bark/50">{label}</div>
    </>
  )
  return to ? (
    <Link to={to} className="rounded-xl active:bg-forest/5">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  )
}

type ProfileFields = { display_name: string | null; bio: string | null; avatar_url: string | null }

function EditProfile({
  profile,
  onCancel,
  onSaved,
}: {
  profile: UserProfile
  onCancel: () => void
  onSaved: (fields: ProfileFields) => void
}) {
  const { profile: me, reloadProfile } = useAuth()
  const [displayName, setDisplayName] = useState(profile.user.display_name ?? '')
  const [bio, setBio] = useState(profile.bio ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!me) return
    setBusy(true)
    setError(null)
    try {
      const avatar_url = file ? await uploadAvatar(me.id, file) : profile.user.avatar_url
      const fields = { display_name: displayName.trim() || null, bio: bio.trim() || null, avatar_url }
      await updateProfile(me.id, fields)
      await reloadProfile() // header avatar
      onSaved(fields)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-xl border border-bark/20 bg-paper px-3 py-2 text-base outline-none focus:border-forest'
  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => fileInput.current?.click()} className="relative shrink-0 active:scale-95">
          <Avatar user={{ ...profile.user, avatar_url: preview ?? profile.user.avatar_url }} size={80} />
          <span className="absolute inset-x-0 bottom-0 rounded-b-full bg-black/50 py-0.5 text-center text-[10px] font-semibold text-white">
            Change
          </span>
        </button>
        <div className="min-w-0">
          <p className="font-semibold">@{profile.user.username}</p>
          <p className="text-xs text-bark/50">Tap the photo to change it.</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-bark/60">Name</span>
        <input className={field} value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} placeholder={profile.user.username} />
      </label>
      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-bark/60">
          Bio
          <span className="tabular-nums font-normal normal-case">
            {bio.length}/{BIO_MAX}
          </span>
        </span>
        <textarea
          className={`${field} resize-none`}
          rows={3}
          maxLength={BIO_MAX}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Favorite patch, target birds, gear…"
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-bark/20 py-2 text-sm font-semibold">
          Cancel
        </button>
        <button disabled={busy} className="rounded-xl bg-forest py-2 text-sm font-semibold text-paper disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
