-- IdeaForge: Supabase Database Setup
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- 1. Ideas table
create table ideas (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  problem text not null,
  impact smallint not null check (impact between 1 and 3),
  size smallint not null check (size between 1 and 3),
  motivation smallint not null check (motivation between 1 and 3),
  feasibility smallint not null check (feasibility between 1 and 3),
  total_score smallint generated always as (impact + size + motivation + feasibility) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Row Level Security
alter table ideas enable row level security;

create policy "Users can view own ideas"
  on ideas for select
  using (auth.uid() = user_id);

create policy "Users can insert own ideas"
  on ideas for insert
  with check (auth.uid() = user_id);

create policy "Users can update own ideas"
  on ideas for update
  using (auth.uid() = user_id);

create policy "Users can delete own ideas"
  on ideas for delete
  using (auth.uid() = user_id);

-- 3. Auto-update timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger ideas_updated_at
  before update on ideas
  for each row
  execute function update_updated_at();

-- 4. Index for fast sorting
create index ideas_user_score_idx on ideas (user_id, total_score desc);
create index ideas_user_created_idx on ideas (user_id, created_at desc);
