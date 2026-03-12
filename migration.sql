-- IdeaForge v2: Safe migration for SHARED Supabase project
-- Run in Supabase SQL Editor (safe to re-run)

-- ============================================================
-- 1. PROFILES: Add IdeaForge columns to existing profiles table
--    Existing table has: id (uuid PK, FK to auth.users), email (NOT NULL), etc.
--    IdeaForge uses user_id — we add it and keep it in sync with id.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ad_credits int DEFAULT 0;

-- Backfill user_id = id for all existing rows (id is the auth user UUID)
UPDATE profiles SET user_id = id WHERE user_id IS NULL;

-- Ensure unique constraint on user_id for ON CONFLICT to work
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_id_key') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);
  END IF;
END $$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. CREATE ALL TABLES FIRST (before any cross-references)
-- ============================================================

CREATE TABLE IF NOT EXISTS groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code text UNIQUE NOT NULL DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ideas_group_idx ON ideas (group_id) WHERE group_id IS NOT NULL;

-- ============================================================
-- 3. HELPER FUNCTION (bypasses RLS to break recursion)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_group_ids()
RETURNS SETOF uuid AS $$
  SELECT group_id FROM public.group_members WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 4. ALL POLICIES (using helper to avoid recursion)
-- ============================================================

DROP POLICY IF EXISTS "ideaforge_profiles_select" ON profiles;
CREATE POLICY "ideaforge_profiles_select" ON profiles FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ideaforge_profiles_update" ON profiles;
CREATE POLICY "ideaforge_profiles_update" ON profiles FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members can view groups" ON groups;
CREATE POLICY "Members can view groups" ON groups
  FOR SELECT USING (id IN (SELECT public.get_my_group_ids()));

DROP POLICY IF EXISTS "Owner can update group" ON groups;
CREATE POLICY "Owner can update group" ON groups FOR UPDATE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner can delete group" ON groups;
CREATE POLICY "Owner can delete group" ON groups FOR DELETE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can create groups" ON groups;
CREATE POLICY "Users can create groups" ON groups FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Anyone can lookup by invite code" ON groups;
CREATE POLICY "Anyone can lookup by invite code" ON groups FOR SELECT USING (true);

DROP POLICY IF EXISTS "Members can view memberships" ON group_members;
CREATE POLICY "Members can view memberships" ON group_members
  FOR SELECT USING (group_id IN (SELECT public.get_my_group_ids()));

DROP POLICY IF EXISTS "Owner can manage members" ON group_members;
CREATE POLICY "Owner can manage members" ON group_members
  FOR ALL USING (group_id IN (SELECT id FROM groups WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Users can join" ON group_members;
CREATE POLICY "Users can join" ON group_members FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can leave" ON group_members;
CREATE POLICY "Users can leave" ON group_members FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own ideas" ON ideas;
DROP POLICY IF EXISTS "Users can view own and group ideas" ON ideas;
CREATE POLICY "Users can view own and group ideas" ON ideas
  FOR SELECT USING (
    auth.uid() = user_id
    OR group_id IN (SELECT public.get_my_group_ids())
  );

-- ============================================================
-- 4. FUNCTIONS AND TRIGGERS
-- ============================================================

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

-- New user trigger: id = user auth id, user_id = same value
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, user_id, email, display_name)
  VALUES (new.id, new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id WHERE profiles.user_id IS NULL;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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
