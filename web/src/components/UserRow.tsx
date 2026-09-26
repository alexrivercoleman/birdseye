// One birder in a list (search results, followers, following): avatar, name + level, @username, follow button.
import { Link } from 'react-router'
import type { UserSearchResult } from '../api/types'
import { Avatar } from './Avatar'
import { FollowButton } from './FollowButton'
import { LevelTag } from './LevelTag'

export function UserRow({ user: u, isMe, onToggleFollow }: { user: UserSearchResult; isMe?: boolean; onToggleFollow: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
      <Link to={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3 active:opacity-80">
        <Avatar user={u} size={44} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{u.display_name ?? u.username}</span>
            <LevelTag xp={u.xp} />
          </p>
          <p className="truncate text-sm text-bark/60">@{u.username}</p>
        </div>
      </Link>
      {isMe ? (
        <span className="shrink-0 px-2 text-xs font-semibold text-bark/50">You</span>
      ) : (
        <FollowButton following={u.is_following} onClick={onToggleFollow} />
      )}
    </li>
  )
}
