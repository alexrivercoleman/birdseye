-- Golden egg (docs/CONTRACT_CHANGES.md, 2026-09-26). Filling all 5 of a month's nests lets the user hatch one big
-- egg for a 500-point bonus, once per month.

alter table public.points_ledger drop constraint points_ledger_reason_check;
alter table public.points_ledger add constraint points_ledger_reason_check check (reason in
  ('species_heard', 'species_photographed', 'bounty_claim', 'quest_complete', 'anomaly_confirmed', 'nest_hatch'));

create table public.nest_hatches (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  month       date not null,  -- local first-of-month whose nests were filled
  created_at  timestamptz not null default now(),
  primary key (user_id, month)
);

-- API only (service role), like quest_nests
alter table public.nest_hatches enable row level security;
