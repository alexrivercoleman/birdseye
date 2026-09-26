// Placeholder screens. Replace each with its real screen file as it's built (§8).
// A: Walk, Recap, Map. C: Feed, Quests, Profile, Search.

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
export const WalkScreen = () => <Placeholder title="Start Walk" owner="A" />
export const QuestsScreen = () => <Placeholder title="Quests" owner="C" />
export const ProfileScreen = () => <Placeholder title="Profile" owner="C" />
