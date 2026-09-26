import type { UserRef } from '../api/types'

export function Avatar({ user, size = 36 }: { user: Pick<UserRef, 'username' | 'display_name' | 'avatar_url'>; size?: number }) {
  const style = { width: size, height: size }
  if (user.avatar_url) return <img src={user.avatar_url} alt="" style={style} className="rounded-full object-cover" />
  const initial = (user.display_name || user.username).trim()[0]?.toUpperCase() ?? '?'
  return (
    <span
      style={{ ...style, fontSize: size * 0.42 }}
      className="flex items-center justify-center rounded-full bg-moss font-semibold text-paper"
    >
      {initial}
    </span>
  )
}
