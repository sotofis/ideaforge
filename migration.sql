-- IdeaForge v2: Profiles, Groups, Subscriptions
-- Run AFTER setup.sql in Supabase SQL Editor

-- 1. Profiles (auto-created on signup)
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  stripe_customer_id text unique,
  plan text not null default 'free' check (plan in ('free', 'quarterly', 'yearly')),
  subscription_status text not null default 'none' check (subscription_status in ('none', 'trialing', 'active', 'canceled', 'past_due')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  ad_credits int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Users can read own profile" on profiles for select using (auth.uid() = user_id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at
create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

-- 2. Groups
create table groups (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz default now()
);

alter table groups enable row level security;

-- Members can see their groups
create policy "Members can view groups" on groups
  for select using (
    id in (select group_id from group_members where user_id = auth.uid())
  );
-- Owner can update/delete
create policy "Owner can update group" on groups
  for update using (owner_id = auth.uid());
create policy "Owner can delete group" on groups
  for delete using (owner_id = auth.uid());
-- Paid users can create groups
create policy "Users can create groups" on groups
  for insert with check (auth.uid() = owner_id);

-- Anyone can look up a group by invite_code (for join flow)
create policy "Anyone can lookup by invite code" on groups
  for select using (true);

-- 3. Group members
create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

alter table group_members enable row level security;

create policy "Members can view memberships" on group_members
  for select using (
    group_id in (select group_id from group_members gm where gm.user_id = auth.uid())
  );
create policy "Owner can manage members" on group_members
  for all using (
    group_id in (select id from groups where owner_id = auth.uid())
  );
create policy "Users can join" on group_members
  for insert with check (auth.uid() = user_id);
create policy "Users can leave" on group_members
  for delete using (auth.uid() = user_id);

-- 4. Add group_id to ideas
alter table ideas add column group_id uuid references groups(id) on delete set null;

-- Update RLS: users can see ideas from their groups too
drop policy if exists "Users can view own ideas" on ideas;
create policy "Users can view own and group ideas" on ideas
  for select using (
    auth.uid() = user_id
    or group_id in (select group_id from group_members where user_id = auth.uid())
  );

-- Index for group ideas
create index ideas_group_idx on ideas (group_id) where group_id is not null;

-- 5. Join group function (bypasses RLS safely)
create or replace function public.join_group_by_code(code text)
returns json as $$
declare
  g record;
  already_member boolean;
begin
  select * into g from groups where invite_code = code;
  if g.id is null then
    return json_build_object('error', 'Invalid invite code');
  end if;

  select exists(select 1 from group_members where group_id = g.id and user_id = auth.uid()) into already_member;
  if already_member then
    return json_build_object('error', 'Already a member', 'group_id', g.id, 'group_name', g.name);
  end if;

  insert into group_members (group_id, user_id, role) values (g.id, auth.uid(), 'member');
  return json_build_object('success', true, 'group_id', g.id, 'group_name', g.name);
end;
$$ language plpgsql security definer;
