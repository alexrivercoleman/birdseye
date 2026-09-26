-- Birdseye initial schema — BIRDSEYE_SPEC.md §5
-- Owner: Workstream C. Any change to tables/columns → docs/CONTRACT_CHANGES.md.

create extension if not exists postgis with schema extensions;

-- =========================================================================
-- Social
-- =========================================================================

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name  text,
  avatar_url    text,
  last_lat      double precision,
  last_lng      double precision,
  created_at    timestamptz not null default now()
);
create index profiles_username_prefix_idx on public.profiles (username text_pattern_ops);

create table public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  followee_id  uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

-- "Friends" = mutual follows (§5).
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.follows where follower_id = a and followee_id = b)
     and exists (select 1 from public.follows where follower_id = b and followee_id = a);
$$;

-- =========================================================================
-- Walks
-- =========================================================================

create table public.walks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  status             text not null default 'active' check (status in ('active', 'processing', 'complete')),
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  distance_m         double precision,
  duration_s         integer,
  species_count      integer not null default 0,
  points             integer not null default 0,
  recap_text         text,
  static_map_path    text,
  public_area_label  text,
  public_area_geog   extensions.geography(Point, 4326),
  created_at         timestamptz not null default now()
);
create index walks_user_started_idx on public.walks (user_id, started_at desc);
create index walks_started_idx on public.walks (started_at desc);

create table public.track_points (
  id           uuid primary key default gen_random_uuid(),
  walk_id      uuid not null references public.walks (id) on delete cascade,
  recorded_at  timestamptz not null,
  geog         extensions.geography(Point, 4326) not null,
  accuracy_m   double precision,
  created_at   timestamptz not null default now()
);
create index track_points_walk_time_idx on public.track_points (walk_id, recorded_at);

create table public.audio_chunks (
  id            uuid primary key default gen_random_uuid(),
  walk_id       uuid not null references public.walks (id) on delete cascade,
  chunk_index   integer not null,
  started_at    timestamptz not null,
  duration_s    double precision,
  storage_path  text,
  status        text not null default 'uploaded' check (status in ('uploaded', 'processed', 'failed')),
  created_at    timestamptz not null default now(),
  unique (walk_id, chunk_index)
);

create table public.detections (
  id              uuid primary key default gen_random_uuid(),
  walk_id         uuid not null references public.walks (id) on delete cascade,
  chunk_id        uuid references public.audio_chunks (id) on delete cascade,
  species_code    text not null,
  common_name     text not null,
  sci_name        text,
  confidence      real not null,
  detected_at     timestamptz not null,
  geog            extensions.geography(Point, 4326),
  is_anomaly      boolean not null default false,
  anomaly_reason  text,
  created_at      timestamptz not null default now()
);
create index detections_walk_idx on public.detections (walk_id);
create index detections_species_time_idx on public.detections (species_code, detected_at desc);
create index detections_geog_idx on public.detections using gist (geog);

create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  walk_id       uuid not null references public.walks (id) on delete cascade,
  captured_at   timestamptz not null,
  geog          extensions.geography(Point, 4326),
  storage_path  text,
  suggestions   jsonb not null default '[]'::jsonb,  -- [{species_code, common_name, confidence}]
  species_code  text,                                -- set after user confirms
  status        text not null default 'processing'
                check (status in ('processing', 'needs_confirmation', 'confirmed', 'unidentified')),
  created_at    timestamptz not null default now()
);
create index photos_walk_idx on public.photos (walk_id);

create table public.walk_species (
  walk_id            uuid not null references public.walks (id) on delete cascade,
  species_code       text not null,
  common_name        text not null,
  sci_name           text,
  family_com_name    text,
  rarity_tier        text not null default 'common' check (rarity_tier in ('common', 'uncommon', 'rare')),
  heard              boolean not null default false,
  photographed       boolean not null default false,
  detection_count    integer not null default 0,
  first_detected_at  timestamptz,
  geog               extensions.geography(Point, 4326),
  best_detection_id  uuid references public.detections (id) on delete set null,
  best_confidence    real,
  clip_path          text,
  spectrogram_path   text,
  photo_id           uuid references public.photos (id) on delete set null,
  points             integer not null default 0,
  is_anomaly         boolean not null default false,
  created_at         timestamptz not null default now(),
  primary key (walk_id, species_code)
);

