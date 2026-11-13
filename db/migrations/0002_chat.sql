-- Chat: threads, messages, uploaded documents and the attachments storage bucket.
-- Apply with: supabase db push  |  or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

-- Conversations -----------------------------------------------------------
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  agent_id uuid,
  title text,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant','system','tool')),
  model text,
  parts jsonb not null,
  created_at timestamptz default now()
);

create index if not exists messages_thread_created_at on messages (thread_id, created_at);
create index if not exists threads_user_updated_at on threads (user_id, updated_at desc);

alter table threads enable row level security;
alter table messages enable row level security;

drop policy if exists "threads_select_own" on threads;
create policy "threads_select_own" on threads for select using (user_id = auth.uid());
drop policy if exists "threads_insert_own" on threads;
create policy "threads_insert_own" on threads for insert with check (user_id = auth.uid());
drop policy if exists "threads_update_own" on threads;
create policy "threads_update_own" on threads for update using (user_id = auth.uid());
drop policy if exists "threads_delete_own" on threads;
create policy "threads_delete_own" on threads for delete using (user_id = auth.uid());

drop policy if exists "messages_select_own" on messages;
create policy "messages_select_own" on messages for select using (user_id = auth.uid());
drop policy if exists "messages_insert_own" on messages;
create policy "messages_insert_own" on messages for insert with check (user_id = auth.uid());
drop policy if exists "messages_delete_own" on messages;
create policy "messages_delete_own" on messages for delete using (user_id = auth.uid());

-- Uploaded documents (chat attachments today, parsed documents later) -------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  storage_path text not null,
  mime text,
  name text,
  size_bytes bigint,
  status text default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
  created_at timestamptz default now()
);

create index if not exists documents_user_created_at on documents (user_id, created_at desc);

alter table documents enable row level security;

drop policy if exists "documents_select_own" on documents;
create policy "documents_select_own" on documents for select using (user_id = auth.uid());
drop policy if exists "documents_insert_own" on documents;
create policy "documents_insert_own" on documents for insert with check (user_id = auth.uid());
drop policy if exists "documents_update_own" on documents;
create policy "documents_update_own" on documents for update using (user_id = auth.uid());
drop policy if exists "documents_delete_own" on documents;
create policy "documents_delete_own" on documents for delete using (user_id = auth.uid());

-- Private storage bucket for attachments ----------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "attachments_read_own" on storage.objects;
create policy "attachments_read_own" on storage.objects for select
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "attachments_insert_own" on storage.objects;
create policy "attachments_insert_own" on storage.objects for insert
  with check (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "attachments_delete_own" on storage.objects;
create policy "attachments_delete_own" on storage.objects for delete
  using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);
