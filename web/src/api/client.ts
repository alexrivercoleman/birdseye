import { supabase } from '../lib/supabase'
import * as mocks from './mocks'
import type {
  CommunityMap,
  FeedPage,
  LeaderboardRow,
  NearbyBounty,
  NestStatus,
  PhotoDetail,
  QuestClaimed,
  Recap,
  TrackPoint,
  TrailSpecies,
  UserProfile,
  UserQuest,
  UserSearchResult,
} from './types'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) throw new ApiError(`${init.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`, res.status)
  return res.json() as Promise<T>
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) })

const mock = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 150))

export const api = {
  // Walk lifecycle
  createWalk: () => (USE_MOCKS ? mock({ walk_id: crypto.randomUUID() }) : post<{ walk_id: string }>('/walks')),
  postTrack: (walkId: string, points: TrackPoint[]) =>
    USE_MOCKS ? mock({ ok: true }) : post<{ ok: boolean }>(`/walks/${walkId}/track`, { points }),
  uploadChunk: (walkId: string, form: FormData) =>
    USE_MOCKS ? mock({ chunk_id: crypto.randomUUID() }) : post<{ chunk_id: string }>(`/walks/${walkId}/chunks`, form),
  uploadPhoto: (walkId: string, form: FormData) =>
    USE_MOCKS ? mock({ photo_id: crypto.randomUUID() }) : post<{ photo_id: string }>(`/walks/${walkId}/photos`, form),
  getPhoto: (photoId: string) =>
    USE_MOCKS
      ? mock<PhotoDetail>({
          photo_id: photoId, status: 'needs_confirmation', species_code: null, url: null,
          suggestions: [
            { species_code: 'carwre', common_name: 'Carolina Wren', confidence: 0.82 },
            { species_code: 'norcar', common_name: 'Northern Cardinal', confidence: 0.11 },
          ],
        })
      : request<PhotoDetail>(`/photos/${photoId}`),
  confirmPhoto: (photoId: string, species_code: string | null) =>
    USE_MOCKS ? mock({ ok: true }) : post<{ ok: boolean }>(`/photos/${photoId}/confirm`, { species_code }),
  finishWalk: (walkId: string) =>
    USE_MOCKS ? mock({ status: 'processing' as const }) : post<{ status: 'processing' }>(`/walks/${walkId}/finish`),
  getWalk: (walkId: string) => (USE_MOCKS ? mock(mocks.mockRecap(walkId)) : request<Recap>(`/walks/${walkId}`)),

  // Social
  feed: (cursor?: string) =>
    USE_MOCKS ? mock(mocks.mockFeed()) : request<FeedPage>(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  getUser: (username: string) =>
    USE_MOCKS
      ? mock<UserProfile>({
          user: mocks.demoUser, follower_count: 12, following_count: 9, is_following: true, is_friend: true,
          recent_walks: [mocks.mockRecap()],
        })
      : request<UserProfile>(`/users/${encodeURIComponent(username)}`),
  searchUsers: (q: string) =>
    USE_MOCKS
      ? mock<UserSearchResult[]>([{ ...mocks.demoUser, is_following: false }])
      : request<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(q)}`),

  // Game
  myQuests: () => (USE_MOCKS ? mock(mocks.mockQuests()) : request<UserQuest[]>('/quests/me')),
  myNests: () => (USE_MOCKS ? mock(mocks.mockNests()) : request<NestStatus>('/quests/nests')),
  claimQuest: (questId: string) =>
    USE_MOCKS ? mock(mocks.mockClaim(questId)) : post<QuestClaimed>(`/quests/${questId}/claim`),
  nearbyBounties: (lat: number, lng: number) =>
    USE_MOCKS ? mock(mocks.mockBounties()) : request<NearbyBounty[]>(`/bounties/nearby?lat=${lat}&lng=${lng}`),
  leaderboard: (scope: 'local' | 'friends', lat?: number, lng?: number) =>
    USE_MOCKS
      ? mock(mocks.mockLeaderboard())
      : request<LeaderboardRow[]>(`/leaderboards?scope=${scope}${lat != null ? `&lat=${lat}&lng=${lng}` : ''}`),

  // Community map
  communityMap: (bbox: [number, number, number, number]) =>
    USE_MOCKS ? mock(mocks.mockCommunityMap()) : request<CommunityMap>(`/map/community?bbox=${bbox.join(',')}`),
  trailSpecies: (trailId: string) =>
    USE_MOCKS
      ? mock<TrailSpecies>({ name: 'Piedmont Park Loop', top_species: [] })
      : request<TrailSpecies>(`/trails/${trailId}/species`),
}
