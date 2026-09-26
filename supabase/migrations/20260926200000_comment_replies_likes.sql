-- Feed social: comment replies, comment likes, realtime (docs/CONTRACT_CHANGES.md, 2026-09-26).
-- Replies are one level deep: a reply's parent is a top-level comment on the same walk.

alter table public.comments add column parent_id uuid references public.comments (id) on delete cascade;
create index comments_parent_idx on public.comments (parent_id);

create or replace function public.comments_check_parent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.comments p where p.id = new.parent_id and p.walk_id = new.walk_id and p.parent_id is null
  ) then
    raise exception 'a reply must point at a top-level comment on the same walk';
  end if;
  return new;
end;
$$;

create trigger comments_check_parent before insert or update of parent_id, walk_id on public.comments
  for each row execute function public.comments_check_parent();

create table public.comment_likes (
  comment_id  uuid not null references public.comments (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_likes_user_idx on public.comment_likes (user_id);

-- Same rules as chirps: readable by authenticated; insert/delete own rows
alter table public.comment_likes enable row level security;
create policy comment_likes_select on public.comment_likes for select to authenticated using (true);
create policy comment_likes_insert on public.comment_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy comment_likes_delete on public.comment_likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Live chirp/comment/like updates on the feed. DELETE events carry only the primary key.
alter publication supabase_realtime add table public.chirps, public.comments, public.comment_likes;
