// Mirrors BIRDSEYE_SPEC.md §6 and api/app/schemas.py. Changing these = contract change.
import type { LineString } from 'geojson'

export type Tier = 'common' | 'uncommon' | 'rare'
export type LatLng = { lat: number; lng: number }

export type UserRef = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

export type TrackPoint = { t: string; lat: number; lng: number; accuracy_m: number | null }

export type RecapSpecies = {
  species_code: string
  common_name: string
  sci_name: string | null
  family_com_name: string | null
  rarity_tier: Tier
  heard: boolean
  photographed: boolean
  detection_count: number
  first_detected_at: string | null
  location: LatLng | null
  best_confidence: number | null
  clip_url: string | null
  spectrogram_url: string | null
  photo_url: string | null
  points: number
  is_anomaly: boolean
}

export type PhotoStatus = 'processing' | 'needs_confirmation' | 'confirmed' | 'unidentified'

// GET /photos/{photo_id} (owner only), for the confirm sheet. Poll while status === 'processing'.
export type PhotoDetail = {
  photo_id: string
  status: PhotoStatus
  species_code: string | null
  suggestions: { species_code: string; common_name: string; confidence: number | null }[]
  url: string | null
}

export type RecapPhoto = {
  photo_id: string
  url: string | null
  species_code: string | null
  status: PhotoStatus
  location: LatLng | null
}

export type Recap = {
  walk_id: string
  user: UserRef
  status: 'active' | 'processing' | 'complete'
  started_at: string
  ended_at: string | null
  distance_m: number | null
  duration_s: number | null
  species_count: number
  points: number
  precise: boolean
  public_area_label: string | null
  route: [number, number][] | null // [lng, lat]
  static_map_url: string | null
  species: RecapSpecies[]
  photos: RecapPhoto[]
  recap_text: string | null
  quests_progressed: { quest_id: string; title: string; progress: number; target: number; completed: boolean }[]
  bounties_claimed: { bounty_id: string; common_name: string; points: number }[]
  bounties_created: { bounty_id: string; common_name: string }[]
  chirp_count: number
  comment_count: number
  viewer_chirped: boolean
}

// Recap without species[].clip_url/spectrogram_url and photos beyond the first 3; route thinned to ≤ 80 points.
export type RecapSummary = Recap

export type FeedPage = { items: RecapSummary[]; next_cursor: string | null }

export type UserSearchResult = UserRef & { is_following: boolean }

export type UserProfile = {
  user: UserRef
  follower_count: number
  following_count: number
  is_following: boolean
  is_friend: boolean
  recent_walks: RecapSummary[]
}

export type QuestTemplate =
  | 'hear_family'
  | 'photo_family'
  | 'species_in_walk'
  | 'dawn_chorus'
  | 'tier_hunt'
  | 'distance_species'

export type UserQuest = {
  id: string
  template: QuestTemplate
  params: Record<string, unknown>
  title: string
  flavor_text: string | null
  target: number
  progress: number
  reward_points: number
  starts_at: string
  ends_at: string
  completed_at: string | null
}

export type NearbyBounty = {
  bounty_id: string
  species_code: string
  common_name: string
  center: LatLng
  radius_m: number
  expires_at: string
  claimed_by_me: boolean
}

export type LeaderboardRow = { rank: number; user: UserRef; points: number }

export type CommunityMap = {
  trails: { trail_id: string; name: string | null; geometry: LineString; species_total: number }[]
  bounties: NearbyBounty[]
  anomalies: {
    species_code: string
    common_name: string
    center: LatLng
    radius_m: number
    detected_at: string
    reason: string | null
    photo_confirmed: boolean
  }[]
  heat: { lat: number; lng: number; weight: number }[]
}

export type TrailSpecies = {
  name: string | null
  top_species: {
    species_code: string
    common_name: string
    rarity_tier: Tier
    walks: number
    users: number
    last_heard_at: string | null
  }[]
}
