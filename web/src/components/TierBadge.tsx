import type { Tier } from '../api/types'

const styles: Record<Tier, string> = {
  common: 'bg-common/15 text-common',
  uncommon: 'bg-uncommon/15 text-uncommon',
  rare: 'bg-rare text-bark',
}

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles[tier]}`}>
      {tier}
    </span>
  )
}

export const TIER_COLORS: Record<Tier, string> = { common: '#8a8f8a', uncommon: '#3b82c4', rare: '#f2b632' }
