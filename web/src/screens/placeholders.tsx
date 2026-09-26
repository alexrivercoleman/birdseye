// Placeholder screens. Replace each with its real screen file as it's built (§8).
// A: Map.

function Placeholder({ title, owner }: { title: string; owner: string }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-forest">{title}</h1>
      <p className="mt-2 text-sm text-bark/60">Workstream {owner}</p>
    </div>
  )
}

export const MapScreen = () => <Placeholder title="Community Map" owner="A" />
