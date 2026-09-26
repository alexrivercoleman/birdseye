-- Community map trails (docs/CONTRACT_CHANGES.md, 2026-09-26).
-- OSM splits one trail into many ways. Ways with the same name that touch are grouped under group_id (the smallest
-- osm_id in the group), and the map and GET /trails/{id}/species work per group.

alter table public.trails add column group_id bigint;
create index trails_group_idx on public.trails (group_id);

-- Overpass fetches are cached per 0.05° grid cell ("lat_index:lng_index"), including cells with no trails.
create table public.trail_fetch_cells (
  cell        text primary key,
  fetched_at  timestamptz not null default now()
);

-- API only (service role), like trails
alter table public.trail_fetch_cells enable row level security;
