-- IdeaForge v2: Safe migration for SHARED Supabase project
-- Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS to avoid conflicts
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. PROFILES: Add IdeaForge columns to existing profiles table
-- ============================================================

-- Add columns only if they don't already exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id uuid references auth.users(id) on delete cascade;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan text default 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status text default 'none';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ad_credits int default 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at timestamptz default now();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();

-- Ensure RLS is on (idempotent)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Add IdeaForge RLS policies (drop first to be idempotent)
DROP POLICY IF EXISTS "ideaforge_profiles_select" ON profiles;
CREATE POLICY "ideaforge_profiles_select" ON profiles FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ideaforge_profiles_update" ON profiles;
CREATE POLICY "ideaforge_profiles_update" ON profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup (replace safely — other app may have its own version)
-- We use CREATE OR REPLACE so it overwrites any existing version
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger only if it doesn't exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger helper (create if not exists)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. GROUPS
-- ============================================================

CREATE TABLE IF NOT EXISTS groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code text UNIQUE NOT NULL DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view groups" ON groups;
CREATE POLICY "Members can view groups" ON groups
  FOR SELECT USING (
    id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owner can update group" ON groups;
CREATE POLICY "Owner can update group" ON groups
  FOR UPDATE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner can delete group" ON groups;
CREATE POLICY "Owner can delete group" ON groups
  FOR DELETE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can create groups" ON groups;
CREATE POLICY "Users can create groups" ON groups
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Anyone can lookup by invite code" ON groups;
CREATE POLICY "Anyone can lookup by invite code" ON groups
  FOR SELECT USING (true);

-- ============================================================
-- 3. GROUP MEMBERS
-- ============================================================

CREATE TABLE IF NOT EXISTS group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view memberships" ON group_members;
CREATE POLICY "Members can view memberships" ON group_members
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM group_members gm WHERE gm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owner can manage members" ON group_members;
CREATE POLICY "Owner can manage members" ON group_members
  FOR ALL USING (
    group_id IN (SELECT id FROM groups WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can join" ON group_members;
CREATE POLICY "Users can join" ON group_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can leave" ON group_members;
CREATE POLICY "Users can leave" ON group_members
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 4. ADD group_id TO IDEAS
-- ============================================================

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id) ON DELETE SET NULL;

-- Update RLS for group ideas
DROP POLICY IF EXISTS "Users can view own ideas" ON ideas;
DROP POLICY IF EXISTS "Users can view own and group ideas" ON ideas;
CREATE POLICY "Users can view own and group ideas" ON ideas
  FOR SELECT USING (
    auth.uid() = user_id
    OR group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS ideas_group_idx ON ideas (group_id) WHERE group_id IS NOT NULL;

-- ============================================================
-- 5. JOIN GROUP FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.join_group_by_code(code text)
RETURNS json AS $$
DECLARE
  g record;
  already_member boolean;
BEGIN
  SELECT * INTO g FROM groups WHERE invite_code = code;
  IF g.id IS NULL THEN
    RETURN json_build_object('error', 'Invalid invite code');
  END IF;

  SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = auth.uid()) INTO already_member;
  IF already_member THEN
    RETURN json_build_object('error', 'Already a member', 'group_id', g.id, 'group_name', g.name);
  END IF;

  INSERT INTO group_members (group_id, user_id, role) VALUES (g.id, auth.uid(), 'member');
  RETURN json_build_object('success', true, 'group_id', g.id, 'group_name', g.name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. BACKFILL: Ensure existing users have a profile row
-- ============================================================

INSERT INTO profiles (user_id, display_name)
SELECT id, split_part(email, '@', 1)
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM profiles WHERE user_id IS NOT NULL)
ON CONFLICT DO NOTHING;