-- Social tables that reference walks
create table public.chirps (
  walk_id     uuid not null references public.walks (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (walk_id, user_id)
);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  walk_id     uuid not null references public.walks (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index comments_walk_idx on public.comments (walk_id, created_at);

-- =========================================================================
-- Game
-- =========================================================================

create table public.points_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount      integer not null,
  reason      text not null check (reason in
                ('species_heard', 'species_photographed', 'bounty_claim', 'quest_complete', 'anomaly_confirmed')),
  walk_id     uuid references public.walks (id) on delete cascade,
  ref_id      uuid,
  geog        extensions.geography(Point, 4326),
  created_at  timestamptz not null default now()
);
create index points_ledger_user_time_idx on public.points_ledger (user_id, created_at desc);
create index points_ledger_time_idx on public.points_ledger (created_at desc);
create index points_ledger_walk_idx on public.points_ledger (walk_id);
create index points_ledger_geog_idx on public.points_ledger using gist (geog);

create table public.bounties (
  id                   uuid primary key default gen_random_uuid(),
  species_code         text not null,
  common_name          text not null,
  source_detection_id  uuid references public.detections (id) on delete set null,
  source_user_id       uuid references public.profiles (id) on delete set null,
  center_geog          extensions.geography(Point, 4326) not null,  -- fuzzed (§7.6)
  radius_m             integer not null default 300,
  expires_at           timestamptz not null default (now() + interval '7 days'),
  status               text not null default 'active' check (status in ('active', 'expired')),
  created_at           timestamptz not null default now()
);
create index bounties_active_species_idx on public.bounties (species_code) where status = 'active';
create index bounties_center_idx on public.bounties using gist (center_geog);

create table public.bounty_claims (
  bounty_id     uuid not null references public.bounties (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  detection_id  uuid references public.detections (id) on delete set null,  -- null when claimed via confirmed photo
  created_at    timestamptz not null default now(),
  primary key (bounty_id, user_id)
);

create table public.user_quests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  template       text not null check (template in
                   ('hear_family', 'photo_family', 'species_in_walk', 'dawn_chorus', 'tier_hunt', 'distance_species')),
  params         jsonb not null default '{}'::jsonb,
  title          text not null,
  flavor_text    text,
  target         integer not null,
  progress       integer not null default 0,
  reward_points  integer not null,
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz not null default (now() + interval '7 days'),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index user_quests_user_active_idx on public.user_quests (user_id, ends_at) where completed_at is null;

-- =========================================================================
-- Reference / cache
-- =========================================================================

create table public.ebird_taxonomy (
  species_code     text primary key,
  common_name      text not null,
  sci_name         text not null,
  family_com_name  text,
  family_sci_name  text,
  order_name       text,
  created_at       timestamptz not null default now()
);
create index ebird_taxonomy_sci_name_idx on public.ebird_taxonomy (lower(sci_name));

create table public.ebird_cache (
  cache_key   text primary key,  -- e.g. recent:{lat1}:{lng1}
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table public.trails (
  id            uuid primary key default gen_random_uuid(),
  osm_id        bigint not null unique,
  name          text,
  geom          extensions.geography(LineString, 4326) not null,
  fetched_bbox  text,
  created_at    timestamptz not null default now()
);
create index trails_geom_idx on public.trails using gist (geom);

-- =========================================================================
-- Row-level security (§5 "RLS summary")
-- Service role (FastAPI) bypasses RLS. Tables with RLS enabled and no
-- policies are invisible to clients.
-- =========================================================================

alter table public.profiles        enable row level security;
alter table public.follows         enable row level security;
alter table public.chirps          enable row level security;
alter table public.comments        enable row level security;
alter table public.walks           enable row level security;
alter table public.track_points    enable row level security;
alter table public.audio_chunks    enable row level security;
alter table public.detections      enable row level security;
alter table public.photos          enable row level security;
alter table public.walk_species    enable row level security;
alter table public.points_ledger   enable row level security;
alter table public.bounties        enable row level security;
alter table public.bounty_claims   enable row level security;
alter table public.user_quests     enable row level security;
alter table public.ebird_taxonomy  enable row level security;
alter table public.ebird_cache     enable row level security;
alter table public.trails          enable row level security;

-- profiles: readable by any authenticated user; writable by owner
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- follows / chirps / comments: readable by authenticated; insert/delete own rows
create policy follows_select on public.follows for select to authenticated using (true);
create policy follows_insert on public.follows for insert to authenticated with check (follower_id = (select auth.uid()));
create policy follows_delete on public.follows for delete to authenticated using (follower_id = (select auth.uid()));

create policy chirps_select on public.chirps for select to authenticated using (true);
create policy chirps_insert on public.chirps for insert to authenticated with check (user_id = (select auth.uid()));
create policy chirps_delete on public.chirps for delete to authenticated using (user_id = (select auth.uid()));

create policy comments_select on public.comments for select to authenticated using (true);
create policy comments_insert on public.comments for insert to authenticated with check (user_id = (select auth.uid()));
create policy comments_delete on public.comments for delete to authenticated using (user_id = (select auth.uid()));

-- detections: walk owner can select (live walk screen via realtime).
-- walks has no client policies, so the ownership check needs security definer.
create or replace function public.is_walk_owner(w uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.walks where id = w and user_id = (select auth.uid()));
$$;

create policy detections_select_own on public.detections for select to authenticated
  using (public.is_walk_owner(walk_id));

-- Realtime for the live walk screen
alter publication supabase_realtime add table public.detections;

-- =========================================================================
-- Storage buckets (all private; FastAPI issues signed URLs)
-- =========================================================================

insert into storage.buckets (id, name, public) values
  ('audio-chunks', 'audio-chunks', false),
  ('clips',        'clips',        false),
  ('spectrograms', 'spectrograms', false),
  ('photos',       'photos',       false),
  ('static-maps',  'static-maps',  false)
on conflict (id) do nothing;
