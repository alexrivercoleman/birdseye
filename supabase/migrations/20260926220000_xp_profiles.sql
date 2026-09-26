-- XP, levels, bios, avatars (docs/CONTRACT_CHANGES.md, 2026-09-26).
-- profiles.xp = lifetime sum of the user's points_ledger, kept in sync by a trigger. Level and title are derived
-- from xp on the client (web/src/lib/levels.ts).

alter table public.profiles add column xp integer not null default 0;
alter table public.profiles add column bio text check (char_length(bio) <= 160);

create or replace function public.points_ledger_sync_xp()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.profiles set xp = xp - old.amount where id = old.user_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.profiles set xp = xp + new.amount where id = new.user_id;
  end if;
  return null;
end;
$$;

create trigger points_ledger_sync_xp after insert or update of amount, user_id or delete on public.points_ledger
  for each row execute function public.points_ledger_sync_xp();

update public.profiles p set xp = coalesce((select sum(amount) from public.points_ledger l where l.user_id = p.id), 0);

-- Owners can still insert/update their profile, but not xp or last_lat/last_lng (the API sets those). RLS can't
-- restrict columns; privileges can.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, username, display_name, avatar_url, bio) on public.profiles to authenticated;
grant update (username, display_name, avatar_url, bio) on public.profiles to authenticated;

-- Avatars: public bucket (profile pictures aren't sensitive, and comments embed avatar_url straight from
-- Supabase, so there's no API step to sign URLs). Users write only under their own "<user id>/" folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
