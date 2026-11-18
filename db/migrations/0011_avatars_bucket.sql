-- 0011: avatars storage bucket + thread agent backfill.
--
-- Avatars are identity images picked per agent. The bucket is private like
-- `attachments`: uploads go through signed URLs minted by
-- POST /api/agents/:id/avatar, and API responses hand out signed read URLs
-- (resolveAvatar), so nothing is publicly listable.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists "avatars_read_own" on storage.objects;
create policy "avatars_read_own" on storage.objects for select
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- Backfill: attach each user's oldest agent (the default "Personal" agent) to
-- threads created before agent tracking, so existing conversations show an
-- avatar immediately.
update threads t
set agent_id = (
  select a.id
  from agents a
  where a.user_id = t.user_id
  order by a.created_at asc
  limit 1
)
where t.agent_id is null
  and exists (select 1 from agents a where a.user_id = t.user_id);
