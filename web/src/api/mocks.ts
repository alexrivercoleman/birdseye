import type { CommunityMap, FeedPage, LeaderboardRow, NearbyBounty, NestStatus, QuestClaimed, Recap, UserQuest } from './types'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

export const demoUser = { id: 'u1', username: 'demo_birder', display_name: 'Demo Birder', avatar_url: null }

export function mockRecap(walk_id = 'mock-walk'): Recap {
  return {
    walk_id,
    user: demoUser,
    status: 'complete',
    started_at: hoursAgo(2),
    ended_at: hoursAgo(0.8),
    distance_m: 3120,
    duration_s: 4210,
    species_count: 3,
    points: 55,
    precise: true,
    public_area_label: 'Piedmont Park, Atlanta',
    route: [
      [-84.3738, 33.7851],
      [-84.3722, 33.7866],
      [-84.3705, 33.788],
      [-84.3719, 33.7897],
    ],
    static_map_url: null,
    species: [
      {
        species_code: 'pilwoo', common_name: 'Pileated Woodpecker', sci_name: 'Dryocopus pileatus',
        family_com_name: 'Woodpeckers', rarity_tier: 'uncommon', heard: true, photographed: false,
        detection_count: 2, first_detected_at: hoursAgo(1.6), location: { lat: 33.7866, lng: -84.3722 },
        best_confidence: 0.88, clip_url: null, spectrogram_url: null, photo_url: null, points: 25, is_anomaly: false,
      },
      {
        species_code: 'carwre', common_name: 'Carolina Wren', sci_name: 'Thryothorus ludovicianus',
        family_com_name: 'Wrens', rarity_tier: 'common', heard: true, photographed: true,
        detection_count: 7, first_detected_at: hoursAgo(1.95), location: { lat: 33.7853, lng: -84.3736 },
        best_confidence: 0.93, clip_url: null, spectrogram_url: null, photo_url: null, points: 20, is_anomaly: false,
      },
      {
        species_code: 'norcar', common_name: 'Northern Cardinal', sci_name: 'Cardinalis cardinalis',
        family_com_name: 'Cardinals, Grosbeaks, and Allies', rarity_tier: 'common', heard: true, photographed: false,
        detection_count: 5, first_detected_at: hoursAgo(1.85), location: { lat: 33.788, lng: -84.3705 },
        best_confidence: 0.81, clip_url: null, spectrogram_url: null, photo_url: null, points: 10, is_anomaly: false,
      },
    ],
    photos: [],
    recap_text:
      'A bright morning loop through Piedmont Park. A Carolina Wren kept you company from the first minute, and a Pileated Woodpecker made an appearance near the lake.',
    quests_progressed: [{ quest_id: 'q1', title: 'Knock Knock', progress: 1, target: 3, completed: false }],
    bounties_claimed: [],
    bounties_created: [],
    chirp_count: 4,
    comment_count: 2,
    viewer_chirped: false,
  }
}

export const mockFeed = (): FeedPage => ({ items: [mockRecap('w1'), mockRecap('w2')], next_cursor: null })

// Stateful for the session so claiming works: two quests start complete, 3 of 5 nests are filled.
const mockQuestList: UserQuest[] = [
  { template: 'trail_distance', params: { miles: 5 }, title: 'Walk 5 miles on a nature trail', target: 8047, progress: 5150, reward_points: 150 },
  { template: 'discover_family', params: { family_com_name: 'Woodpeckers', n: 3 }, title: 'Discover 3 species of woodpecker', target: 3, progress: 3, reward_points: 100 },
  { template: 'photo_species', params: { species_code: 'brnthr' }, title: 'Photograph a Brown Thrasher', target: 1, progress: 1, reward_points: 75 },
].map((q, i) => ({
  ...q, id: `q${i + 1}`, template: q.template as UserQuest['template'], flavor_text: null,
  starts_at: hoursAgo(24), ends_at: daysFromNow(6),
  completed_at: q.progress >= q.target ? hoursAgo(2) : null, claimed_at: null,
}))
const mockNestState: NestStatus = { month: new Date().toISOString().slice(0, 7), total: 5, filled: 3, laid_this_week: false }

export const mockQuests = (): UserQuest[] => mockQuestList.filter((q) => !q.claimed_at)
export const mockNests = (): NestStatus => ({ ...mockNestState })
export function mockClaim(questId: string): QuestClaimed {
  const q = mockQuestList.find((x) => x.id === questId)!
  q.claimed_at = new Date().toISOString()
  const egg_laid = !mockNestState.laid_this_week && mockNestState.filled < mockNestState.total
  if (egg_laid) Object.assign(mockNestState, { filled: mockNestState.filled + 1, laid_this_week: true })
  return { points_awarded: q.reward_points, egg_laid, nests: mockNests() }
}

export const mockBounties = (): NearbyBounty[] => [
  {
    bounty_id: 'b1', species_code: 'paibun', common_name: 'Painted Bunting',
    center: { lat: 33.7702, lng: -84.359 }, radius_m: 300, expires_at: daysFromNow(5), claimed_by_me: false,
  },
]

export const mockLeaderboard = (): LeaderboardRow[] => [
  { rank: 1, user: { id: 'u2', username: 'wren_hunter', display_name: 'Wren Hunter', avatar_url: null }, points: 640 },
  { rank: 2, user: demoUser, points: 415 },
]

export const mockCommunityMap = (): CommunityMap => ({
  trails: [
    {
      trail_id: 't1', name: 'Piedmont Park Loop', species_total: 23,
      geometry: { type: 'LineString', coordinates: [[-84.3738, 33.7851], [-84.3705, 33.788], [-84.3719, 33.7897]] },
    },
  ],
  bounties: mockBounties(),
  anomalies: [],
  heat: [{ lat: 33.7866, lng: -84.3722, weight: 3 }],
})
