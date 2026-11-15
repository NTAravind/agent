-- Phase 2: notes (second brain), memories and hybrid search.
-- Apply with: supabase db push  |  or paste into the Supabase SQL editor.

create extension if not exists vector;

-- Notes -------------------------------------------------------------------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  path text not null,              -- e.g. "Projects/Idea.md"
  title text,
  frontmatter jsonb,
  content_hash text not null,
  git_sha text,
  updated_at timestamptz default now(),
  unique (user_id, path)
);

create table if not exists note_chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  idx int not null,
  heading text,
  content text not null,
  embedding vector(768),
  tsv tsvector generated always as (to_tsvector('english', content)) stored
);

create index if not exists note_chunks_note_idx on note_chunks (note_id, idx);
create index if not exists note_chunks_embedding_hnsw on note_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists note_chunks_tsv_gin on note_chunks using gin (tsv);

create table if not exists note_links (
  from_note uuid references notes(id) on delete cascade,
  to_path text not null,           -- target by path/title; may be unresolved
  primary key (from_note, to_path)
);

create index if not exists note_links_to_path on note_links (to_path);

alter table notes enable row level security;
alter table note_chunks enable row level security;
alter table note_links enable row level security;

drop policy if exists "notes_select_own" on notes;
create policy "notes_select_own" on notes for select using (user_id = auth.uid());
drop policy if exists "notes_upsert_own" on notes;
create policy "notes_upsert_own" on notes for insert with check (user_id = auth.uid());
drop policy if exists "notes_update_own" on notes;
create policy "notes_update_own" on notes for update using (user_id = auth.uid());
drop policy if exists "notes_delete_own" on notes;
create policy "notes_delete_own" on notes for delete using (user_id = auth.uid());

drop policy if exists "note_chunks_select_own" on note_chunks;
create policy "note_chunks_select_own" on note_chunks for select
  using (exists (select 1 from notes n where n.id = note_chunks.note_id and n.user_id = auth.uid()));
drop policy if exists "note_chunks_upsert_own" on note_chunks;
create policy "note_chunks_upsert_own" on note_chunks for insert
  with check (exists (select 1 from notes n where n.id = note_chunks.note_id and n.user_id = auth.uid()));
drop policy if exists "note_chunks_update_own" on note_chunks;
create policy "note_chunks_update_own" on note_chunks for update
  using (exists (select 1 from notes n where n.id = note_chunks.note_id and n.user_id = auth.uid()));
drop policy if exists "note_chunks_delete_own" on note_chunks;
create policy "note_chunks_delete_own" on note_chunks for delete
  using (exists (select 1 from notes n where n.id = note_chunks.note_id and n.user_id = auth.uid()));

drop policy if exists "note_links_select_own" on note_links;
create policy "note_links_select_own" on note_links for select
  using (exists (select 1 from notes n where n.id = note_links.from_note and n.user_id = auth.uid()));
drop policy if exists "note_links_upsert_own" on note_links;
create policy "note_links_upsert_own" on note_links for insert
  with check (exists (select 1 from notes n where n.id = note_links.from_note and n.user_id = auth.uid()));
drop policy if exists "note_links_delete_own" on note_links;
create policy "note_links_delete_own" on note_links for delete
  using (exists (select 1 from notes n where n.id = note_links.from_note and n.user_id = auth.uid()));

-- Memories ----------------------------------------------------------------
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text check (kind in ('fact','preference','decision','task')),
  content text not null,
  source_thread_id uuid,
  embedding vector(768),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists memories_embedding_hnsw on memories using hnsw (embedding vector_cosine_ops);
create index if not exists memories_user_created_at on memories (user_id, created_at desc);

alter table memories enable row level security;

drop policy if exists "memories_select_own" on memories;
create policy "memories_select_own" on memories for select using (user_id = auth.uid());
drop policy if exists "memories_insert_own" on memories;
create policy "memories_insert_own" on memories for insert with check (user_id = auth.uid());
drop policy if exists "memories_update_own" on memories;
create policy "memories_update_own" on memories for update using (user_id = auth.uid());
drop policy if exists "memories_delete_own" on memories;
create policy "memories_delete_own" on memories for delete using (user_id = auth.uid());

-- Hybrid search -----------------------------------------------------------
-- Reciprocal-rank fusion of cosine similarity and full-text rank.
create or replace function search_notes(
  p_user_id uuid,
  query_embedding vector(768),
  query_text text,
  k int default 8
)
returns table (
  chunk_id uuid,
  note_id uuid,
  path text,
  heading text,
  content text,
  score float
)
language sql stable
as $$
with semantic as (
  select
    nc.id as chunk_id,
    n.id as note_id,
    n.path,
    nc.heading,
    nc.content,
    row_number() over (order by nc.embedding <=> query_embedding) as rank
  from note_chunks nc
  join notes n on n.id = nc.note_id
  where n.user_id = p_user_id
    and query_embedding is not null and nc.embedding is not null
  order by nc.embedding <=> query_embedding
  limit greatest(k * 3, 10)
),
lexical as (
  select
    nc.id as chunk_id,
    n.id as note_id,
    n.path,
    nc.heading,
    nc.content,
    row_number() over (
      order by ts_rank_cd(nc.tsv, websearch_to_tsquery('english', query_text)) desc
    ) as rank
  from note_chunks nc
  join notes n on n.id = nc.note_id
  where n.user_id = p_user_id
    and query_text is not null
    and length(query_text) > 0
    and nc.tsv @@ websearch_to_tsquery('english', query_text)
  order by ts_rank_cd(nc.tsv, websearch_to_tsquery('english', query_text)) desc
  limit greatest(k * 3, 10)
),
combined as (
  select s.chunk_id, s.note_id, s.path, s.heading, s.content, 1.0 / (60 + s.rank) as rrf
  from semantic s
  union all
  select l.chunk_id, l.note_id, l.path, l.heading, l.content, 1.0 / (60 + l.rank) as rrf
  from lexical l
)
select
  c.chunk_id,
  c.note_id,
  c.path,
  c.heading,
  c.content,
  sum(c.rrf)::float as score
from combined c
group by c.chunk_id, c.note_id, c.path, c.heading, c.content
order by score desc
limit greatest(k, 1);
$$;

create or replace function search_memories(
  p_user_id uuid,
  query_embedding vector(768),
  k int default 8
)
returns table (
  id uuid,
  kind text,
  content text,
  score float
)
language sql stable
as $$
select
  m.id,
  m.kind,
  m.content,
  (1 - (m.embedding <=> query_embedding))::float as score
from memories m
where m.user_id = p_user_id
  and query_embedding is not null and m.embedding is not null
order by m.embedding <=> query_embedding
limit greatest(k, 1);
$$;
