// Placeholder screens. Replace each with its real screen file as it's built (§8).
// A: Map. C: Feed, Quests, Profile, Search.
import { useAuth } from '../lib/auth'

function Placeholder({ title, owner }: { title: string; owner: string }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-forest">{title}</h1>
      <p className="mt-2 text-sm text-bark/60">Workstream {owner}</p>
    </div>
  )
}

export const FeedScreen = () => <Placeholder title="Feed" owner="C" />
export const MapScreen = () => <Placeholder title="Community Map" owner="A" />
export const QuestsScreen = () => <Placeholder title="Quests" owner="C" />

export function ProfileScreen() {
  const { profile, signOut } = useAuth()
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-forest">{profile?.display_name ?? 'Profile'}</h1>
      <p className="text-bark/60">@{profile?.username}</p>
      <p className="mt-2 text-sm text-bark/60">Full profile: Workstream C</p>
      <button className="mt-6 rounded-xl border border-bark/30 px-4 py-2 text-sm" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}
