-- IdeaForge v3: AI Validation System migration
-- Run in Supabase SQL Editor (safe to re-run)

-- ============================================================
-- 1. NEW TABLE: validation_jobs
--    Tracks the status/progress of each AI validation run.
-- ============================================================

CREATE TABLE IF NOT EXISTS validation_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'researching', 'analyzing', 'complete', 'failed')),
  progress smallint DEFAULT 0
    CHECK (progress >= 0 AND progress <= 100),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE validation_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS validation_jobs_idea_idx ON validation_jobs (idea_id);

-- updated_at trigger (reuses existing function from migration.sql)
DROP TRIGGER IF EXISTS validation_jobs_updated_at ON validation_jobs;
CREATE TRIGGER validation_jobs_updated_at
  BEFORE UPDATE ON validation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: users can view their own jobs
DROP POLICY IF EXISTS "Users can view own validation jobs" ON validation_jobs;
CREATE POLICY "Users can view own validation jobs" ON validation_jobs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own validation jobs" ON validation_jobs;
CREATE POLICY "Users can insert own validation jobs" ON validation_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. NEW TABLE: validation_reports
--    Stores the full AI-generated validation report.
-- ============================================================

CREATE TABLE IF NOT EXISTS validation_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES validation_jobs(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  market_analysis jsonb,
  competition jsonb,
  need_validation jsonb,
  business_model jsonb,
  technical_feasibility jsonb,
  market_score smallint CHECK (market_score >= 1 AND market_score <= 10),
  competition_score smallint CHECK (competition_score >= 1 AND competition_score <= 10),
  need_score smallint CHECK (need_score >= 1 AND need_score <= 10),
  business_score smallint CHECK (business_score >= 1 AND business_score <= 10),
  technical_score smallint CHECK (technical_score >= 1 AND technical_score <= 10),
  overall_score smallint GENERATED ALWAYS AS (
    (market_score + competition_score + need_score + business_score + technical_score) / 5
  ) STORED,
  executive_summary text,
  recommendation text
    CHECK (recommendation IN ('strong_yes', 'yes', 'maybe', 'no', 'strong_no')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE validation_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS validation_reports_idea_idx ON validation_reports (idea_id);

-- RLS: users can view their own reports
DROP POLICY IF EXISTS "Users can view own validation reports" ON validation_reports;
CREATE POLICY "Users can view own validation reports" ON validation_reports
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own validation reports" ON validation_reports;
CREATE POLICY "Users can insert own validation reports" ON validation_reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. ADD COLUMNS TO ideas TABLE
-- ============================================================

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'none'
  CHECK (validation_status IN ('none', 'pending', 'complete', 'failed'));
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS ai_overall_score smallint;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS has_landing_page boolean DEFAULT false;

-- ============================================================
-- 4. ADD COLUMNS TO profiles TABLE
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS validation_credits int DEFAULT 3;

-- ============================================================
-- 5. ENABLE SUPABASE REALTIME ON validation_jobs
--    Allows the client to subscribe to job progress updates.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE validation_jobs;
