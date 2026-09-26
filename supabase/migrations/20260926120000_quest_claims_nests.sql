-- Quest claims + monthly nests (docs/CONTRACT_CHANGES.md, 2026-09-26).
-- Completed quests pay out when claimed. The week's first claim lays an egg in one of 5 monthly nests.

alter table public.user_quests add column claimed_at timestamptz;

alter table public.user_quests drop constraint user_quests_template_check;
alter table public.user_quests add constraint user_quests_template_check check (template in
  ('hear_family', 'photo_family', 'species_in_walk', 'dawn_chorus', 'tier_hunt', 'distance_species',
   'trail_distance', 'discover_family', 'photo_species'));

-- one quest per template per week; lets GET /quests/me generate idempotently
create unique index user_quests_user_template_start_idx on public.user_quests (user_id, template, starts_at);

create table public.quest_nests (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  week_start  date not null,  -- local Monday of the week the egg was laid
  month       date not null,  -- local first-of-month the egg counts toward
  quest_id    uuid references public.user_quests (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);
create index quest_nests_user_month_idx on public.quest_nests (user_id, month);

-- API only (service role), like user_quests
alter table public.quest_nests enable row level security;
