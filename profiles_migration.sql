-- Migration for creating the `profiles` table in PostgreSQL.
-- This table stores per-user profile information needed to generate social
-- media content.  It references the Clerk user via `clerk_id`, which
-- should correspond to the external authentication identifier.

CREATE TABLE IF NOT EXISTS profiles (
  id              SERIAL PRIMARY KEY,
  clerk_id        TEXT UNIQUE NOT NULL,
  company_name    TEXT,
  description     TEXT,
  target_audience TEXT,
  tone_of_voice   TEXT,
  social_channels TEXT[],    -- e.g. '{instagram,facebook}'
  images          TEXT[],    -- optional image URLs (company logo, product photos)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-update `updated_at` on modification (optional)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_on_profiles ON profiles;
CREATE TRIGGER set_timestamp_on_profiles
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();