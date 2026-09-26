import type { Comment } from '../lib/social'
import type {
  FeedPage, LeaderboardRow, NearbyBounty, NestHatched, NestStatus, QuestClaimed, Recap, UserQuest,
} from './types'

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
    comment_count: 7,
    viewer_chirped: false,
  }
}

export function mockComments(walk_id: string): Comment[] {
  if (walk_id === 'w3') return []
  const wren = { id: 'u2', username: 'wren_hunter', display_name: 'Wren Hunter', avatar_url: null }
  const owl = { id: 'u3', username: 'owl_out', display_name: null, avatar_url: null }
  const c = (id: string, user: Comment['user'], body: string, h: number, parent_id: string | null = null, likers: string[] = []) =>
    ({ id: `${walk_id}-${id}`, walk_id, parent_id: parent_id && `${walk_id}-${parent_id}`, body, created_at: hoursAgo(h), user, likers })
  return [
    c('c1', wren, 'That Pileated is a great find!', 0.7, null, ['u1', 'u3']),
    c('c2', demoUser, '@wren_hunter Thanks! It was drumming near the lake.', 0.6, 'c1'),
    c('c3', owl, 'Which side of the lake?', 0.5, 'c1', ['u2']),
    c('c4', owl, 'Nice loop 🐦', 3),
    c('c5', wren, 'Carolina Wrens are so loud in the morning.', 5, null, ['u1']),
    c('c6', demoUser, 'Heading back tomorrow at dawn.', 6),
    c('c7', owl, 'Save me a cardinal.', 8),
  ]
}

export const mockFeed = (): FeedPage => {
  const mine = mockRecap('w1')
  const friend: Recap = {
    ...mockRecap('w2'),
    user: { id: 'u2', username: 'wren_hunter', display_name: 'Wren Hunter', avatar_url: null },
    started_at: hoursAgo(20),
    ended_at: hoursAgo(19),
    public_area_label: 'Freedom Park, Atlanta',
    route: [
      [-84.3525, 33.7648],
      [-84.3499, 33.7661],
      [-84.3462, 33.7659],
      [-84.3431, 33.7672],
      [-84.3407, 33.7694],
    ],
    points: 105,
    viewer_chirped: true,
  }
  const stranger: Recap = {
    ...mockRecap('w3'),
    user: { id: 'u3', username: 'owl_out', display_name: null, avatar_url: null },
    started_at: hoursAgo(30),
    ended_at: hoursAgo(28.5),
    precise: false,
    route: null,
    species: mockRecap().species.map((s) => ({ ...s, location: null })),
    public_area_label: 'Sweetwater Creek, Lithia Springs',
    recap_text: null,
    chirp_count: 0,
    comment_count: 0,
  }
  return { items: [mine, friend, stranger], next_cursor: null }
}

// Stateful for the session so claiming works: two quests start complete, 4 of 5 nests are filled, so the first
// claim fills the last nest and brings up the golden egg.
const mockQuestList: UserQuest[] = [
  { template: 'trail_distance', params: { miles: 5 }, title: 'Walk 5 miles on a nature trail', target: 8047, progress: 5150, reward_points: 150 },
  { template: 'discover_family', params: { family_com_name: 'Woodpeckers', n: 3 }, title: 'Discover 3 species of woodpecker', target: 3, progress: 3, reward_points: 100 },
  { template: 'photo_species', params: { species_code: 'brnthr' }, title: 'Photograph a Brown Thrasher', target: 1, progress: 1, reward_points: 75 },
].map((q, i) => ({
  ...q, id: `q${i + 1}`, template: q.template as UserQuest['template'], flavor_text: null,
  starts_at: hoursAgo(24), ends_at: daysFromNow(6),
  completed_at: q.progress >= q.target ? hoursAgo(2) : null, claimed_at: null,
}))
const mockNestState: NestStatus = { month: new Date().toISOString().slice(0, 7), total: 5, filled: 4, laid_this_week: false, hatched: false }

export const mockQuests = (): UserQuest[] => mockQuestList.filter((q) => !q.claimed_at)
export const mockNests = (): NestStatus => ({ ...mockNestState })
export function mockClaim(questId: string): QuestClaimed {
  const q = mockQuestList.find((x) => x.id === questId)!
  q.claimed_at = new Date().toISOString()
  const egg_laid = !mockNestState.laid_this_week && mockNestState.filled < mockNestState.total
  if (egg_laid) Object.assign(mockNestState, { filled: mockNestState.filled + 1, laid_this_week: true })
  return { points_awarded: q.reward_points, egg_laid, nests: mockNests() }
}
export function mockHatch(): NestHatched {
  mockNestState.hatched = true
  return { points_awarded: 500, nests: mockNests() }
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

// The community map's mock data is the sample in ./sampleMap (public/sample-map.json).
